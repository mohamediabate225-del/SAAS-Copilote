const token = location.hash.slice(1);
if (token) {
  history.replaceState(null, "", location.pathname);
  document.querySelector("#request").hidden = true;
  document.querySelector("#reset").hidden = false;
}
for (const type of ["request", "reset"]) document.querySelector("#" + type).addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget, status = document.querySelector("#status");
  const data = Object.fromEntries(new FormData(form));
  if (type === "reset" && data.password !== data.password_confirmation) { status.textContent = "Les mots de passe ne correspondent pas."; return; }
  if (type === "reset") data.token = token;
  try {
    const response = await fetch("/api/account/" + (type === "request" ? "forgot-password" : "reset-password"), { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    form.reset();
    status.textContent = type === "request" ? "Si un compte correspond à cette adresse, un email vous sera envoyé." : "Mot de passe modifié. Vous pouvez vous connecter.";
    if (type === "reset") form.hidden = true;
  } catch (error) { status.textContent = error.message || "Une erreur est survenue."; }
});
