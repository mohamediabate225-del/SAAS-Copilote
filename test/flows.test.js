import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { createPreviewGate } from "../security.js";

let directory, database, fixture, child, base;
let calls = 0;
const password = "exemple-local-sans-valeur";
const cookieOf = response => response.headers.get("set-cookie")?.split(";")[0];
const question = "Comment avez-vous géré un imprévu ?";
const scores = { relevance: 80, structure: 75, specificity: 66, impact: 72, clarity: 91 };
const fakeCoach = {
  summary: "La réponse précise le contexte.",
  strengths: ["Le rôle est clair."],
  improvements: ["Ajoutez un résultat observable."],
  model: "J’ai vérifié le stock et informé l’équipe.",
  scores,
};
let providerBody;

function serve(handler) {
  const server = createServer(handler);
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}
const urlFor = server => "http://127.0.0.1:" + server.address().port;
const digest = value => createHash("sha256").update(value).digest("hex");

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "copilote-qa-"));
  database = join(directory, "qa.sqlite");
  fixture = await serve(async (req, res) => {
    calls++;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader("Content-Type", "application/json");
    if (req.url.includes("/audio/transcriptions")) return res.end(JSON.stringify({ text: "Euh, j’ai résolu le problème." }));
    providerBody = JSON.parse(Buffer.concat(chunks));
    if(providerBody.messages?.at(-1)?.content === "simulate-expired-key") {
      res.statusCode=401;
      return res.end(JSON.stringify({error:{message:"Expired key",type:"invalid_request_error",code:"expired_secret_key"}}));
    }
    if (providerBody.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.end('data: {"choices":[{"delta":{"content":"Réponse de test."}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\ndata: [DONE]\n\n');
      return;
    }
    const content = providerBody.response_format ? JSON.stringify(fakeCoach) : question;
    res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 15, completion_tokens: 8 } }));
  });
  child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      BILLING_ENABLED: "false", NODE_ENV: "test", HOST: "127.0.0.1", PORT: "0",
      OPENAI_API_KEY: "faux-test-local", OPENAI_BASE_URL: urlFor(fixture) + "/v1",
      COPILOTE_DB_PATH: database,
      PREVIEW_TOKEN: "", PREVIEW_PASSWORD: "", APP_BASE_URL: "", APP_PASSWORD: "",
      SMTP_HOST: "", STRIPE_SECRET_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Le serveur de test ne démarre pas.")), 15000);
    child.stderr.on("data", chunk => { if (process.env.QA_DEBUG) process.stderr.write(chunk); });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error("Serveur quitté, code " + code)); });
    child.stdout.on("data", chunk => {
      const port = String(chunk).match(/localhost:(\d+)/)?.[1];
      if (port && port !== "0") { clearTimeout(timeout); resolve("http://127.0.0.1:" + port); }
    });
  });
});

after(async () => {
  if (child && child.exitCode === null && !child.killed) {
    child.kill();
    await once(child, "exit");
  }
  fixture?.close();
  if (directory) await rm(directory, { recursive: true });
});

function request(path, { method = "GET", cookie, body, headers } = {}) {
  const options = { method, headers: new Headers(headers) };
  if (cookie) options.headers.set("Cookie", cookie);
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) {
    options.headers.set("Content-Type", "application/json");
    options.body = JSON.stringify(body);
  }
  return fetch(base + path, options);
}
async function register(email) {
  const result = await request("/api/account/register", {
    method: "POST", body: { first_name: "Compte", last_name: "Test", email, password, password_confirmation: password },
  });
  assert.equal(result.status, 201);
  assert.match(result.headers.get("set-cookie"), /HttpOnly.*SameSite=Strict/);
  return cookieOf(result);
}

test("réponse privée et refus des écritures depuis une autre origine", async () => {
  const res = await request("/entrainement.html");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy"), /script-src 'self';/);
  assert.equal((await request("/api/account/trial")).status, 401);
  assert.equal((await request("/api/answer", { method: "POST", body: { question } })).status, 401);
  assert.equal((await request("/api/account/login", { method: "POST", body: {}, headers: { Origin: "https://example.invalid" } })).status, 403);
  assert.equal(calls, 0);
});

