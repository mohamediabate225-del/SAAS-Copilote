import { ensureAudioConsent } from "./audio-consent.js";
import { api, json, setupTrial, showMessage } from "./app.js";

const $ = id => document.getElementById(id);
const setup = $("setup");
const setupForm = $("setup-form");
const run = $("run");
const answerForm = $("answer-form");
const answer = $("answer");
const status = $("practice-status");
const feedback = $("feedback");
const mic = $("mic");
const audioStatus = $("audio-status");
const refreshTrial = setupTrial(document.querySelector("[data-trial]"));
const skills = { relevance: "Pertinence", structure: "Structure", specificity: "Précision", impact: "Impact", clarity: "Clarté" };
const locale = { fr: "fr-FR", en: "en-US", es: "es-ES", de: "de-DE" };
let session;
let saveQueue = Promise.resolve();
let saveTimer;
let questionAt = Date.now();
let recorder;
let stopRecording;
let discardAudio = false;
let busy = false;
let importingCV = false;
$("practice-cv").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  const hint = $("cv-import-status");
  if (!/\.(pdf|txt)$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
    hint.textContent = "Choisissez un PDF ou TXT de 5 Mo maximum.";
    event.target.value = "";
    return;
  }
  importingCV = true;
  event.target.disabled = true;
  setupForm.querySelector("button").disabled = true;
  hint.textContent = "Lecture du CV en cours…";
  try {
    const body = new FormData();
    body.append("pdf", file);
    const cv = await api("/api/account/resumes", { method: "POST", body });
    setupForm.elements.profile.value = cv.content.slice(0, 16000);
    hint.textContent = `${cv.name} importé. Le texte ci-dessous sera utilisé pour les questions et le débrief. Le CV est aussi enregistré dans votre espace.${cv.content.length > 16000 ? " Seuls les 16 000 premiers caractères sont utilisés : adaptez le texte si nécessaire." : ""}`;
  } catch (error) { hint.textContent = error.status === 401 ? "Connectez-vous dans Mon espace, puis importez votre CV." : error.message; }
  finally {
    importingCV = false;
    event.target.disabled = false;
    setupForm.querySelector("button").disabled = false;
    event.target.value = "";
  }
});

function element(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}

function scoreList(scores, previous) {
  const list = element("ul");
  list.className = "coach-scores";
  for (const [key, label] of Object.entries(skills)) {
    const item = element("li", label);
    const delta = previous ? scores[key] - previous[key] : 0;
    item.append(element("strong", `${scores[key]}/100${delta ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}`));
    list.append(item);
  }
  return list;
}

function coachCard(turn) {
  const card = element("div");
  card.append(element("h3", turn.q), element("p", turn.coach.summary), scoreList(turn.coach.scores));
  for (const [key, title] of [["strengths", "Points forts"], ["improvements", "À travailler"]]) {
    const list = element("ul");
    list.append(...turn.coach[key].map(value => element("li", value)));
    card.append(element("h4", title), list);
  }
  card.append(element("h4", "Exemple à adapter"), element("p", turn.coach.model));
  if (turn.delivery) {
    const { duration, words_per_minute, thinking_seconds, fillers } = turn.delivery;
    const reflection = thinking_seconds == null ? "" : ` · ${thinking_seconds} s avant d’ouvrir la dictée`;
    card.append(element("h4", "Repères de dictée"), element("p",
      `${duration} s · ${words_per_minute} mots/min environ · ${fillers} hésitation(s) transcrite(s)${reflection}`));
  }
  return card;
}

async function loadHistory() {
  try {
    const sessions = await api("/api/practice");
    $("history-status").textContent = sessions.length ? "" : "Vos débriefs et brouillons apparaîtront ici.";
    const complete = sessions.filter(item => item.status === "completed");
    $("trends").hidden = !complete.length;
    if (complete.length) $("trends").replaceChildren(
      element("h3", complete.length > 1 ? "Dernière simulation et écart avec la précédente" : "Dernière simulation"),
      scoreList(complete[0].scores, complete[1]?.scores),
    );
    $("history-list").replaceChildren(...sessions.map(item => {
      const row = element("li");
      const title = [item.role || "Entretien général", item.company].filter(Boolean).join(" · ");
      row.append(element("span", `${title} · ${item.answered}/${item.total} · ${new Date(item.updated).toLocaleDateString("fr-FR")}`));
      const actions = element("div");
      actions.className = "toolbar";
      const open = element("button", item.status === "completed" ? "Voir le débrief" : "Reprendre");
      const remove = element("button", "Supprimer");
      for (const button of [open, remove]) { button.type = "button"; button.className = "action secondary"; }
      remove.setAttribute("aria-label", "Supprimer la simulation " + title);
      open.addEventListener("click", () => perform(async () => {
        if (session?.status === "draft") await save();
        session = await api("/api/practice/" + item.id);
        history.replaceState(null, "", "?session=" + item.id);
        render();
        if (session.status === "draft" && !session.question) await ask();
      }));
      remove.addEventListener("click", () => perform(async () => {
        if (!confirm("Supprimer cette simulation et son débrief ?")) return;
        await api("/api/practice/" + item.id, { method: "DELETE" });
        if (session?.id === item.id) exitPractice();
        await loadHistory();
      }));
      actions.append(open, remove);
      row.append(actions);
      return row;
    }));
  } catch (error) {
    $("history-status").textContent = error.status === 401 ? "Connectez-vous pour retrouver vos simulations." : error.message;
  }
}

