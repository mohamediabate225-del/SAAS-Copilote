import { api, apiFetch, json } from "./app.js";
const urls = {
  resumes: "/api/account/resumes",
  documents: "/api/workspace/documents",
};
export function element(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
export function action(text, callback, cls) {
  const b = element("button", text, cls);
  b.type = "button";
  b.onclick = async () => {
    b.disabled = true;
    try {
      await callback();
    } catch (error) {
      notify(error.message);
    } finally {
      b.disabled = false;
    }
  };
  return b;
}
let noticeTimer;
export function notify(text) {
  const n = document.getElementById("notice");
  n.textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    n.textContent = "";
  }, 9000);
}
export async function upload(kind, file) {
  if (!file || file.size > 8 * 1024 * 1024)
    throw new Error("Choisissez un fichier PDF ou TXT de 8 Mo maximum.");
  const data = new FormData();
  data.set(kind === "resumes" ? "pdf" : "file", file);
  return api(urls[kind], { method: "POST", body: data });
}
let objectUrl,
  previewVersion = 0;
export function clearPreview() {
  previewVersion++;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
}
function extractedSections(text) {
  const sections = document.createElement("div");
  sections.className = "extracted-sections";
  let lines = [];
  function flush() {
    if (lines.length) {
      sections.append(element("pre", lines.join("\n")));
      lines = [];
    }
  }
  const heading =
    /^(?:(?:expériences?|experience)(?: professionnelles?)?|formations?|éducation|education|compétences(?: techniques)?|skills|profil|résumé|summary|langues|languages|certifications?|projets|projects|outils(?: \/ logiciels)?|contact|centres d.intérêt)\s*[:：]?$/i;
  for (const line of text.split(/\r?\n/)) {
    if (heading.test(line.trim())) {
      flush();
      sections.append(element("h4", line.trim()));
    } else lines.push(line);
  }
  flush();
  return sections;
}
async function preview(container, item, kind) {
  clearPreview();
  const version = previewVersion;
  const grid = element("div", undefined, "file-grid"),
    original = element("article", undefined, "pane"),
    extracted = element("article", undefined, "pane");
  original.append(element("h3", item.name));
  extracted.append(
    element("h3", "Texte lu par l’IA"),
    element("p", "Extrait du fichier et utilisé pour préparer vos réponses."),
    extractedSections(item.content),
  );
  grid.append(original, extracted);
  container.replaceChildren(grid);
  const r = await apiFetch(
    "/api/workspace/files/" + kind + "/" + encodeURIComponent(item.id),
  );
  if (version !== previewVersion) return;
  if (r.status === 404) {
    original.append(
      element("p", "Seul le texte a été conservé lors de cet import."),
    );
    return;
  }
  if (!r.ok) throw new Error("Impossible de charger le fichier.");
  const blob = await r.blob();
  if (version !== previewVersion) return;
  objectUrl = URL.createObjectURL(blob);
  const link = element("a", "Télécharger l’original", "button");
  link.href = objectUrl;
  link.download = item.name;
  original.append(link);
  if (blob.type.startsWith("application/pdf")) {
    const frame = element("iframe");
    frame.title = "Aperçu de " + item.name;
    frame.src = objectUrl;
    original.append(frame);
  } else original.append(element("pre", await blob.text()));
}
export async function library(host, kind) {
  const files = await api(urls[kind]),
    isCV = kind === "resumes";
  const panel = element("section", undefined, "pane");
  panel.append(
    element(
      "h2",
      isCV ? "Votre bibliothèque de CV" : "Vos documents complémentaires",
    ),
    element(
      "p",
      isCV
        ? "Importez un CV et vérifiez le texte que le copilote utilisera."
        : "Ajoutez une lettre, des notes ou un portfolio pour vos prochaines sessions.",
    ),
  );
  const label = element(
      "label",
      "Importer un fichier PDF ou TXT · 8 Mo maximum",
    ),
    input = element("input");
  input.type = "file";
  input.accept = ".pdf,.txt";
  label.append(input);
  panel.append(label);
  const list = element("div"),
    detail = element("div");
  host.replaceChildren(panel, list, detail);
  const draw = (file) => {
    const line = element("div", undefined, "listing");
    line.append(
      element("strong", file.name),
      action("Consulter", () => preview(detail, file, kind)),
    );
    line.append(
      action("Supprimer", async () => {
        if (!confirm("Supprimer ce fichier de votre bibliothèque ?")) return;
        await api(urls[kind] + "/" + file.id, { method: "DELETE" });
        line.remove();
        clearPreview();
        detail.replaceChildren();
      }),
    );
    list.prepend(line);
  };
  files.slice().reverse().forEach(draw);
  input.onchange = async () => {
    if (!input.files.length) return;
    input.disabled = true;
    try {
      const file = await upload(kind, input.files[0]);
      draw(file);
      await preview(detail, file, kind);
    } catch (e) {
      notify(e.message);
    } finally {
      input.value = "";
      input.disabled = false;
    }
  };
}
export async function maker(host) {
  const files = await api(urls.resumes);
  host.innerHTML =
    '<section class="pane"><h2>Éditeur de CV</h2><p>Choisissez une version, adaptez-la au poste et enregistrez votre brouillon.</p><div class="form-stack"><label>CV de départ<select id="source"><option value="">Saisir un nouveau CV</option></select></label><label>Poste cible<input id="target" maxlength="200"></label><label>Nom du CV<input id="cvname" maxlength="120" value="Mon CV"></label><label>Contenu<textarea id="content" rows="12" maxlength="50000"></textarea></label><div class="row" id="actions"></div></div></section>';
  const by = (id) => host.querySelector("#" + id),
    select = by("source"),
    content = by("content");
  files.forEach((file) => select.add(new Option(file.name, file.id)));
  select.onchange = () => {
    const file = files.find((f) => String(f.id) === select.value);
    content.value = file?.content || "";
    by("cvname").value = file ? file.name + " · version adaptée" : "Mon CV";
  };
  by("actions").append(
    action(
      "Reformuler avec l’IA",
      async () => {
        const text = content.value;
        const r = await api(
          "/api/workspace/rewrite-resume",
          json("POST", { content: text, role: by("target").value }),
        );
        if (!r.text) throw new Error("Aucune reformulation reçue.");
        if (content.value === text) content.value = r.text;
      },
      "primary",
    ),
    action("Enregistrer dans mes CV", async () => {
      if (!content.value.trim())
        throw new Error("Renseignez le contenu du CV.");
      const data = new FormData();
      data.set("name", by("cvname").value);
      data.set("content", content.value);
      await api(urls.resumes, { method: "POST", body: data });
      notify("Nouvelle version enregistrée dans Mes CV.");
    }),
    action("Télécharger le texte", () => {
      const url = URL.createObjectURL(
        new Blob([content.value], { type: "text/plain" }),
      );
      const a = element("a");
      a.href = url;
      a.download = (by("cvname").value || "CV") + ".txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }),
  );
}
export function portraits(host) {
  host.innerHTML =
    '<section class="pane"><h2>Portrait professionnel</h2><p>Choisissez une photo de vous ou une photo que vous êtes autorisé à utiliser. Elle sera transmise à OpenAI à la génération.</p><form class="form-stack"><label>Photo de départ<input type="file" name="photo" required accept="image/png,image/jpeg,image/webp"></label><label>Style<select name="style"><option value="formal">Studio classique</option><option value="casual">Professionnel décontracté</option></select></label><button class="primary">Générer le portrait</button></form><div id="result" role="status"></div></section>';
  const form = host.querySelector("form"),
    result = host.querySelector("#result");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = form.querySelector("button");
    b.disabled = true;
    result.textContent = "Génération en cours…";
    try {
      if (form.photo.files[0].size > 8 * 1024 * 1024)
        throw new Error("Taille maximale de 8 Mo.");
      const r = await api("/api/workspace/portrait", {
        method: "POST",
        body: new FormData(form),
      });
      const img = element("img", undefined, "portrait-result");
      img.src = r.image;
      img.alt = "Votre portrait généré";
      const a = element("a", "Télécharger le portrait", "button");
      a.href = r.image;
      a.download = "portrait.png";
      result.replaceChildren(img, a);
    } catch (e) {
      result.textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
}