test("compte, préparation, essai, analyse, reprise, isolation et export", async () => {
  const cookie = await register("premier@example.test");
  const other = await register("autre@example.test");
  const auth = { cookie };
  const trial = async () => (await request("/api/account/trial", auth)).json();
  assert.equal((await trial()).state, "free");
  assert.equal((await request("/api/account/profile", { ...auth, method: "PUT", body: { goals: "Achats" } })).status, 200);
  const cv = new FormData();
  cv.set("name", "CV de test");
  cv.set("content", "Gestion d’un stock fictif.");
  const resume = await (await request("/api/account/resumes", { ...auth, method: "POST", body: cv })).json();
  const target = { role: "Acheteur", company: "Entreprise fictive", offer: "Négocier les contrats.", resume_id: resume.id };
  assert.equal((await request("/api/account/preparation", { ...auth, method: "PUT", body: target })).status, 200);
  let context = await (await request("/api/account/context", auth)).json();
  assert.match(context.profile, /stock fictif/);
  assert.equal(context.role, target.role);
  assert.equal((await request("/api/account/preparation", { cookie: other, method: "PUT", body: target })).status, 400);

  const role = await request("/api/training/question", { ...auth, method: "POST", body: { context, questionIndex: 2, history: [{ q: question, a: "Une réponse précédente." }] } });
  assert.equal(role.status, 200);
  assert.equal((await role.json()).question, question);
  assert.match(providerBody.messages.at(-1).content, /demande une précision/i);
  const active = await trial();
  assert.equal(active.state, "free");
  assert.equal(active.remaining_seconds,null);

  const spoken = new FormData();
  spoken.set("audio", new Blob(["fixture"], { type: "audio/webm" }), "test.webm");
  const transcript = await (await request("/api/transcribe", { ...auth, method: "POST", body: spoken })).json();
  assert.match(transcript.text, /Euh/);
  const coachResponse = await request("/api/training/feedback", {
    ...auth, method: "POST", body: { question, answer: transcript.text, context, delivery: { duration: 3, thinking_seconds: 4 } },
  });
  assert.equal(coachResponse.status, 200);
  const { coach, delivery } = await coachResponse.json();
  assert.deepEqual(coach.scores, scores);
  assert.equal(delivery.fillers, 1);
  assert.equal(delivery.thinking_seconds, 4);
  const id = randomUUID();
  const path = "/api/practice/" + id;
  const turn = { q: question, a: transcript.text, coach, delivery };
  const draft = { version: 0, total: 3, context, question, answer: transcript.text, turns: [turn] };
  const put = (body) => request(path, { ...auth, method: "PUT", body });
  assert.equal((await (await put(draft)).json()).version, 1);
  assert.equal((await (await put(draft)).json()).version, 1);
  assert.equal((await put({ ...draft, answer: "conflit" })).status, 409);
  assert.equal((await request(path, { cookie: other })).status, 404);
  assert.equal((await (await request(path, auth)).json()).answer, transcript.text);
  assert.equal((await put({ ...draft, version: 1, status: "completed" })).status, 400);
  assert.equal((await put({ ...draft, version: 1, status: "completed", turns: [turn, turn, turn] })).status, 200);
  assert.deepEqual((await (await request("/api/practice", auth)).json())[0].scores, scores);

  const streamed = await request("/api/answer", { ...auth, method: "POST", body: { question, context } });
  assert.equal(await streamed.text(), "Réponse de test.");
  const exported = await (await request("/api/account/export", auth)).json();
  assert.equal(exported.practices.length, 1);
  assert.ok(exported.usage[0].input_tokens > 0);
  assert.equal(exported.account.password_hash, undefined);

  assert.equal((await request("/api/account/resumes/" + resume.id, { cookie: other, method: "DELETE" })).status, 204);
  assert.equal((await (await request("/api/account/resumes", auth)).json()).length, 1);
  assert.equal((await request("/api/account/resumes/" + resume.id, { ...auth, method: "DELETE" })).status, 204);
  context = await (await request("/api/account/context", auth)).json();
  assert.equal(context.resume_id, null);
  assert.doesNotMatch(context.profile, /stock fictif/);

  const extensionOrigin = "chrome-extension://" + "a".repeat(32);
  const paired = await (await request("/api/account/extension", { ...auth, method: "POST" })).json();
  const extension = { headers: { Origin: extensionOrigin, Authorization: "Bearer " + paired.token } };
  assert.equal((await request("/api/account/context", { cookie, headers: { Origin: extensionOrigin } })).status, 401);
  assert.equal((await request("/api/account/context", extension)).status, 200);
  assert.equal((await request("/api/account/export", extension)).status, 403);
  await request("/api/account/extension", { ...auth, method: "DELETE" });
  assert.equal((await request("/api/account/context", extension)).status, 401);

  const db = new DatabaseSync(database);
  db.prepare("UPDATE users SET trial_started=? WHERE email=?").run(Date.now() - 601000, "premier@example.test");
  db.close();
  assert.equal((await trial()).state, "free");
  assert.equal((await request("/api/answer", { ...auth, method: "POST", body: { question } })).status, 200);
  assert.equal((await request(path, auth)).status, 200);
  assert.equal((await request("/api/billing/checkout", { ...auth, method: "POST", body: { plan: "plus" } })).status, 503);
  assert.equal((await request("/api/account/logout", { ...auth, method: "POST" })).status, 200);
  assert.equal((await request(path, auth)).status, 401);
  const login = await request("/api/account/login", { method: "POST", body: { email: "premier@example.test", password } });
  const loggedBack = cookieOf(login);
  assert.equal((await request(path, { cookie: loggedBack })).status, 200);
  assert.equal((await request("/api/account/me", { cookie: loggedBack, method: "DELETE", body: { password } })).status, 204);
  assert.equal((await request(path, { cookie: loggedBack })).status, 401);
});

