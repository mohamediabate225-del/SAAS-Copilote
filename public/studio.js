import { api, apiFetch, json, setupTrial } from "./app.js";
const el = (id) => document.getElementById(id);
const refreshTrial = setupTrial(el("studioTrial"));
const id = new URLSearchParams(location.search).get("session");
const path = "/api/workspace/sessions/" + encodeURIComponent(id);
let session,
  rows = [],
  sources = [],
  audioContext,
  mix,
  recorder,
  timer,
  capturing = false,
  activeChunk,
  analyser,
  audioSamples;
let answerQueue = Promise.resolve();
let transcribing = Promise.resolve(),
  saving = Promise.resolve(),
  backlog = 0,
  answering = false,
  closed = false;
function addText(parent, tag, text) {
  const n = document.createElement(tag);
  n.textContent = text;
  parent.append(n);
  return n;
}
function render() {
  const conversation = el("turns"),
    answers = el("answers");
  conversation.replaceChildren();
  answers.replaceChildren();
  for (const row of rows) {
    const article = document.createElement("article");
    addText(
      article,
      "small",
      row.time
        ? new Date(row.time).toLocaleTimeString("fr", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "",
    );
    addText(article, "p", row.q);
    conversation.append(article);
    if (row.a) {
      const a = document.createElement("article");
      addText(a, "strong", row.prompt || row.q);
      addText(a, "p", row.a);
      answers.append(a);
    }
  }
  if (!rows.length)
    addText(conversation, "p", "Les paroles transcrites apparaîtront ici.");
  if (!answers.children.length)
    addText(
      answers,
      "p",
      "Écoutez la question ou saisissez-la, puis cliquez sur Répondre.",
    );
  conversation.scrollTop = conversation.scrollHeight;
  answers.scrollTop = answers.scrollHeight;
}
function save() {
  if (!session.save_transcript) return Promise.resolve();
  const turns = rows.slice(-300).map((row) => ({ ...row }));
  saving = saving
    .then(async () => {
      const result = await api(
        path + "/transcript",
        json("PUT", { turns, revision: session.revision }),
      );
      session.revision = result.revision;
    })
    .catch((e) => {
      el("roomStatus").textContent = "Sauvegarde interrompue. " + e.message;
    });
  return saving;
}
function enterRoom() {
  el("connect").hidden = true;
  el("room").hidden = false;
  el("audioButton").textContent = capturing
    ? "Arrêter l’écoute"
    : "Connecter l’audio";
  render();
}
function guide() {
  const mic = el("device").value === "mic";
  el("service").parentElement.hidden = mic;
  el("guide").textContent = mic
    ? "Placez l’autre appareil en haut-parleur près du micro. Seul le micro de cet appareil sera capté."
    : "Ouvrez votre appel " +
      el("service").value +
      " dans un onglet. Sélectionnez cet onglet au partage et activez le son de l’onglet. Votre micro sera également utilisé.";
}
el("device").onchange = el("service").onchange = guide;
async function suggest(row, web = session.web ? "auto" : false) {
  if (!row || answering) return;
  answering = true;
  el("answer").disabled = true;
  el("roomStatus").textContent = "Préparation de la réponse…";
  try {
    const question = row.prompt || row.q;
    const res = await apiFetch(
      "/api/answer",
      json("POST", {
        question,
        session_id: id,
        web,
        history: rows.filter((x) => x !== row && x.a && !/pas de question détectée/i.test(x.a)).slice(-5),
      }),
    );
    if (!res.ok)
      throw new Error(
        (await res.json().catch(() => ({}))).error || "Réponse indisponible.",
      );
    const reader = res.body.getReader(),
      decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      text += decoder.decode(part.value, { stream: true });
      row.a = text;
      render();
    }
    refreshTrial();
    row.a = text + decoder.decode();
    if (!row.a.trim()) throw new Error("Aucune réponse reçue. Réessayez.");
    el("roomStatus").textContent = "";
    render();
    await save();
  } catch (error) {
    el("roomStatus").textContent = error.message;
  } finally {
    answering = false;
    el("answer").disabled = false;
  }
}
function append(question) {
  const row = { q: question, a: "", time: new Date().toISOString() };
  rows.push(row);
  if (rows.length > 300) rows.shift();
  render();
  save();
  return row;
}
function release() {
  capturing = false;
  clearInterval(timer);
  for (const source of sources)
    source.getTracks().forEach((track) => track.stop());
  sources = [];
  mix?.getTracks().forEach((track) => track.stop());
  mix = null;
  if (audioContext && audioContext.state !== "closed")
    audioContext.close().catch(() => {});
  audioContext = null;
  el("audioButton").textContent = "Connecter l’audio";
  el("recording").textContent = "";
}
async function stopAudio() {
  capturing = false;
  clearInterval(timer);
  const done = activeChunk;
  if (recorder?.state === "recording") recorder.stop();
  release();
  if (done) await done;
  await transcribing;
}
function captureChunk() {
  if (!capturing || closed) return;
  const preferred = [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ].find((t) => MediaRecorder.isTypeSupported(t));
  const r = new MediaRecorder(
    mix,
    preferred ? { mimeType: preferred } : undefined,
  );
  recorder = r;
  const parts = [];
  let speechDetected = false, lastSpeech = performance.now();
  const startedAt = performance.now();
  let finish;
  activeChunk = new Promise((resolve) => {
    finish = resolve;
  });
  r.ondataavailable = (e) => {
    if (e.data.size) parts.push(e.data);
  };
  r.onstop = () => {
    clearInterval(timer);
    recorder = null;
    if (parts.length && speechDetected && !closed) {
      const blob = new Blob(parts, { type: r.mimeType }),
        mime = r.mimeType.split(";")[0];
      backlog++;
      transcribing = transcribing
        .then(async () => {
          if (closed) return;
          const body = new FormData();
          body.set(
            "audio",
            blob,
            "conversation." +
              (mime.includes("mp4")
                ? "mp4"
                : mime.includes("ogg")
                  ? "ogg"
                  : "webm"),
          );
          body.set("language", session.context.language);
          const result = await api("/api/transcribe", { method: "POST", body });
          if (rows.length === 0) refreshTrial();
          if (result.text?.trim() && !closed) {
            const row = append(result.text.trim());
            if (
              session.auto_answer &&
              /[?？]|^(comment|pourquoi|présentez|décrivez|quel|what|how|why)/i.test(
                row.q,
              )
            )
              answerQueue = answerQueue.then(() => closed || row.a ? undefined : suggest(row));
          }
        })
        .catch((e) => {
          el("audioStatus").textContent = e.message;
          release();
        })
        .finally(() => {
          backlog--;
        });
    }
    finish();
    if (capturing) {
      if (backlog >= 4) {
        release();
        el("audioStatus").textContent =
          "L’écoute a été suspendue pour traiter les extraits en attente.";
      } else captureChunk();
    }
  };
  r.onerror = () => {
    finish();
    release();
    el("audioStatus").textContent =
      "Capture interrompue. Reconnectez le micro.";
  };
  r.start();
  timer = setInterval(() => {
    if (r.state !== "recording") return;
    analyser.getFloatTimeDomainData(audioSamples);
    const rms = Math.sqrt(audioSamples.reduce((sum,value)=>sum+value*value,0)/audioSamples.length);
    const now = performance.now();
    if (rms > 0.012) { speechDetected = true; lastSpeech = now; }
    const endOfPhrase = speechDetected && now-lastSpeech > 650 && now-startedAt > 900;
    if (endOfPhrase || now-startedAt >= 4500) r.stop();
  }, 100);
}
el("connectForm").onsubmit = async (event) => {
  event.preventDefault();
  const b = event.submitter;
  b.disabled = true;
  el("connectStatus").textContent = "";
  try {
    const devices = navigator.mediaDevices;
    if (!devices?.getUserMedia || !window.MediaRecorder)
      throw new Error(
        "La capture audio est indisponible dans ce navigateur. Vous pouvez continuer au clavier.",
      );
    if (el("device").value === "tab") {
      const tab = await devices.getDisplayMedia({ video: true, audio: true });
      sources.push(tab);
      if (!tab.getAudioTracks().length)
        throw new Error(
          "Le partage ne contient aucun son. Choisissez un onglet avec le son activé.",
        );
    }
    const mic = await devices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    sources.push(mic);
    const Audio = window.AudioContext || window.webkitAudioContext;
    audioContext = new Audio();
    await audioContext.resume();
    const destination = audioContext.createMediaStreamDestination();
    for (const stream of sources) {
      audioContext.createMediaStreamSource(stream).connect(destination);
      stream.getTracks().forEach((t) =>
        t.addEventListener(
          "ended",
          () => {
            if (capturing) stopAudio();
          },
          { once: true },
        ),
      );
    }
    mix = destination.stream;
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    audioSamples = new Float32Array(analyser.fftSize);
    audioContext.createMediaStreamSource(mix).connect(analyser);
    capturing = true;
    captureChunk();
    enterRoom();
    el("recording").textContent = "● Écoute en cours";
    el("audioStatus").textContent =
      el("device").value === "mic"
        ? "Micro actif"
        : "Micro et son de l’onglet actifs";
  } catch (e) {
    release();
    el("connectStatus").textContent =
      e.name === "NotAllowedError"
        ? "Autorisation refusée. Autorisez le partage ou continuez au clavier."
        : e.message;
  } finally {
    b.disabled = false;
  }
};
el("textMode").onclick = enterRoom;
el("audioButton").onclick = async () => {
  if (capturing) {
    await stopAudio();
    el("audioStatus").textContent = "Écoute arrêtée.";
  } else {
    el("room").hidden = true;
    el("connect").hidden = false;
  }
};
el("ask").onsubmit = async (event) => {
  event.preventDefault();
  if (answering) return;
  const typed = el("question").value.trim();
  if (!typed) {
    if (recorder?.state === "recording") {
    el("answer").disabled = true;
    const done = activeChunk;
    recorder.stop();
    await done;
    }
    await transcribing;
    el("answer").disabled = false;
  }
  const row = typed ? append(typed) : rows.at(-1);
  if (!row) {
    el("roomStatus").textContent =
      "Saisissez une question ou connectez le micro.";
    return;
  }
  if (!typed && !row.a) {
    const sinceLast = rows.slice(rows.findLastIndex((item) => item.a) + 1);
    row.prompt = sinceLast
      .slice(-4)
      .map((item) => item.q)
      .join(" ")
      .slice(-2000);
  }
  el("question").value = "";
  await suggest(
    row,
    session.web && { auto: "auto", on: true, off: false }[el("web").value],
  );
};
async function leaveSession(event) {
  event.preventDefault();
  await stopAudio();
  await saving;
  location.assign("/dashboard.html#sessions");
}
el("exit").onclick = leaveSession;
document.querySelector(".studio-bar .brand").onclick = leaveSession;
window.addEventListener("pagehide", () => {
  closed = true;
  if (recorder?.state === "recording") recorder.stop();
  release();
});
try {
  session = await api(path);
  rows = session.transcript || [];
  el("callName").textContent = [session.context.role, session.context.company]
    .filter(Boolean)
    .join(" · ");
  el("context").textContent = el("callName").textContent || "Session d’appel";
  el("useWeb").hidden = !session.web;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    el("device").value = "mic";
    el("device").options[0].disabled = true;
  }
  guide();
  if (rows.length) enterRoom();
} catch (error) {
  if (error.status === 401)
    location.replace(
      "/connexion.html?retour=" +
        encodeURIComponent(location.pathname + location.search),
    );
  else {
    el("connectForm").hidden = true;
    el("connectStatus").textContent =
      "Session inaccessible. Retrouvez vos sessions dans votre tableau de bord.";
  }
}
