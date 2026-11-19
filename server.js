import "dotenv/config";
import dotenv from "dotenv";
import { resolve } from "node:path";
import express from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { buildSystemPrompt, buildTrainingRecruiterPrompt, buildTrainingFeedbackPrompt } from "./prompts.js";
import { registerAccounts } from "./accounts.js";

// Reuse the key configured for the earlier local prototype if necessary.
if (!process.env.OPENAI_API_KEY) {
  const previous = dotenv.config({ path: resolve(process.cwd(), "../../interview-copilot/.env.local"), quiet: true }).parsed;
  if (previous?.LLM_API_KEY) process.env.OPENAI_API_KEY = previous.LLM_API_KEY;
}
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY manquante. Copie .env.example en .env et colle ta clé.");
  process.exit(1);
}

const PORT = process.env.PORT || 3100;
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const ANSWER_MODEL = process.env.ANSWER_MODEL || "gpt-4o-mini";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const app = express();
// Local development only: allow requests from an installed Chrome extension.
app.use((req, res, next) => {
  const origin = req.get("origin") || "";
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-password");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: "1mb" }));
app.get("/api/health", (_req, res) => res.json({ service: "copilote-entretien" }));
app.get("/", (_req, res) => res.sendFile(resolve("public/landing.html")));
app.use(express.static("public"));

// Protection simple si tu déploies en ligne : définis APP_PASSWORD dans .env
// et envoie-le dans l'en-tête x-app-password (le front le demande une fois).
app.use("/api", (req, res, next) => {
  const pwd = process.env.APP_PASSWORD;
  if (pwd && req.get("x-app-password") !== pwd) {
    return res.status(401).json({ error: "Mot de passe invalide." });
  }
  next();
});
registerAccounts(app, upload);

// 1) Audio -> texte
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun audio reçu." });

    const type = req.file.mimetype || "audio/webm";
    const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
    const file = await toFile(req.file.buffer, `question.${ext}`, { type });

    const language = typeof req.body.language === "string" && req.body.language !== "auto" ? req.body.language : undefined;
    const result = await openai.audio.transcriptions.create({
      file,
      model: TRANSCRIBE_MODEL,
      ...(language ? { language } : {}),
    });

    res.json({ text: (result.text || "").trim() });
  } catch (err) {
    console.error("transcribe:", err?.message || err);
    res.status(500).json({ error: "Échec de la transcription. Réessaie." });
  }
});

// 2) Question -> réponse, streamée mot à mot
app.post("/api/answer", async (req, res) => {
  const { question, context = {}, history = [] } = req.body || {};
  if (typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "Question vide." });
  }
  // Avoid attributing a music preference to a candidate whose profile does not mention one.
  const profile = typeof context?.profile === "string" ? context.profile : "";
  if (/\bwhat\s+(?:kind|type|sort)\s+of\s+music\b/i.test(question) &&
      !/\b(music|musique|jazz|rock|rap|pop|classical|classique|hip[- ]?hop)\b/i.test(profile)) {
    res.type("text/plain; charset=utf-8");
    return res.send(context?.language === "fr"
      ? "J’écoute [votre style de musique préféré]. Ce que j’apprécie, c’est [votre raison]."
      : "I enjoy listening to [your preferred music]. What I appreciate most is [your reason].");
  }

  const past = (Array.isArray(history) ? history : [])
    .slice(-5)
    .filter((h) => typeof h?.q === "string" && typeof h?.a === "string")
    .flatMap((h) => [
      { role: "user", content: h.q.slice(0, 1000) },
      { role: "assistant", content: h.a.slice(0, 1500) },
    ]);

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const stream = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      stream: true,
      max_completion_tokens: 500,
      messages: [
        { role: "system", content: buildSystemPrompt(context) },
        ...past,
        { role: "user", content: question.trim().slice(0, 2000) },
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) res.write(delta);
    }
    res.end();
  } catch (err) {
    console.error("answer:", err?.message || err);
    res.write("\n\n⚠ Échec de la génération. Réessaie.");
    res.end();
  }
});

// 3) Mode Entraînement : Question suivante du recruteur
app.post("/api/training/question", async (req, res) => {
  const { context = {}, history = [], questionIndex = 1, totalQuestions = 5 } = req.body || {};
  try {
    const prompt = buildTrainingRecruiterPrompt({
      ...context,
      questionIndex: Number(questionIndex) || 1,
      totalQuestions: Number(totalQuestions) || 5,
    });

    const past = (Array.isArray(history) ? history : [])
      .slice(-6)
      .flatMap((h) => [
        { role: "assistant", content: typeof h?.q === "string" ? h.q : "" },
        { role: "user", content: typeof h?.a === "string" ? h.a : "" },
      ]);

    const completion = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: "system", content: prompt },
        ...past,
        { role: "user", content: `Pose la question numéro ${questionIndex} sur ${totalQuestions}.` },
      ],
      max_completion_tokens: 300,
      temperature: 0.7,
    });

    const question = (completion.choices?.[0]?.message?.content || "").trim().replace(/^["«]|["»]$/g, "");
    res.json({ question });
  } catch (err) {
    console.error("training question:", err?.message || err);
    res.status(500).json({ error: "Impossible de formuler la question du recruteur." });
  }
});

// 4) Mode Entraînement : Feedback / Coaching sur la réponse du candidat (streamé)
app.post("/api/training/feedback", async (req, res) => {
  const { question, answer, context = {} } = req.body || {};
  if (typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "Question manquante." });
  }
  if (typeof answer !== "string" || !answer.trim()) {
    return res.status(400).json({ error: "Réponse du candidat vide." });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const prompt = buildTrainingFeedbackPrompt({ ...context, question, answer });
    const stream = await openai.chat.completions.create({
      model: ANSWER_MODEL,
      stream: true,
      max_completion_tokens: 1000,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Voici ma réponse orale à la question :\n« ${question.trim()} »\n\nMa réponse :\n« ${answer.trim()} »` },
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) res.write(delta);
    }
    res.end();
  } catch (err) {
    console.error("training feedback:", err?.message || err);
    res.write("\n\n⚠ Échec de l'analyse du coach. Réessaie.");
    res.end();
  }
});

app.listen(PORT, "127.0.0.1", () => console.log(`✅ Copilote d'entretien prêt : http://localhost:${PORT}`));
