import { ensureAudioConsent } from "./audio-consent.js";
import { api, setupTrial } from "./app.js";
(() => {
  const $ = (s) => document.querySelector(s);
  const btn = $("#talk"), statusEl = $("#status"), retryBtn = $("#retryBtn"), pwdBtn = $("#pwdBtn");
  const qCard = $("#qCard"), aCard = $("#aCard"), qEl = $("#question"), aEl = $("#answer");
  const fields = {
    role: $("#role"), company: $("#company"), profile: $("#profileText"),
    source: $("#source"), language: $("#language"),
  };
  const refreshTrial = setupTrial($("[data-trial]"));
  $("#compact").addEventListener("click", (event) => {
    const compact = document.body.classList.toggle("live-brief");
    event.currentTarget.setAttribute("aria-pressed", String(compact));
  });

  // --- Sécurité APP_PASSWORD ---
  const PWD_KEY = "interview-copilot:app-password";
  const getAppPassword = () => { try { return sessionStorage.getItem(PWD_KEY) || ""; } catch { return ""; } };
  const setAppPassword = (val) => {
    try {
      if (val) sessionStorage.setItem(PWD_KEY, val);
      else sessionStorage.removeItem(PWD_KEY);
      localStorage.removeItem(PWD_KEY);
    } catch {}
    updatePwdBadge();
  };
  function updatePwdBadge() {
    if (pwdBtn) pwdBtn.textContent = getAppPassword() ? "Modifier la protection du serveur" : "Configurer la protection du serveur";
  }
  updatePwdBadge();
  api("/api/public-config").then(config => { $("#serverAccess").hidden = !config.server_password; }).catch(()=>{});
  if (pwdBtn) {
    pwdBtn.addEventListener("click", () => {
      const current = getAppPassword();
      const next = prompt("Mot de passe APP_PASSWORD (laisse vide si aucun mot de passe requis sur ce serveur) :", current);
      if (next !== null) setAppPassword(next.trim());
    });
  }

  async function authFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const pwd = getAppPassword();
    if (pwd) headers.set("x-app-password", pwd);
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      const data = await res.clone().json().catch(() => ({}));
      if (data?.error === "Mot de passe invalide.") {
        const entered = prompt("Ce serveur est protégé par un mot de passe (APP_PASSWORD). Veuillez le saisir :");
        if (entered) {
          setAppPassword(entered.trim());
          headers.set("x-app-password", entered.trim());
          return fetch(url, { ...options, headers });
        }
      }
    }
    return res;
  }

  // --- Préparation synchronisée avec l’espace candidat ---
  let candidateContext = "";
  if (!fields.profile.value.trim()) $("#profile").open = true;
  api("/api/account/context").then(preparation => {
    candidateContext = preparation.profile;
    if (!fields.role.value) fields.role.value = preparation.role || "";
    if (!fields.company.value) fields.company.value = preparation.company || "";
    if (!fields.profile.value) fields.profile.value = preparation.offer || "";
  }).catch(() => {});

  // --- État ---
  let state = "idle", recorder = null, chunks = [], release = () => {}, stopDetection = () => {};
  let discardRecording = false;
  const history = [];
  function showHistory() {
    $("#live-history").hidden = !history.length;
    $("#live-turns").replaceChildren(...history.map(turn => {
      const item = document.createElement("li");
      const question = document.createElement("strong");
      question.textContent = turn.q;
      const answer = document.createElement("p");
      answer.textContent = turn.a;
      item.append(question, answer);
      return item;
    }));
  }
  $("#clear-live").addEventListener("click", () => {
    if (state !== "idle") return;
    history.length = 0;
    qEl.value = "";
    aEl.textContent = "";
    aCard.hidden = true;
    showHistory();
  });

  const LABELS = {
    idle: ["Écouter la question", "Appuie quand l’employeur commence à parler."],
    recording: ["Terminer l’écoute", "J’écoute… appuie dès qu’il a fini sa question."],
    busy: ["Traitement en cours", ""],
  };
  function setState(next, message, isError = false) {
    state = next;
    btn.dataset.state = next;
    btn.disabled = next === "busy";
    btn.setAttribute("aria-label", LABELS[next][0]);
    statusEl.textContent = message ?? LABELS[next][1];
    statusEl.classList.toggle("error", isError);
    if (retryBtn) retryBtn.disabled = next === "busy";
  }

  // --- Génération de la réponse ---
  function showQuestionType(question) {
    const types = [
      ["Situation vécue", /racontez|d[eé]crivez une situation|parlez.moi d.un|tell me about a time|describe a situation/i],
      ["Motivation", /pourquoi|motivation|what attracts|why (do|did|are)/i],
      ["Parcours", /présentez|votre parcours|about yourself|your background/i],
      ["Compétences", /comment (avez-vous|feriez-vous|gérez-vous)|how (did|would|do) you/i],
    ];
    const type = types.find(([, pattern]) => pattern.test(question));
    $("#question-type").textContent = type ? "Type probable · " + type[0] : "";
    $("#question-type").hidden = !type;
  }
  async function askAnswer(questionText) {
    const q = (questionText || "").trim();
    if (!q) {
      setState("idle", "Veuillez saisir ou enregistrer une question.", true);
      return;
    }
    qEl.value = q;
    showQuestionType(q);
    qCard.hidden = false;
    aEl.textContent = "";
    aCard.hidden = false;
    setState("busy", "Je prépare ta réponse…");

    try {
      const res = await authFetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          history,
          context: {
            role: fields.role.value, company: fields.company.value,
            profile: candidateContext, offer: fields.profile.value, language: fields.language.value,
          },
        }),
      });

      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Erreur serveur.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        aEl.textContent = text;
      }
      text += decoder.decode();
      if (!text.trim()) throw new Error("Aucune réponse reçue. Réessaie.");
      aEl.textContent = text;
      if (/pas de question d[ée]tect[ée]e/i.test(text)) {
        aCard.hidden = true;
        setState("idle", "L’IA n’a pas interprété cette question. Reformulez-la puis réessayez.", true);
        return;
      }
      history.push({ q, a: text });
      if (history.length > 20) history.shift();
      showHistory();
      setState("idle", "Réponse prête à être lue.");
    } catch (err) {
      setState("idle", err.message || "Une erreur est survenue.", true);
    } finally {
      refreshTrial();
    }
  }

  // Relancer si on clique sur le bouton ou si on fait Ctrl+Entrée / Entrée dans le champ question
  if (retryBtn) {
    retryBtn.addEventListener("click", () => { if (state === "idle") askAnswer(qEl.value); });
  }
  qEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (state === "idle") askAnswer(qEl.value);
    }
  });
  qEl.addEventListener("input", () => showQuestionType(qEl.value));

  // --- Capture audio ---
  async function openAudio() {
    if(!await ensureAudioConsent())throw new Error("Capture annulée.");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error("Micro indisponible. Saisis la question par écrit.");
    }
    if (fields.source.value === "tab") {
      if (!navigator.mediaDevices.getDisplayMedia) throw new Error("Le partage d’onglet est indisponible ici. Utilise le micro.");
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const tracks = display.getAudioTracks();
      if (!tracks.length) {
        display.getTracks().forEach((t) => t.stop());
        throw new Error("Aucun son partagé. Dans la fenêtre de partage, coche « Partager l’audio ».");
      }
      return { stream: new MediaStream(tracks), release: () => display.getTracks().forEach((t) => t.stop()) };
    }
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
    return { stream: mic, release: () => mic.getTracks().forEach((t) => t.stop()) };
  }

  async function startListening() {
    try {
      setState("busy", "Choisis la source audio et autorise le partage…");
      const audio = await openAudio();
      discardRecording = false;
      release = audio.release;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
      recorder = new MediaRecorder(audio.stream, mime ? { mimeType: mime } : undefined);
      chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = onRecorded;
      recorder.start();
      setState("recording");
      detectSilence(audio.stream);
    } catch (err) {
      release();
      const denied = err?.name === "NotAllowedError";
      setState("idle", denied ? "Accès au micro ou à l’écran refusé. Autorise-le dans le navigateur." : err.message || "Impossible de lancer l’écoute.", true);
    }
  }

  function stopListening() {
    stopDetection();
    setState("busy", "Je transcris la question…");
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function detectSilence(stream) {
    const maximum = setTimeout(stopListening, 90000);
    stopDetection = () => clearTimeout(maximum);
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!$("#autoStop").checked || !Audio) return;
    const context = new Audio();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let spoken = 0;
    let lastSpeech = 0;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      if (rms > .035) { spoken++; lastSpeech = Date.now(); }
      else if (spoken >= 4 && Date.now() - lastSpeech >= 1600) stopListening();
    }, 75);
    context.resume().catch(() => {});
    stopDetection = () => {
      clearTimeout(maximum);
      clearInterval(timer);
      context.close().catch(() => {});
    };
  }

  // --- Audio -> question -> réponse ---
  async function onRecorded() {
    stopDetection();
    release();
    if (discardRecording) return;
    try {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (blob.size < 3000) throw new Error("Je n’ai rien entendu. Vérifie la source du son et réessaie.");

      const form = new FormData();
      form.append("audio", blob, "question.webm");
      form.append("language", fields.language.value);
      const tr = await authFetch("/api/transcribe", { method: "POST", body: form });
      const trData = await tr.json().catch(() => ({}));
      if (!tr.ok) throw new Error(trData.error || "Échec de la transcription.");
      const question = (trData.text || "").trim();
      if (!question) throw new Error("Je n’ai rien compris. Réessaie.");

      await askAnswer(question);
    } catch (err) {
      setState("idle", err.message || "Une erreur est survenue.", true);
      refreshTrial();
    }
  }

  btn.addEventListener("click", () => {
    if (state === "idle") startListening();
    else if (state === "recording") stopListening();
  });

  // Espace = bouton, sauf quand on écrit dans un champ
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat) return;
    if (document.activeElement?.closest("a, input, textarea, select, summary, button, [contenteditable]")) return;
    e.preventDefault();
    btn.click();
  });
  window.addEventListener("pagehide", () => {
    discardRecording = true;
    stopDetection();
    if (recorder?.state === "recording") recorder.stop();
    release();
  });
})();
