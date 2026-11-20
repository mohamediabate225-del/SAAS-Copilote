const $ = (id) => document.getElementById(id);
const fields = ["role", "company", "profile", "language"];
const button = $("record"), status = $("status");
let state = "idle", stream, recorder, chunks = [], base = "", history = [];
let extensionToken = "";
const tokenInput = $("pairCode");

async function syncWithAccount(interactive = false) {
  const syncStatus = $("syncStatus");
  try {
    if (interactive && tokenInput.value.trim()) {
      const entered = tokenInput.value.trim();
      if (!/^[a-f0-9]{64}$/.test(entered)) throw new Error("Collez le code complet depuis votre espace.");
      extensionToken = entered;
    }
    if (!extensionToken) throw new Error("Générez un code dans votre espace candidat, puis collez-le ici.");
    syncStatus.textContent = "Synchronisation en cours…";
    const url = await findServer();
    const response = await extensionFetch(url + "/api/account/context");
    const context = await readResult(response);
    $("role").value = context.role || "";
    $("company").value = context.company || "";
    $("profile").value = [context.profile, context.offer && "Offre visée : " + context.offer].filter(Boolean).join("\n\n");
    tokenInput.value = "";
    await chrome.storage.local.set({ extensionToken });
    syncStatus.textContent = "Préparation synchronisée.";
  } catch (error) {
    syncStatus.textContent = error.message;
  }
}

function extensionFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Authorization", "Bearer " + extensionToken);
  return fetch(url, { ...options, headers, credentials: "omit" });
}
async function readResult(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Accès indisponible. Vérifiez votre code.");
  return data;
}

chrome.storage.local.get(["extensionToken", "language"]).then(saved => {
  extensionToken = saved.extensionToken || "";
  if (saved.language) $("language").value = saved.language;
  syncWithAccount();
});
$("language").addEventListener("change", () => chrome.storage.local.set({ language: $("language").value }));
$("syncAccount").addEventListener("click", () => syncWithAccount(true));
$("forgetAccount").addEventListener("click", async () => {
  extensionToken = "";
  history = [];
  tokenInput.value = "";
  for (const name of ["role", "company", "profile", "question"]) $(name).value = "";
  $("answer").textContent = "";
  $("result").hidden = true;
  await chrome.storage.local.remove(["extensionToken", "role", "company", "profile"]);
  $("syncStatus").textContent = "Code et données locales retirés de ce volet.";
});
function setState(next, text) {
  state = next; status.textContent = text;
  button.disabled = next === "busy";
  button.classList.toggle("recording", next === "recording");
  button.textContent = next === "recording" ? "■  Terminer la question" : "●  Enregistrer une question";
}
async function findServer() {
  for (const port of [3101, 3100]) {
    try {
      const url = `http://127.0.0.1:${port}`;
      const res = await fetch(url + "/api/health");
      if (res.ok && (await res.json()).service === "copilote-entretien") return url;
    } catch {}
  }
  throw new Error("Le serveur local est arrêté. Lancez npm start dans le dossier du projet.");
}
function stopTracks() { if (stream) stream.getTracks().forEach((track) => track.stop()); stream = null; }
async function answerQuestion(question) {
  setState("busy", "Préparation de votre réponse…");
  $("answer").textContent = "";
  const res = await extensionFetch(base + "/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, history, context: Object.fromEntries(fields.filter(f => f !== "language").map(f => [f, $(f).value]).concat([["language", $("language").value]])) }) });
  if (!res.ok) await readResult(res);
  if (!res.body) throw new Error("Aucune réponse reçue.");
  const reader = res.body.getReader(), decoder = new TextDecoder(); let answer = "";
  for (;;) { const part = await reader.read(); if (part.done) break; answer += decoder.decode(part.value, { stream: true }); $("answer").textContent = answer; }
  answer += decoder.decode();
  if (!answer.trim()) throw new Error("Aucune réponse reçue.");
  $("answer").textContent = answer;
  history.push({ q: question, a: answer }); history = history.slice(-5);
  setState("idle", "Réponse prête. Vérifiez-la et adaptez-la à votre parcours.");
}
button.addEventListener("click", async () => {
  if (state === "recording") { setState("busy", "Transcription en cours…"); recorder.stop(); return; }
  if (state !== "idle") return;
  try {
    if (!extensionToken) throw new Error("Associez votre compte avant de capturer le son.");
    // Request the picker immediately during the user gesture.
    const pending = navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    setState("busy", "Choisissez l’onglet et partagez son audio…");
    stream = await pending;
    const audio = stream.getAudioTracks();
    if (!audio.length) throw new Error("Aucun son partagé. Recommencez et cochez « partager l’audio ».");
    base = await findServer();
    chunks = [];
    recorder = new MediaRecorder(new MediaStream(audio));
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { stopTracks(); setState("idle", "Enregistrement interrompu. Réessayez."); };
    recorder.onstop = async () => {
      stopTracks();
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 1000) throw new Error("Enregistrement trop court. Réessayez.");
        const form = new FormData(); form.append("audio", blob, "question.webm");
        const res = await extensionFetch(base + "/api/transcribe", { method: "POST", body: form });
        const data = await readResult(res);
        if (!res.ok || !data.text) throw new Error(data.error || "Aucune parole reconnue. Vérifiez l’audio partagé.");
        $("question").value = data.text; $("result").hidden = false;
        await answerQuestion(data.text);
      } catch (error) { setState("idle", error.message || "Une erreur est survenue."); }
    };
    stream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => { if (recorder && recorder.state === "recording") recorder.stop(); }));
    recorder.start(); setState("recording", "Écoute en cours. Cliquez à la fin de la question.");
  } catch (error) { stopTracks(); setState("idle", error.name === "NotAllowedError" ? "Partage annulé. Réessayez lorsque vous êtes prêt." : error.message || "Impossible de démarrer la capture."); }
});
$("retry").addEventListener("click", async () => { try { const q = $("question").value.trim(); if (!q) throw new Error("Saisissez une question."); base = await findServer(); await answerQuestion(q); } catch (error) { setState("idle", error.message || "Une erreur est survenue."); } });
window.addEventListener("pagehide", stopTracks);
