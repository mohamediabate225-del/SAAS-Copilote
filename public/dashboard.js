import { api, json } from "./app.js";
import {
  element,
  action,
  notify,
  upload,
  library,
  maker,
  portraits,
  clearPreview,
} from "./library.js";
const el = (id) => document.getElementById(id);
const root = "/api/workspace/",
  labels = {
    sessions: "Sessions d’appel",
    resumes: "Mes CV",
    documents: "Documents",
    mock: "Entretien blanc",
    maker: "Éditeur de CV",
    portraits: "Portraits pro",
  };
const purposes = {
  sessions: "Assistant d’entretien",
  mock: "Entretien blanc",
  maker: "Créer mon CV",
  portraits: "Portrait professionnel",
};
const types = { interview: "Entretien", regular: "Appel", mock: "Simulation" };
const form = el("newSession"),
  fields = form.elements,
  wizard = el("wizard");
let config,
  currentUser,
  stage,
  purpose,
  pageVersion = 0;
function onboarding(second = false) {
  el("onboard").hidden = false;
  el("shell").hidden = true;
  el("step").textContent = second ? "Étape 2 sur 2" : "Étape 1 sur 2";
  el("question").textContent = second
    ? "Comment nous avez-vous connus ?"
    : "Qu’est-ce qui vous amène sur Copilote ?";
  el("hint").textContent = second
    ? "Une dernière question avant de commencer."
    : "Choisissez ce que vous souhaitez préparer en premier.";
  el("previous").hidden = !second;
  el("previous").onclick = () => onboarding();
  const choices = second
    ? Object.fromEntries(
        [
          "Google",
          "LinkedIn",
          "TikTok",
          "YouTube",
          "Instagram",
          "ChatGPT",
          "Un ami",
          "Autre",
        ].map((x) => [x, x]),
      )
    : purposes;
  el("choices").replaceChildren(
    ...Object.entries(choices).map(([key, label]) =>
      action(label, async () => {
        if (!second) {
          purpose = key;
          onboarding(true);
          return;
        }
        await api(
          root + "onboarding",
          json("PUT", { purpose, discovery: key }),
        );
        el("onboard").hidden = true;
        if (!location.hash) history.replaceState(null, "", "#" + purpose);
        await dashboard();
      }),
    ),
  );
}
function credits() {
  el("credits").textContent =
    config.free_access ? "Accès gratuit" : config.remaining === null
      ? "Abonnement actif"
      : config.remaining +
        " session" +
        (config.remaining === 1 ? "" : "s") +
        " gratuite" +
        (config.remaining === 1 ? "" : "s") +
        " restante" +
        (config.remaining === 1 ? "" : "s");
  document.querySelector(".plan small").hidden = config.remaining === null;
}
async function dashboard() {
  el("shell").hidden = false;
  el("account").textContent =
    [currentUser.first_name, currentUser.last_name].filter(Boolean).join(" ") ||
    "Mon compte";
  credits();
  await render();
}
function setMenu(open) {
  el("menu").setAttribute("aria-expanded", String(open));
  el("rail").classList.toggle("open", open);
}
el("menu").onclick = () =>
  setMenu(el("menu").getAttribute("aria-expanded") === "false");
