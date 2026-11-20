const passwordKey = "interview-copilot:app-password";

export function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers);
  try {
    const password = sessionStorage.getItem(passwordKey) || localStorage.getItem(passwordKey);
    if (password) headers.set("x-app-password", password);
  } catch {}
  return fetch(path, { ...options, headers });
}

export async function api(path, options) {
  const response = await apiFetch(path, options);
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || (response.status === 401
      ? "Ouvrez votre lien privé ou reconnectez-vous."
      : "La demande a échoué. Réessayez."));
    error.status = response.status;
    throw error;
  }
  return data;
}

export function json(method, data) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

export function showMessage(element, message, failed = false) {
  element.textContent = message;
  element.classList.toggle("error", failed);
  if (failed) element.focus({ preventScroll: false });
}

export function safeDestination(value) {
  if (["/entrainement.html", "/index.html", "/tarifs.html"].includes(value)) return value;
  return null;
}

export function setupTrial(banner) {
  let deadline;
  let state;
  let stateText = "";
  const text = banner.querySelector("span");
  const clock = banner.querySelector("time");
  const link = banner.querySelector("a");
  function render() {
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) || 0;
    const active = state === "active" && seconds > 0;
    const message = active ? "Temps d’essai restant"
      : state === "ready" ? "10 minutes d’essai dès votre première action IA."
      : state === "active" || state === "expired" ? "Essai terminé. Vos préparations et débriefs restent accessibles."
      : state === "guest" ? "Connectez-vous pour accéder à l’IA."
      : state === "error" ? "Impossible de vérifier l’accès à l’IA."
      : state === "paid" ? "Abonnement actif." : "";
    if (message !== stateText) {
      text.textContent = message;
      stateText = message;
    }
    clock.hidden = !active;
    if (active) clock.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const guest = state === "guest";
    link.hidden = !(guest || state === "expired" || (state === "active" && !active));
    link.textContent = guest ? "Se connecter" : "Voir les offres";
    link.href = guest ? `/compte.html?retour=${encodeURIComponent(location.pathname)}` : "/tarifs.html";
    banner.hidden = !message;
  }
  async function refresh() {
    try {
      const [trial, billing] = await Promise.all([api("/api/account/trial"), api("/api/billing/status")]);
      state = billing.active ? "paid" : trial.state;
      deadline = Date.now() + trial.remaining_seconds * 1000;
    } catch (error) {
      state = error.status === 401 ? "guest" : "error";
    }
    render();
  }
  setInterval(render, 1000);
  window.addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  refresh();
  return refresh;
}
