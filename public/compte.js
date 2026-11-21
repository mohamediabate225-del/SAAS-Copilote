import { api, apiFetch, json, safeDestination, setupTrial, showMessage } from "./app.js";

const $ = (selector) => document.querySelector(selector);
const status = $("#status");
const auth = $("#auth");
const dashboard = $("#dashboard");
const destination = safeDestination(new URLSearchParams(location.search).get("retour"));
const refreshTrial = setupTrial($("[data-trial]"));
const dataOf = (form) => Object.fromEntries(new FormData(form));

function fill(form, values, fields) {
  for (const name of fields) form.elements[name].value = values[name] ?? "";
}

async function refreshResumes() {
  const resumes = await api("/api/account/resumes");
  const select = $("#resumeSelect");
  const selected = select.value;
  select.replaceChildren(new Option("Sans CV", ""));
  const rows = resumes.map(cv => {
    select.add(new Option(cv.name, cv.id));
    const row = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = cv.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "action secondary";
    remove.textContent = "Supprimer";
    remove.setAttribute("aria-label", "Supprimer le CV " + cv.name);
    remove.addEventListener("click", () => act(remove, async () => {
      if (!confirm("Supprimer ce CV de votre espace ?")) return;
      await api("/api/account/resumes/" + cv.id, { method: "DELETE" });
      await refreshResumes();
      showMessage(status, "CV supprimé.");
    }));
    row.append(name, remove);
    return row;
  });
  select.value = resumes.some(cv => String(cv.id) === selected) ? selected : "";
  $("#resumes").replaceChildren(...rows);
}

async function refresh() {
  let user;
  try {
    user = await api("/api/account/me");
  } catch (error) {
    auth.hidden = false;
    dashboard.hidden = true;
    if (error.status !== 401 || error.message !== "Connectez-vous pour continuer.") showMessage(status, error.message, true);
    else { status.textContent = ""; status.classList.remove("error"); }
    return;
  }
  const [preparation, billing] = await Promise.all([
    api("/api/account/preparation"), api("/api/billing/status"), refreshResumes(), refreshTrial(),
  ]);
  $("#email").textContent = user.email;
  fill($("#profile"), user, ["goals", "salary", "notes"]);
  fill($("#preparation"), preparation, ["resume_id", "role", "company", "offer", "notes"]);
  $("#portal").hidden = !billing.portal;
  auth.hidden = true;
  dashboard.hidden = false;
  status.textContent = "";
  status.classList.remove("error");
  if (new URLSearchParams(location.search).get("facturation") === "confirmee") {
    showMessage(status, billing.active ? "Abonnement actif." : "Paiement reçu par Stripe. La confirmation de l’abonnement est en cours.");
  }
}

async function act(button, operation) {
  button.disabled = true;
  try { await operation(); }
  catch (error) { showMessage(status, error.message, true); }
  finally { button.disabled = false; }
}

for (const kind of ["login", "register"]) {
  const form = $("#" + kind);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = dataOf(form);
    if (kind === "register" && data.password !== data.password_confirmation) {
      showMessage(status, "Les mots de passe ne correspondent pas.", true);
      form.elements.password_confirmation.focus();
      return;
    }
    act(form.querySelector("button"), async () => {
      await api("/api/account/" + kind, json("POST", data));
      form.reset();
      location.assign("/dashboard.html");
    });
  });
}

const flushes = [];
for (const name of ["profile", "preparation"]) {
  const form = $("#" + name);
  const hint = form.querySelector("[data-save-status]");
  let timer;
  let dirty = false;
  let queue = Promise.resolve(true);
  function save() {
    clearTimeout(timer);
    if (!dirty) return queue;
    dirty = false;
    const data = dataOf(form);
    queue = queue.then(async () => {
      hint.textContent = "Enregistrement…";
      try {
        await api("/api/account/" + name, { ...json("PUT", data), keepalive: JSON.stringify(data).length < 14000 });
        hint.textContent = "Enregistré.";
        return true;
      } catch (error) {
        dirty = true;
        hint.textContent = error.message;
        return false;
      }
    });
    return queue;
  }
  form.addEventListener("input", () => { dirty = true; clearTimeout(timer); timer = setTimeout(save, 650); });
  form.addEventListener("submit", event => { event.preventDefault(); dirty = true; save(); });
  flushes.push(save);
}