el("logout").onclick = async () => {
  try {
    await api("/api/account/logout", { method: "POST" });
    location.replace("/connexion.html");
  } catch (e) {
    notify(e.message);
  }
};
function openSession(s) {
  if (s.type === "mock") {
    location.href = "/entrainement.html?session=" + encodeURIComponent(s.id);
    return;
  }
  el("browser").href = "/studio.html?session=" + encodeURIComponent(s.id);
  el("platform").showModal();
}
function listSessions(host, sessions, mock) {
  const title = element("div", undefined, "block-title");
  title.append(
    element("h2", mock ? "Vos simulations" : "Historique des sessions"),
  );
  host.append(title);
  if (!sessions.length) {
    const blank = element("div", undefined, "empty");
    blank.append(
      element(
        "h3",
        mock
          ? "Aucune simulation pour le moment"
          : "Votre première session vous attend",
      ),
      element(
        "p",
        mock
          ? "Vos entretiens blancs apparaîtront ici."
          : "Retrouvez ici vos appels préparés et leurs transcriptions.",
      ),
      action("Créer une session", () => create(mock ? "mock" : "interview")),
    );
    host.append(blank);
    return;
  }
  const date = new Intl.DateTimeFormat("fr", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  for (const s of sessions) {
    const line = element("article", undefined, "listing"),
      name = element("div");
    name.append(
      element(
        "strong",
        [s.role, s.company].filter(Boolean).join(" · ") || types[s.type],
      ),
      element("small", types[s.type] + " · " + date.format(s.created)),
    );
    line.append(
      name,
      action("Ouvrir", () => openSession(s)),
      action("Supprimer", async () => {
        if (!confirm("Supprimer cette session et son historique ?")) return;
        await api(root + "sessions/" + s.id, { method: "DELETE" });
        await render();
      }),
    );
    host.append(line);
  }
}
async function render() {
  if (el("shell").hidden) return;
  const version = ++pageVersion,
    route = Object.hasOwn(labels, location.hash.slice(1))
      ? location.hash.slice(1)
      : "sessions";
  setMenu(false);
  clearPreview();
  el("sectionTitle").textContent = labels[route];
  document.title = labels[route] + " · Copilote Entretien";
  document.querySelectorAll("#rail nav a").forEach((a) => {
    if (a.hash === "#" + route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const host = element("div");
  el("view").replaceChildren(host);
  try {
    if (route === "resumes" || route === "documents") {
      await library(host, route);
      return;
    }
    if (route === "maker") {
      await maker(host);
      return;
    }
    if (route === "portraits") {
      portraits(host);
      return;
    }
    const mock = route === "mock",
      header = element("section", undefined, "hero-panel"),
      copy = element("div", undefined, "hero-copy");
    copy.append(
      element("h1", mock ? "Entretien blanc" : "Sessions d’appel"),
      element(
        "p",
        mock
          ? "Répétez à voix haute avec un recruteur IA. Les questions s’appuient sur l’entreprise, l’offre et le CV de votre choix."
          : "Préparez votre appel avec votre CV et vos documents. Retrouvez les questions et les réponses dans votre espace.",
      ),
      action(
        mock ? "Créer un entretien blanc" : "Préparer une session",
        () => create(mock ? "mock" : "interview"),
        "primary",
      ),
    );
    const wave = element("div", undefined, "wave");
    wave.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 40; i++) {
      const bar = element("i");
      bar.style.height =
        14 + Math.abs(Math.sin(i * 2.4) * Math.cos(i / 7)) * 74 + "%";
      wave.append(bar);
    }
    header.append(copy, wave);
    host.append(header);
    const sessions = await api(root + "sessions");
    if (version === pageVersion)
      listSessions(
        host,
        mock ? sessions.filter((s) => s.type === "mock") : sessions,
        mock,
      );
  } catch (error) {
    host.append(element("p", error.message));
  }
}
async function choices(selected, docIds = []) {
  const [resumes, docs] = await Promise.all([
    api("/api/account/resumes"),
    api(root + "documents"),
  ]);
  fields.resume_id.replaceChildren(
    new Option("Aucun CV", ""),
    ...resumes.map((f) => new Option(f.name, f.id)),
  );
  fields.resume_id.value = selected || "";
  const list = el("documentChoices");
  list.replaceChildren();
  for (const f of docs) {
    const label = element("label", undefined, "check"),
      input = element("input");
    input.type = "checkbox";
    input.name = "document_ids";
    input.value = f.id;
    input.checked = docIds.includes(f.id);
    label.append(input, document.createTextNode(f.name));
    list.append(label);
  }
  if (!docs.length) list.append(element("small", "Aucun document importé."));
}
function showStage(prefs) {
  stage = prefs ? 2 : 1;
  el("details").hidden = prefs;
  el("prefs").hidden = !prefs;
  el("detailsStep").classList.toggle("active", !prefs);
  el("prefsStep").classList.toggle("active", prefs);
  el("back").textContent = prefs ? "Retour" : "Annuler";
  el("next").textContent = prefs ? "Créer la session" : "Suivant";
  el("wizardStatus").textContent = "";
  el("livePrefs").hidden = fields.type.value === "mock";
  el("questionCount").hidden = fields.type.value !== "mock";
}
async function create(type) {
  setMenu(false);
  form.reset();
  fields.type.value = type;
  fields.model.replaceChildren(...config.models.map((m) => new Option(m, m)));
  showStage(false);
  wizard.showModal();
  el("next").disabled = true;
  try {
    await choices();
  } catch (e) {
    el("wizardStatus").textContent = e.message;
  } finally {
    el("next").disabled = false;
  }
}
document
  .querySelectorAll("[data-create]")
  .forEach((b) => (b.onclick = () => create(b.dataset.create)));
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => b.closest("dialog").close()));
el("back").onclick = () => (stage === 2 ? showStage(false) : wizard.close());
el("offerHelp").onclick = () => {
  const expanded=el("offerHelp").getAttribute("aria-expanded") !== "true";
  el("offerHelp").setAttribute("aria-expanded",String(expanded));
  el("offerHint").hidden=!expanded;
};
for (const [id, kind] of [
  ["wizardResume", "resumes"],
  ["wizardDocument", "documents"],
]) {
  const input = el(id);
  input.onchange = async () => {
    if (!input.files.length) return;
    el("next").disabled = input.disabled = true;
    try {
      const docIds = new FormData(form).getAll("document_ids"),
        resume = fields.resume_id.value;
      const file = await upload(kind, input.files[0]);
      if (kind === "documents") docIds.push(file.id);
      await choices(kind === "resumes" ? file.id : resume, docIds);
      el("wizardStatus").textContent = "Fichier importé et sélectionné.";
    } catch (e) {
      el("wizardStatus").textContent = e.message;
    } finally {
      el("next").disabled = input.disabled = false;
      input.value = "";
    }
  };
}
form.onsubmit = async (event) => {
  event.preventDefault();
  if (stage === 1) {
    if (fields.type.value !== "regular" && !fields.offer.value.trim()) {
      el("wizardStatus").textContent = "Ajoutez la description du poste.";
      fields.offer.focus();
      return;
    }
    if (new FormData(form).getAll("document_ids").length > 5) {
      el("wizardStatus").textContent = "Sélectionnez cinq documents maximum.";
      return;
    }
    showStage(true);
    fields.language.focus();
    return;
  }
  const data = new FormData(form),
    body = Object.fromEntries(data);
  body.document_ids = data.getAll("document_ids");
  body.total = Number(body.total);
  for (const key of ["auto_answer", "save_transcript", "web"])
    body[key] = data.has(key);
  el("next").disabled = true;
  try {
    const s = await api(root + "sessions", json("POST", body));
    wizard.close();
    if (config.remaining !== null) config.remaining--;
    credits();
    await render();
    if (s.context_truncated)
      notify("Les fichiers longs ont été abrégés pour cette session.");
    openSession(s);
  } catch (e) {
    el("wizardStatus").textContent = e.message;
  } finally {
    el("next").disabled = false;
  }
};
window.addEventListener("hashchange", render);
try {
  currentUser = await api("/api/account/me");
  config = await api(root + "config");
  await dashboard();
} catch (error) {
  if (error.status === 401)
    location.replace(
      "/connexion.html?retour=" +
        encodeURIComponent("/dashboard.html" + location.hash),
    );
  else notify(error.message);
}
