import { api, json } from "./app.js";
const el = (id) => document.getElementById(id);
const form = el("authform");
const registering = () => location.hash === "#inscription";
function display() {
  const create = registering();
  el("title").textContent = create
    ? "Créer votre compte"
    : "Connexion à Copilote";
  el("registrationTerms").hidden = !create;
  form.elements.accept_terms.required = create;
  el("names").hidden = el("confirm").hidden = !create;
  for (const key of ["first_name", "last_name", "password_confirmation"])
    form.elements[key].required = create;
  form.elements.password.autocomplete = create
    ? "new-password"
    : "current-password";
  form.elements.password.minLength = create ? 10 : 1;
  el("submit").textContent = create ? "Créer mon compte" : "Se connecter";
  el("toggle").textContent = create
    ? "J’ai déjà un compte"
    : "Créer mon compte";
  el("toggle").href = create ? "#connexion" : "#inscription";
  el("forgot").hidden = create;
  el("status").textContent = "";
}
function enter() {
  location.replace("/dashboard.html");
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  el("submit").disabled = true;
  try {
    await api(
      "/api/account/" + (registering() ? "register" : "login"),
      json("POST", Object.fromEntries(new FormData(form))),
    );
    enter();
  } catch (error) {
    el("status").textContent = error.message;
  } finally {
    el("submit").disabled = false;
  }
});
window.addEventListener("hashchange", display);
display();
const oauthError = new URLSearchParams(location.search).get("oauth");
if (oauthError)
  el("status").textContent =
    oauthError === "existing"
      ? "Cette adresse possède déjà un compte. Connectez-vous avec votre méthode habituelle."
      : "Connexion interrompue. Réessayez ou utilisez votre e-mail.";
api("/api/account/providers")
  .then((names) => {
    if (!names.length || registering()) return;
    const list = el("providers");
    list.hidden = false;
    for (const name of names) {
      const link = document.createElement("a");
      link.className = "button primary";
      link.href = "/auth/start/" + name;
      link.textContent =
        "Continuer avec " + (name === "google" ? "Google" : "Apple");
      list.append(link);
    }
    const email = el("emailMode");
    form.hidden = true;
    email.hidden = false;
    function showForm() {
      email.hidden = true;
      form.hidden = false;
      el("providers").hidden = true;
    }
    email.onclick = () => {
      showForm();
      form.email.focus();
    };
    window.addEventListener("hashchange", showForm);
  })
  .catch(() => {});
api("/api/account/me")
  .then(enter)
  .catch((error) => {
    if (error.status !== 401) el("status").textContent = error.message;
  });