window.addEventListener("pagehide", () => flushes.forEach(save => save()));
document.querySelector(".shortcuts").addEventListener("click", async (event) => {
  const link = event.target.closest("a");
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const saved = await Promise.all(flushes.map(save => save()));
  if (!saved.every(Boolean)) {
    showMessage(status, "La préparation n’a pas pu être enregistrée. Réessayez avant de changer de page.", true);
    return;
  }
  location.assign(link.href);
});

$("#resume").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  act(form.querySelector("button"), async () => {
    const body = new FormData(form);
    if (!body.get("pdf").size) body.delete("pdf");
    await api("/api/account/resumes", { method: "POST", body });
    form.reset();
    await refreshResumes();
    showMessage(status, "CV ajouté.");
  });
});

$("#logout").addEventListener("click", (event) => act(event.currentTarget, async () => {
  await Promise.all(flushes.map(save => save()));
  await api("/api/account/logout", { method: "POST" });
  dashboard.querySelectorAll("form").forEach(form => form.reset());
  $("#pairField").hidden = true;
  $("#pairCode").value = "";
  $("#email").textContent = "";
  $("#resumes").replaceChildren();
  showMessage(status, "Vous êtes déconnecté.");
  await refresh();
}));

$("#pair").addEventListener("click", (event) => act(event.currentTarget, async () => {
  const result = await api("/api/account/extension", { method: "POST" });
  $("#pairField").hidden = false;
  $("#pairCode").value = result.token;
  $("#pairCode").select();
}));

$("#unpair").addEventListener("click", (event) => act(event.currentTarget, async () => {
  await api("/api/account/extension", { method: "DELETE" });
  $("#pairField").hidden = true;
  $("#pairCode").value = "";
  showMessage(status, "Accès de l’extension révoqué.");
}));

$("#portal").addEventListener("click", (event) => act(event.currentTarget, async () => {
  const { url } = await api("/api/billing/portal", { method: "POST" });
  location.assign(url);
}));

function downloadText(filename, content, type) {
  const blob = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = blob;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(blob), 1000);
}

$("#share-preparation").addEventListener("click", async (event) => {
  const form = $("#preparation");
  const text = [form.elements.role.value.trim(), form.elements.company.value.trim(), new URL("/demo.html", location.origin).href].filter(Boolean).join("\n");
  try {
    if (navigator.share) await navigator.share({ title: "Préparation d’entretien", text });
    else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      showMessage(status, "Poste, entreprise et lien copiés.");
    } else downloadText("preparation.txt", text, "text/plain;charset=utf-8");
  } catch (error) {
    if (error.name !== "AbortError") downloadText("preparation.txt", text, "text/plain;charset=utf-8");
  }
});

$("#reminder").addEventListener("submit", event => {
  event.preventDefault();
  const date = new Date(event.currentTarget.elements.datetime.value);
  if (!Number.isFinite(date.valueOf()) || date <= new Date()) {
    showMessage(status, "Choisissez une date et une heure à venir.", true);
    return;
  }
  const stamp = value => value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const calendar = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Copilote Entretien//Rappel//FR", "BEGIN:VEVENT",
    "UID:" + crypto.randomUUID() + "@copilote-entretien", "DTSTAMP:" + stamp(new Date()),
    "DTSTART:" + stamp(date), "DTEND:" + stamp(new Date(date.valueOf() + 15 * 60000)),
    "SUMMARY:Entraînement à l’entretien", "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY",
    "DESCRIPTION:Préparer mon entretien", "END:VALARM", "END:VEVENT", "END:VCALENDAR", "",
  ];
  downloadText("entrainement.ics", calendar.join("\r\n"), "text/calendar;charset=utf-8");
  showMessage(status, "Ouvrez le fichier téléchargé pour ajouter le rappel à votre calendrier.");
});

$("#export-data").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    const response = await apiFetch(event.currentTarget.href);
    if (!response.ok) throw new Error("Impossible d’exporter vos données.");
    const blob = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = blob;
    link.download = "copilote-donnees.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(blob), 1000);
  } catch (error) { showMessage(status, error.message, true); }
});

$("#delete-account").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!confirm("Supprimer définitivement votre compte, vos CV et vos simulations ?")) return;
  act(form.querySelector("button"), async () => {
    await api("/api/account/me", json("DELETE", dataOf(form)));
    location.replace("/");
  });
});

refresh().catch(error => showMessage(status, error.message, true));