test("CV TXT transmis à la simulation et questions simples reconnues", async () => {
  const cookie = await register("cv-import@example.test");
  const body = new FormData();
  body.append("pdf", new Blob(["Gestion de fournisseurs et de stocks pour un projet fictif."], { type: "text/plain" }), "cv.txt");
  const response = await request("/api/account/resumes", { cookie, method: "POST", body });
  assert.equal(response.status, 200);
  const cv = await response.json();
  assert.match(cv.content, /fournisseurs/);
  const result = await request("/api/training/question", { cookie, method: "POST", body: { context: { profile: cv.content } } });
  assert.equal(result.status, 200);
  assert.match(providerBody.messages[0].content, /fournisseurs/);
  const unavailable=await request("/api/answer",{cookie,method:"POST",body:{question:"simulate-expired-key"}});
  assert.equal(unavailable.status,502);
  assert.match((await unavailable.json()).error,/clé API a expiré/);
  for (const question of ["Tu t'appelles comment ?", "Tu vas bien ?", "Est-ce que tu m’entends ? Est-ce que tu entends ? Est-ce que tu entends ?", "Comment s’appelle... Comment tu t’appelles ?"]) {
    const result = await request("/api/answer", { cookie, method: "POST", body: { question } });
    assert.equal(result.status, 200);
    assert.doesNotMatch(await result.text(), /pas de question/);
  }
});

test("réinitialisation à usage unique et révocation des sessions", async () => {
  const email = "reinitialisation@example.test";
  const cookie = await register(email);
  const token = "a1".repeat(32);
  const db = new DatabaseSync(database);
  const user = db.prepare("SELECT id FROM users WHERE email=?").get(email);
  db.prepare("INSERT INTO password_resets VALUES (?,?,?)").run(digest(token), user.id, Date.now() + 30000);
  db.close();
  const reset = { method: "POST", body: { token, password: password + "2", password_confirmation: password + "2" } };
  assert.equal((await request("/api/account/reset-password", reset)).status, 200);
  assert.equal((await request("/api/account/reset-password", reset)).status, 400);
  assert.equal((await request("/api/account/me", { cookie })).status, 401);
  assert.equal((await request("/api/account/login", { method: "POST", body: { email, password } })).status, 401);
  assert.equal((await request("/api/account/login", { method: "POST", body: { email, password: password + "2" } })).status, 200);
});

