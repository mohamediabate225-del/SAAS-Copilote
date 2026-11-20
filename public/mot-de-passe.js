import { api, json, showMessage } from "./app.js";

const token = location.hash.slice(1);
const status = document.querySelector("#status");
if (token) {
  history.replaceState(null, "", location.pathname);
  document.querySelector("#request").hidden = true;
  document.querySelector("#reset").hidden = false;
  document.querySelector("#reset-title").textContent = "Choisissez un nouveau mot de passe";
}

for (const form of document.querySelectorAll("form")) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const reset = form.id === "reset";
    const data = Object.fromEntries(new FormData(form));
    if (reset && data.password !== data.password_confirmation) {
      showMessage(status, "Les mots de passe ne correspondent pas.", true);
      form.elements.password_confirmation.focus();
      return;
    }
    if (reset) data.token = token;
    const button = form.querySelector("button");
    button.disabled = true;
    showMessage(status, reset ? "Vérification en cours…" : "Envoi de la demande…");
    try {
      await api("/api/account/" + (reset ? "reset-password" : "forgot-password"), json("POST", data));
      form.reset();
      showMessage(status, reset
        ? "Mot de passe modifié. Vous pouvez vous reconnecter."
        : "Si un compte correspond à cette adresse, vous recevrez un email.");
      if (reset) form.hidden = true;
    } catch (error) {
      showMessage(status, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}
