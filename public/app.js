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
  const text=banner.querySelector("span"), clock=banner.querySelector("time"), link=banner.querySelector("a");
  let inFlight, controller, stopped=false;
  async function load(signal) {
    clock.hidden=true;banner.hidden=false;
    try {
      const usage=await api("/api/account/usage",{signal});
      if(signal.aborted)return;
      text.textContent=usage.local_beta?"Bêta locale · "+Math.floor(usage.remaining_seconds/60)+" min disponibles."
        : !usage.email_verified?"Vérifiez votre adresse e-mail pour démarrer votre essai."
        : usage.remaining_seconds>0?Math.floor(usage.remaining_seconds/60)+" min disponibles.": "Crédit épuisé ou expiré. Vos préparations restent accessibles.";
      link.hidden=false;link.textContent="Mon accès";link.href="/compte.html";
    }catch(error){
      if(signal.aborted)return;
      text.textContent=error.status===401?"Connectez-vous pour accéder à l’IA.":"Impossible de vérifier votre accès.";
      link.hidden=false;link.textContent=error.status===401?"Se connecter":"Réessayer";
      link.href=error.status===401?"/connexion.html":"/compte.html";
    }
  }
  function refresh() {
    if(stopped)return Promise.resolve();
    if(inFlight)return inFlight;
    controller=new AbortController();
    const pending=load(controller.signal).finally(()=>{if(inFlight===pending)inFlight=null;});
    inFlight=pending;return pending;
  }
  window.addEventListener("pagehide",()=>{stopped=true;controller?.abort();inFlight=null;});
  window.addEventListener("pageshow",()=>{stopped=false;refresh();});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
  refresh();return refresh;
}