test("le lien de prévisualisation crée un cookie signé et redirige sans secret", async () => {
  const secret = randomUUID() + randomUUID();
  const app = express();
  app.use(createPreviewGate(secret));
  app.get("/", (_req, res) => res.send("privé"));
  const server = await serve(app);
  try {
    const origin = urlFor(server);
    assert.equal((await fetch(origin)).status, 401);
    assert.equal((await fetch(origin, { headers: { Cookie: "__Host-preview=invalid" } })).status, 401);
    const login = await fetch(origin + "/?preview=" + secret, { redirect: "manual" });
    assert.equal(login.status, 303);
    assert.equal(login.headers.get("location"), "/");
    assert.match(login.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
    assert.equal((await fetch(origin, { headers: { Cookie: cookieOf(login) } })).status, 200);
  } finally {
    server.close();
  }
});

test("bibliothèque privée, contexte de session, transcription et quota",async()=>{
  const owner=await register("espace@example.test"), other=await register("autre-espace@example.test");
  const stream="BT /F1 12 Tf 40 700 Td (Experience fabrication) Tj ET";
  const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Length "+stream.length+" >>\nstream\n"+stream+"\nendstream"];
  let pdf="%PDF-1.4\n";const offsets=[0];objects.forEach((obj,i)=>{offsets.push(pdf.length);pdf+=(i+1)+" 0 obj\n"+obj+"\nendobj\n";});
  const xref=pdf.length;pdf+="xref\n0 6\n0000000000 65535 f \n"+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF";
  const cv=new FormData();cv.set("pdf",new Blob([pdf],{type:"application/pdf"}),"exemple.pdf");
  const cvResponse=await request("/api/account/resumes",{method:"POST",cookie:owner,body:cv});
  assert.equal(cvResponse.status,200);const resume=await cvResponse.json();
  assert.match(resume.content,/Experience fabrication/);
  assert.equal(await (await request("/api/workspace/files/resumes/"+resume.id,{cookie:owner})).text(),pdf);
  assert.equal((await request("/api/workspace/files/resumes/"+resume.id,{cookie:other})).status,404);
  const data=new FormData();data.set("file",new Blob(["Budget démonstration 42 unités"],{type:"text/plain"}),"projet.txt");
  const upload=await request("/api/workspace/documents",{method:"POST",cookie:owner,body:data});
  assert.equal(upload.status,201);const doc=await upload.json();
  assert.equal((await request("/api/workspace/files/documents/"+doc.id,{cookie:other})).status,404);
  assert.match(await (await request("/api/workspace/files/documents/"+doc.id,{cookie:owner})).text(),/42 unités/);
  const path="/api/workspace/sessions", body={type:"interview",role:"Achats",offer:"Négocier",resume_id:resume.id,document_ids:[doc.id],save_transcript:true};
  assert.equal((await request(path,{method:"POST",cookie:other,body})).status,400);
  const first=await request(path,{method:"POST",cookie:owner,body});assert.equal(first.status,201);const s=await first.json();
  assert.match(s.context.profile,/Budget démonstration/);assert.match(s.context.profile,/Experience fabrication/);
  assert.equal((await request(path+"/"+s.id,{cookie:other})).status,404);
  const options={method:"PUT",cookie:owner,body:{turns:[{q:"Test",a:"Réponse"}],revision:0}};
  assert.equal((await request(path+"/"+s.id+"/transcript",options)).status,200);
  assert.equal((await request(path+"/"+s.id+"/transcript",options)).status,409);
  const mock=await (await request(path,{method:"POST",cookie:owner,body:{...body,type:"mock"}})).json();
  assert.match((await (await request("/api/practice/"+mock.id,{cookie:owner})).json()).context.profile,/42 unités/);
  await request(path+"/"+mock.id,{method:"DELETE",cookie:owner});
  assert.equal((await request("/api/practice/"+mock.id,{cookie:owner})).status,404);
  for(let i=0;i<8;i++)assert.equal((await request(path,{method:"POST",cookie:owner,body})).status,201);
  assert.equal((await request(path,{method:"POST",cookie:owner,body})).status,201);
});

test("WebKit mobile et Edge exécutent le parcours candidat", { skip: !process.env.COPILOTE_PLAYWRIGHT, timeout: 180000 }, async () => {
  const require = createRequire(join(process.env.COPILOTE_PLAYWRIGHT, "package.json"));
  const { chromium, webkit } = require("playwright");
  const engines = [
    { engine: webkit, options: { headless: true }, widths: [375, 768], mobile: true },
    { engine: chromium, options: { headless: true, channel: "msedge", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }, widths: [1024, 1440], mobile: false },
  ];
  for (const { engine, options, widths, mobile } of engines) {
    const browser = await engine.launch(options);
    try {
      const page = await browser.newPage({
        viewport: { width: widths[0], height: 820 }, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce",
      });
      if (!mobile) await page.context().grantPermissions(["microphone"]);
      page.setDefaultTimeout(14000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const paths = ["/", "/compte.html", "/mot-de-passe.html", "/entrainement.html", "/index.html",
        "/tarifs.html", "/extension-guide.html", "/demo.html", "/confidentialite.html", "/achats-supply-chain.html"];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 820 });
        for (const path of paths) {
          const res = await page.goto(base + path, { waitUntil: "domcontentloaded" });
          assert.ok([200, 304].includes(res.status()), `${path} HTTP ${res.status()}`);
          await page.locator("h1").first().waitFor();
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          assert.ok(overflow <= 1, `${path} déborde de ${overflow} px à ${width} px`);
        }
      }
      await page.setViewportSize({ width: widths[0], height: 820 });
      await page.goto(base + "/");
      await page.getByRole("link", { name: "Essayer gratuitement" }).click();
      const registration = page.locator("#authform");
      await registration.getByLabel("Prénom").fill("Camille");
      await registration.getByLabel("Nom", { exact: true }).fill("Test");
      await registration.getByLabel("Adresse e-mail").fill(`navigateur-${mobile ? "mobile" : "bureau"}@example.test`);
      await registration.getByLabel("Mot de passe", { exact: true }).fill(password);
      await registration.getByLabel("Confirmer le mot de passe").fill(password);
      await registration.getByRole("button", { name: "Créer mon compte" }).click();
      await page.waitForURL("**/dashboard.html");
      await page.getByRole("heading",{name:"Historique des sessions"}).waitFor();
      await page.goto(base+"/dashboard.html#mock");
      await page.getByRole("heading",{name:"Entretien blanc",exact:true}).waitFor();
      await page.getByRole("button",{name:"Créer un entretien blanc"}).click();
      const wiz=page.locator("#wizard");
      await wiz.getByLabel("Entreprise",{exact:true}).fill("Atelier Test");
      await wiz.getByLabel("Description du poste").fill("Acheter des composants.");
      await wiz.locator("#wizardResume").setInputFiles({name:"exemple.txt",mimeType:"text/plain",buffer:Buffer.from("Parcours en logistique et achats.")});
      await wiz.getByText("Fichier importé et sélectionné.").waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      if(process.env.QA_SCREENSHOTS)await page.screenshot({path:join(process.env.QA_SCREENSHOTS,"copilote-wizard-"+(mobile?"mobile":"bureau")+".png")});
      await wiz.getByRole("button",{name:"Suivant"}).click();
      await wiz.getByLabel("Instructions pour l’IA").fill("Questions sur la logistique");
      await wiz.getByRole("button",{name:"Créer la session",exact:true}).click();
      await page.waitForURL("**/entrainement.html?session=*");
      await page.getByRole("heading",{name:question}).waitFor();
      await page.goto(base+"/dashboard.html#sessions");
      await page.getByRole("button",{name:"Préparer une session"}).click();
      await wiz.locator("label").filter({hasText:/^Appel$/}).click();
      await wiz.getByRole("button",{name:"Suivant"}).click();
      await wiz.getByLabel("Conserver la transcription").check();
      await wiz.getByRole("button",{name:"Créer la session",exact:true}).click();
      await page.getByRole("link",{name:"Ouvrir dans le navigateur"}).click();
      if(mobile) await page.getByRole("button",{name:"Continuer au clavier"}).click();
      else {
        await page.locator("#device").selectOption("mic");
        await page.locator("#consent").check();
        await page.getByRole("button",{name:"Connecter l’audio",exact:true}).click();
        await page.getByText("● Écoute en cours").waitFor();
        await page.locator("#turns").getByText("Euh, j’ai résolu le problème.").first().waitFor({timeout:7000});
        await page.getByRole("button",{name:"Arrêter l’écoute"}).click();
      }
      await page.getByLabel("Question à traiter").fill("Pourquoi ce poste ?");
      await page.getByRole("button",{name:"Répondre",exact:true}).click();
      await page.locator("#answers article p").getByText("Réponse de test.").waitFor();
      await page.getByRole("link",{name:"Quitter"}).click();
      await page.waitForURL("**/dashboard.html#sessions");
      await page.getByRole("heading",{name:"Historique des sessions"}).waitFor();
      await page.goto(base+"/entrainement.html");
      await page.getByText("Accès gratuit · toutes les fonctionnalités sont ouvertes.").waitFor();
      await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Mon espace" }).click();
      const preparation = page.locator("#preparation");
      await preparation.getByLabel("Poste visé").fill("Responsable achats");
      await preparation.getByLabel("Offre d’emploi").fill("Négocier avec les fournisseurs.");
      const saving = page.waitForResponse(result => result.url().endsWith("/api/account/preparation") && result.request().method() === "PUT", { timeout: 7500 });
      await page.getByRole("link", { name: "Lancer un entraînement" }).click();
      assert.equal((await saving).status(), 200);
      await page.waitForURL("**/entrainement.html");
      await page.waitForFunction(() => document.querySelector('#setup-form [name="role"]').value === "Responsable achats");
      await page.getByRole("button", { name: "Commencer" }).click();
      await page.getByRole("heading", { name: question }).waitFor();
      await page.getByText("Accès gratuit · toutes les fonctionnalités sont ouvertes.").waitFor();
      await page.getByLabel("Votre réponse").fill("J’ai anticipé un risque fournisseur et proposé un autre délai.");
      await page.getByRole("button", { name: "Sauvegarder et quitter" }).click();
      await page.locator("#history-list li").filter({hasText:"Responsable achats"}).getByRole("button", { name: "Reprendre", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("#answer").value.includes("risque fournisseur"));
      for (let turn = 1; turn <= 3; turn++) {
        if (turn === 2 && !mobile) {
          await page.getByRole("button", { name: "Dicter ma réponse" }).click();
          await page.getByText("Enregistrement en cours.", { exact: true }).waitFor();
          await new Promise(resolve => setTimeout(resolve, 1200));
          await page.getByRole("button", { name: "Terminer la dictée" }).click();
          await page.getByText("Transcription ajoutée. Vous pouvez la corriger.").waitFor();
        } else if (turn > 1) {
          await page.getByLabel("Votre réponse").fill("J’ai consulté l’équipe et ajusté la commande.");
        }
        await page.getByRole("button", { name: "Analyser ma réponse" }).click();
        await page.getByText("Ajoutez un résultat observable.").waitFor();
        await page.getByRole("button", { name: turn < 3 ? "Question suivante" : "Terminer la simulation" }).click();
      }
      await page.getByRole("heading", { name: "Votre débrief" }).waitFor();
      if (!mobile) await page.getByText("Repères de dictée", { exact: true }).waitFor();
      await page.reload();
      await page.getByRole("heading", { name: "Votre débrief" }).waitFor();
      await page.goto(base + "/index.html");
      await page.getByRole("textbox", { name: "Question de l’entretien" }).fill("Pourquoi les achats ?");
      await page.getByRole("button", { name: "Proposer une réponse" }).click();
      await page.getByText("Réponse prête à être lue.").waitFor();
      await page.locator("#live-turns").getByText("Pourquoi les achats ?").waitFor();
      await page.goto(base + "/demo.html#achats");
      await page.getByLabel("Votre réponse").fill("Je vérifie les options.");
      await page.getByRole("button", { name: "Comparer avec un exemple" }).click();
      await page.getByRole("heading", { name: "Exemple et pistes de relecture" }).waitFor();
      if (!mobile) {
        await page.evaluate(() => navigator.serviceWorker.ready);
        await page.reload();
        await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
        await page.context().setOffline(true);
        await page.goto(base + "/demo.html");
        await page.getByRole("heading", { name: "Essayez une question d’entretien" }).waitFor();
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  }
});
