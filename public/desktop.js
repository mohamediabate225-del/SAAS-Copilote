const pendingKey = "copilote:desktop-session";
const installed = () => matchMedia("(display-mode: standalone)").matches;
let installPrompt;
let selectedSession;

export function setupDesktop({ button, installButton, browserLink, message, userId }) {
  function update() {
    button.textContent = installed() ? "Ouvrir dans l’application" : "Ouvrir en fenêtre dédiée";
    installButton.hidden = installed() || !installPrompt;
  }
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    update();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    update();
    message.textContent = "Copilote est installé. Votre session est prête à ouvrir.";
  });
  matchMedia("(display-mode: standalone)").addEventListener("change", update);
  button.onclick = () => {
    if (!selectedSession) return;
    if (installed()) {
      location.assign(browserLink.href);
      return;
    }
    // Run synchronously within the click so the browser can allow the new window.
    const popup = window.open(browserLink.href, "copilote-" + selectedSession, "popup,width=1200,height=820,resizable=yes,scrollbars=yes");
    if (!popup) {
      message.textContent = "La fenêtre a été bloquée. Autorisez les fenêtres pour ce site ou cliquez sur « Ouvrir dans le navigateur ».";
      return;
    }
    popup.focus();
    message.textContent = "Votre session est ouverte dans sa fenêtre. Votre connexion est conservée.";
  };
  installButton.onclick = async () => {
    if (!installPrompt || !selectedSession) return;
    const prompt = installPrompt;
    installPrompt = null;
    installButton.disabled = true;
    try {
      localStorage.setItem(pendingKey, JSON.stringify({ id: selectedSession, userId: userId(), expires: Date.now() + 600000 }));
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") {
        message.textContent = "Installation acceptée. Copilote retrouvera cette session à son ouverture.";
      } else {
        localStorage.removeItem(pendingKey);
        message.textContent = "Vous pouvez ouvrir votre session dans une fenêtre dédiée.";
      }
    } catch {
      localStorage.removeItem(pendingKey);
      message.textContent = "L’installation a été interrompue. Vous pouvez ouvrir la fenêtre dédiée.";
    } finally {
      installButton.disabled = false;
      update();
    }
  };
  update();
  return {
    select(id) {
      selectedSession = id;
      message.textContent = "";
      update();
    },
    pending() {
      if (!installed()) return null;
      try {
        const pending = JSON.parse(localStorage.getItem(pendingKey) || "null");
        localStorage.removeItem(pendingKey);
        if (pending?.userId === userId() && pending.expires > Date.now() &&
            /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(pending.id)) return pending.id;
      } catch { /* Storage may be disabled by the browser. */ }
      return null;
    }
  };
}