function save() {
  clearTimeout(saveTimer);
  if (!session) return Promise.resolve();
  const current = session;
  const snapshot = structuredClone(current);
  const operation = saveQueue.then(async () => {
    snapshot.version = current.version;
    const data = json("PUT", snapshot);
    const saved = await api("/api/practice/" + current.id, { ...data, keepalive: new TextEncoder().encode(data.body).length < 60000 });
    current.version = saved.version;
  });
  saveQueue = operation.catch(() => {});
  return operation;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save().catch(error => showMessage(status, error.message, true)), 600);
}

function render() {
  setup.hidden = Boolean(session);
  run.hidden = !session;
  if (!session) return;
  const completed = session.status === "completed";
  const hasFeedback = Boolean(session.question && session.turns.length && session.turns.at(-1).q === session.question && session.turns.at(-1).a === session.answer);
  const index = Math.min(session.total, session.turns.length + (hasFeedback ? 0 : 1));
  $("step").textContent = completed ? "Votre débrief" : `Question ${index} sur ${session.total}`;
  $("progress").max = session.total;
  $("progress").value = session.turns.length;
  $("question").textContent = completed ? "Simulation terminée" : session.question || "Question en attente";
  $("speak").hidden = completed || !session.question || !window.speechSynthesis;
  $("question-retry").hidden = completed || Boolean(session.question);
  $("back").textContent = completed ? "Nouvelle simulation" : "Sauvegarder et quitter";
  answerForm.hidden = completed || !session.question || hasFeedback;
  answer.value = session.answer;
  feedback.hidden = !completed && !hasFeedback;
  if (completed) feedback.replaceChildren(...session.turns.map(coachCard));
  else if (hasFeedback) feedback.replaceChildren(coachCard(session.turns.at(-1)));
  else feedback.replaceChildren();
  $("next").hidden = completed || !hasFeedback;
  $("next").textContent = session.turns.length === session.total ? "Terminer la simulation" : "Question suivante";
}

async function perform(operation, button) {
  if (busy) return;
  busy = true;
  const buttons = [button, $("next"), $("back")].filter(Boolean);
  for (const control of buttons) control.disabled = true;
  status.textContent = "";
  try { await operation(); }
  catch (error) { showMessage(status, error.message, true); }
  finally {
    busy = false;
    for (const control of buttons) control.disabled = false;
  }
}

async function ask() {
  $("question-retry").hidden = true;
  $("question").textContent = "Le recruteur prépare sa question…";
  try {
    const result = await api("/api/training/question", json("POST", {
      context: session.context, history: session.turns.map(({ q, a }) => ({ q, a })),
      questionIndex: session.turns.length + 1, totalQuestions: session.total,
    }));
    session.question = result.question;
    questionAt = Date.now();
    render();
    $("question").focus();
    await save();
  } catch (error) {
    render();
    throw error;
  } finally {
    refreshTrial();
  }
}

setupForm.addEventListener("submit", event => {
  event.preventDefault();
  if (importingCV) return;
  perform(async () => {
    const { total, ...context } = Object.fromEntries(new FormData(setupForm));
    session = { id: crypto.randomUUID(), version: 0, context, total: Number(total), turns: [], status: "draft", question: "", answer: "", delivery: null };
    try { await save(); }
    catch (error) { session = null; throw error; }
    history.replaceState(null, "", "?session=" + session.id);
    render();
    await ask();
  }, setupForm.querySelector("button"));
});

$("question-retry").addEventListener("click", () => perform(ask, $("question-retry")));
$("speak").addEventListener("click", () => {
  speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(session.question);
  speech.lang = locale[session.context.language] || "fr-FR";
  speechSynthesis.speak(speech);
});

answer.addEventListener("input", () => {
  session.answer = answer.value;
  scheduleSave();
});

