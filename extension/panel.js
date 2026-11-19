const $ = (id) => document.getElementById(id);
const fields = ["role", "company", "profile", "language"];
const button = $("record"), status = $("status");
let state = "idle", stream, recorder, chunks = [], base = "", history = [];
chrome.storage.local.get(fields).then((saved) => {
  for (const name of fields) if (saved[name] !== undefined) $(name).value = saved[name];
  syncWithAccount(false);
});
for (const name of fields) $(name).addEventListener("input", () => chrome.storage.local.set({ [name]: $(name).value }));
async function syncWithAccount(interactive = false) {
  const syncStatus = $("syncStatus");
  try {
    if (interactive && syncStatus) syncStatus.textContent = "Synchronisation en cours…";
    const url = await findServer();
    const [userRes, prepRes, resumesRes] = await Promise.all([
      fetch(url + "/api/account/me", { credentials: "include" }),
      fetch(url + "/api/account/preparation", { credentials: "include" }),
      fetch(url + "/api/account/resumes", { credentials: "include" }),
    ]);
    if (!userRes.ok || !prepRes.ok) {
      if (interactive && syncStatus) syncStatus.textContent = "Non connecté. Connectez-vous sur votre espace web.";
      return;
    }
    const user = await userRes.json();
    const prep = await prepRes.json();
    const resumes = (resumesRes.ok ? await resumesRes.json() : []) || [];
    const resume = resumes.find((r) => r.id === prep.resume_id);
    const fullProfile = [
      resume?.content,
      user.goals && `Métiers recherchés : ${user.goals}`,
      user.salary && `Salaire recherché : ${user.salary}`,
      user.notes,
      prep.offer && `Offre visée :\n${prep.offer}`,
      prep.notes,
    ].filter(Boolean).join("\n\n");

    if (prep.role) $("role").value = prep.role;
    if (prep.company) $("company").value = prep.company;
    if (fullProfile) $("profile").value = fullProfile;

    await chrome.storage.local.set({
      role: $("role").value,
      company: $("company").value,
      profile: $("profile").value,
    });
    if (syncStatus) syncStatus.textContent = `✓ Synchronisé (${user.first_name || user.email})`;
  } catch (err) {
    if (interactive && syncStatus) syncStatus.textContent = "Serveur inaccessible. Lancez npm start.";
  }
}
if ($("syncAccount")) {
  $("syncAccount").addEventListener("click", () => syncWithAccount(true));
}
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
  const res = await fetch(base + "/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, history, context: Object.fromEntries(fields.filter(f => f !== "language").map(f => [f, $(f).value]).concat([["language", $("language").value]])) }) });
  if (!res.ok || !res.body) throw new Error("Impossible de préparer la réponse. Vérifiez le serveur.");
  const reader = res.body.getReader(), decoder = new TextDecoder(); let answer = "";
  for (;;) { const part = await reader.read(); if (part.done) break; answer += decoder.decode(part.value, { stream: true }); $("answer").textContent = answer; }
  history.push({ q: question, a: answer }); history = history.slice(-5);
  setState("idle", "Réponse prête. Vérifiez-la et adaptez-la à votre parcours.");
}
button.addEventListener("click", async () => {
  if (state === "recording") { setState("busy", "Transcription en cours…"); recorder.stop(); return; }
  if (state !== "idle") return;
  try {
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
        const res = await fetch(base + "/api/transcribe", { method: "POST", body: form });
        const data = await res.json();
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
