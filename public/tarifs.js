import { api, json, showMessage } from "./app.js";

const status = document.querySelector("#billing-status");
const plans = document.querySelector("#plans");
const units = { day: "jour", week: "semaine", month: "mois", year: "an" };
function node(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
async function load() {
  const result = await api("/api/billing/plans");
  if (result.free_access) {
    document.querySelector("main").innerHTML = '<section class="surface"><h1>Tout est ouvert pendant les tests</h1><p>Profitez gratuitement du copilote, des simulations, des CV, des documents et des portraits.</p><p>Votre accès continue après les dix minutes et les dix premières sessions.</p><a class="action" href="/dashboard.html">Ouvrir mon tableau de bord</a></section>';
    return;
  }
  if (!result.plans.length) return;
  for (const plan of result.plans) {
    const article = node("article", "");
    article.className = "surface";
    const currency = new Intl.NumberFormat("fr-FR", { style: "currency", currency: plan.currency });
    const amount = currency.format(plan.amount / (10 ** currency.resolvedOptions().maximumFractionDigits));
    const interval = units[plan.interval] || plan.interval;
    const price = plan.intervalCount === 1 ? `${amount} / ${interval}` : `${amount} tous les ${plan.intervalCount} ${interval}s`;
    const button = node("button", "Choisir " + plan.label);
    button.className = "action";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const { url } = await api("/api/billing/checkout", json("POST", { plan: plan.id }));
        location.assign(url);
      } catch (error) {
        if (error.status === 401) { location.assign("/compte.html?retour=%2Ftarifs.html"); return; }
        showMessage(status, error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    article.append(node("h3", plan.label), node("p", price), node("p", `${plan.daily} actions IA par jour.`), button);
    plans.append(article);
  }
  document.querySelector("#paid-plans").hidden = false;
}
load().catch(error => showMessage(status, error.message, true));