answerForm.addEventListener("submit", event => {
  event.preventDefault();
  if (recorder || !answer.value.trim()) return;
  perform(async () => {
    const finalAnswer = answer.value.trim();
    answer.readOnly = true;
    mic.disabled = true;
    showMessage(status, "Le coach analyse votre réponse…");
    try {
      const { coach, delivery } = await api("/api/training/feedback", json("POST", {
        question: session.question, answer: finalAnswer, context: session.context, delivery: session.delivery, speech_receipts: session.speech_receipts || [],
      }));
      session.answer = finalAnswer;
      session.speech_receipts = [];
      session.turns.push({ q: session.question, a: finalAnswer, coach, delivery });
      render();
      showMessage(status, "Débrief disponible.");
      await save();
    } finally {
      answer.readOnly = false;
      mic.disabled = false;
      refreshTrial();
    }
  }, answerForm.querySelector("button[type=submit], button:not([type])"));
});

$("next").addEventListener("click", () => perform(async () => {
  if (session.turns.length === session.total) {
    session.status = "completed";
    try { await save(); }
    catch (error) { session.status = "draft"; throw error; }
    render();
    await loadHistory();
    $("step").focus();
    return;
  }
  Object.assign(session, { question: "", answer: "", delivery: null });
  render();
  await save();
  await ask();
}, $("next")));

function exitPractice() {
  window.speechSynthesis?.cancel();
  if (recorder) { discardAudio = true; stopRecording?.(); }
  session = null;
  history.replaceState(null, "", location.pathname);
  render();
  setupForm.querySelector("button").focus();
}
$("back").addEventListener("click", () => perform(async () => {
  if (session.status === "draft") await save();
  exitPractice();
  await loadHistory();
}, $("back")));

mic.addEventListener("click", async () => {
  if (recorder) { stopRecording(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    audioStatus.textContent = "Micro indisponible. Vous pouvez écrire votre réponse.";
    return;
  }
  mic.disabled = true;
  const target = session;
  let stream;
  try {
    if(!await ensureAudioConsent())return;
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (target !== session) { stream.getTracks().forEach(track => track.stop()); return; }
    recorder = new MediaRecorder(stream);
    const parts = [];
    const started = Date.now();
    const thinking = Math.max(0, started - questionAt) / 1000;
    discardAudio = false;
    recorder.ondataavailable = ({ data }) => { if (data.size) parts.push(data); };
    const limit = setTimeout(() => stopRecording(), 180000);
    stopRecording = () => {
      clearTimeout(limit);
      if (recorder?.state === "recording") recorder.stop();
    };
    recorder.onstop = async () => {
      const mime = recorder.mimeType || parts[0]?.type || "audio/webm";
      const duration = Math.min(180, (Date.now() - started) / 1000);
      stream.getTracks().forEach(track => track.stop());
      mic.setAttribute("aria-pressed", "false");
      mic.textContent = "Dicter ma réponse";
      mic.disabled = true;
      try {
        if (discardAudio || target !== session) return;
        audioStatus.textContent = "Transcription en cours…";
        const body = new FormData();
        body.append("audio", new Blob(parts, { type: mime }), "reponse");
        body.append("language", session.context.language);
        const result = await api("/api/transcribe", { method: "POST", body });
        if (target !== session) return;
        if (!result.text) throw new Error("Aucune parole reconnue. Réessayez ou écrivez votre réponse.");
        const firstDictation = !answer.value.trim();
        answer.value = [answer.value.trim(), result.text].filter(Boolean).join(" ").slice(0, 6000);
        session.answer = answer.value;
        session.speech_receipts = [...(session.speech_receipts || []),result.speech_receipt].filter(Boolean);
        session.delivery = firstDictation ? { duration, thinking_seconds: thinking } : null;
        audioStatus.textContent = "Transcription ajoutée. Vous pouvez la corriger.";
        scheduleSave();
      } catch (error) {
        audioStatus.textContent = error.message;
      } finally {
        recorder = null;
        mic.disabled = false;
        refreshTrial();
      }
    };
    recorder.start();
    mic.setAttribute("aria-pressed", "true");
    mic.textContent = "Terminer la dictée";
    audioStatus.textContent = "Enregistrement en cours.";
  } catch {
    stream?.getTracks().forEach(track => track.stop());
    recorder = null;
    audioStatus.textContent = "Impossible d’accéder au micro. Vous pouvez écrire votre réponse.";
  } finally {
    mic.disabled = false;
  }
});

window.addEventListener("pagehide", () => {
  discardAudio = true;
  stopRecording?.();
  if (saveTimer && session?.status === "draft") save().catch(() => {});
});

async function initialize() {
  const id = new URLSearchParams(location.search).get("session");
  const context = await api("/api/account/context");
  for (const key of ["role", "company", "offer", "profile"]) {
    if (!setupForm.elements[key].value) setupForm.elements[key].value = context[key] || "";
  }
  if (id) {
    session = await api("/api/practice/" + encodeURIComponent(id));
    render();
    if (session.status === "draft" && !session.question) await perform(ask);
  }
}
initialize().catch(error => { if (error.status !== 401) showMessage(status, error.message, true); });
loadHistory();
