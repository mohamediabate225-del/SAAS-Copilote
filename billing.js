import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import express from "express";
import { db, requireUser, startTrial } from "./accounts.js";
import { equalSecret, limitRequests, secureRequest } from "./security.js";

db.exec(`CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer TEXT NOT NULL, plan TEXT NOT NULL, status TEXT NOT NULL, event_time INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0, audio_bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, day)
);
CREATE TABLE IF NOT EXISTS checkout_attempts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL, expires INTEGER NOT NULL
)`);

const plans = {
  plus: { label: "Plus", price: process.env.STRIPE_PRICE_PLUS, daily: 100 },
  pro: { label: "Pro", price: process.env.STRIPE_PRICE_PRO, daily: 300 },
};
const secret = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const baseUrl = process.env.APP_BASE_URL;
const enabled = Boolean(secret && webhookSecret && baseUrl && Object.values(plans).some(plan => plan.price));
const latestSubscription = db.prepare("SELECT * FROM subscriptions WHERE user_id=? ORDER BY status IN ('active','trialing') DESC, event_time DESC LIMIT 1");
const dayKey = () => new Date().toISOString().slice(0, 10);
const inUse = (subscription) => subscription && ["active", "trialing"].includes(subscription.status);

export function recordUsage(req, usage, audioBytes = 0) {
  db.prepare(`UPDATE ai_usage SET input_tokens=input_tokens+?, output_tokens=output_tokens+?,
    audio_bytes=audio_bytes+? WHERE user_id=? AND day=?`).run(
    usage?.prompt_tokens || usage?.input_tokens || 0, usage?.completion_tokens || usage?.output_tokens || 0, audioBytes, req.user.id, req.usageDay,
  );
}

export const aiLimits = [
  requireUser,
  limitRequests({ limit: 18, windowMs: 60000, key: req => req.user.id }),
  (req, res, next) => {
    const subscription = latestSubscription.get(req.user.id);
    const trial = inUse(subscription) ? null : startTrial(req.user);
    if (trial?.state === "expired") {
      return res.status(402).json({ error: "Votre essai de 10 minutes est terminé. Vos préparations et débriefs restent accessibles.", trial });
    }
    const daily = inUse(subscription) ? plans[subscription.plan]?.daily || 30 : trial?.active ? 120 : 30;
    req.usageDay = dayKey();
    const result = db.prepare(`INSERT INTO ai_usage (user_id,day,calls) VALUES (?,?,1)
      ON CONFLICT(user_id,day) DO UPDATE SET calls=calls+1 WHERE calls < ?`).run(req.user.id, req.usageDay, daily);
    if (!result.changes) {
      return res.status(429).json({ error: "Votre limite quotidienne d’appels IA est atteinte." });
    }
    next();
  },
];

async function stripe(path, params, idempotencyKey) {
  const headers = { Authorization: `Bearer ${secret}` };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? "POST" : "GET", headers,
    body: params ? new URLSearchParams(params) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Stripe HTTP ${response.status}`);
  return response.json();
}

function verifiedEvent(body, header) {
  if (!Buffer.isBuffer(body) || typeof header !== "string") return null;
  const elements = header.split(",");
  const time = elements.find(item => item.startsWith("t="))?.slice(2);
  if (!/^\d+$/.test(time || "") || Math.abs(Date.now() / 1000 - Number(time)) > 300) return null;
  const signature = createHmac("sha256", webhookSecret).update(`${time}.`).update(body).digest("hex");
  if (!elements.some(item => item.startsWith("v1=") && equalSecret(item.slice(3), signature))) return null;
  try { return JSON.parse(body.toString("utf8")); } catch { return null; }
}

export function registerBillingWebhook(app) {
  app.post("/api/billing/webhook", express.raw({ type: "application/json", limit: "256kb" }), async (req, res) => {
    if (!enabled) return res.sendStatus(503);
    const event = verifiedEvent(req.body, req.get("stripe-signature"));
    if (!event) return res.sendStatus(400);
    if (!["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      return res.sendStatus(204);
    }
    const incoming = event.data?.object;
    if (!/^sub_[a-zA-Z0-9]+$/.test(incoming?.id || "") || !Number.isSafeInteger(event.created)) return res.sendStatus(400);
    try {
      const subscription = await stripe(`subscriptions/${incoming.id}`);
      const reference = subscription.metadata?.copilote_reference;
      if (!reference) return res.sendStatus(204);
      const account = db.prepare("SELECT id FROM users WHERE billing_reference=?").get(reference);
      if (!account) return res.sendStatus(204);
      const price = subscription.items?.data?.[0]?.price?.id;
      const plan = Object.keys(plans).find(key => plans[key].price && plans[key].price === price) || "";
      db.prepare(`INSERT INTO subscriptions VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET plan=excluded.plan,status=excluded.status,event_time=excluded.event_time
        WHERE subscriptions.user_id=excluded.user_id AND subscriptions.event_time <= excluded.event_time`).run(
        incoming.id, account.id, subscription.customer, plan, plan ? subscription.status : "inactive", event.created,
      );
      res.sendStatus(204);
    } catch {
      res.sendStatus(502);
    }
  });
}

export function registerBilling(app) {
  app.get("/api/account/export", requireUser, (req, res) => {
    const { id, trial_eligible, ...account } = req.user;
    const byUser = (table, fields) => db.prepare(`SELECT ${fields} FROM ${table} WHERE user_id=?`).all(id);
    res.attachment("copilote-donnees.json").json({
      account,
      resumes: byUser("resumes", "id,name,content"),
      preparations: byUser("preparations", "resume_id,role,company,offer,notes"),
      practices: byUser("practice_sessions", "id,updated,data").map(({ data, ...item }) => ({ ...item, ...JSON.parse(data) })),
      onboarding: byUser("workspace_profiles", "purpose,discovery"),
      documents: byUser("documents", "id,name,content"),
      sessions: byUser("call_sessions","id,created,data,transcript").map(row=>({id:row.id,created:row.created,...JSON.parse(row.data),transcript:JSON.parse(row.transcript)})),
      usage: byUser("ai_usage", "day,calls,input_tokens,output_tokens,audio_bytes"),
    });
  });
  app.delete("/api/account/me", requireUser, limitRequests({ limit: 5, windowMs: 900000, key: req => req.user.id }), (req, res) => {
    const { salt, password_hash } = db.prepare("SELECT salt,password_hash FROM users WHERE id=?").get(req.user.id);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (password.length > 200 || !timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(password_hash, "hex"))) {
      return res.status(403).json({ error: "Le mot de passe est incorrect." });
    }
    if (db.prepare("SELECT 1 FROM subscriptions WHERE user_id=? AND status NOT IN ('canceled','incomplete_expired')").get(req.user.id)) {
      return res.status(409).json({ error: "Résiliez d’abord votre abonnement depuis le portail de facturation." });
    }
    if (db.prepare("SELECT 1 FROM checkout_attempts WHERE user_id=? AND expires>?").get(req.user.id, Math.floor(Date.now() / 1000))) {
      return res.status(409).json({ error: "Attendez l’expiration de votre session de paiement avant de supprimer votre compte." });
    }
    db.prepare("DELETE FROM users WHERE id=?").run(req.user.id);
    res.clearCookie("copilote_session", { httpOnly: true, sameSite: "strict", secure: secureRequest(req), path: "/" });
    res.status(204).end();
  });
  app.get("/api/billing/plans", async (_req, res) => {
    if (!enabled) return res.json({ enabled: false, plans: [] });
    try {
      const available = await Promise.all(Object.entries(plans).filter(([, plan]) => plan.price).map(async ([id, plan]) => {
        const result = await stripe(`prices/${encodeURIComponent(plan.price)}`);
        return { id, label: plan.label, daily: plan.daily, amount: result.unit_amount, currency: result.currency, interval: result.recurring?.interval, intervalCount: result.recurring?.interval_count, active: result.active };
      }));
      res.json({ enabled: true, plans: available.filter(plan => plan.active && plan.interval && Number.isInteger(plan.amount)) });
    } catch {
      res.status(502).json({ error: "Les offres sont temporairement indisponibles." });
    }
  });
  app.get("/api/billing/status", requireUser, (req, res) => {
    const subscription = latestSubscription.get(req.user.id);
    res.json({ enabled, active: Boolean(inUse(subscription)), portal: Boolean(enabled && subscription?.customer), plan: subscription?.plan || "" });
  });
  const limitBilling = limitRequests({ limit: 5, windowMs: 60000, key: req => req.user.id });
  app.post("/api/billing/checkout", requireUser, limitBilling, async (req, res) => {
    const planId = req.body?.plan;
    if (!enabled || typeof planId !== "string" || !Object.hasOwn(plans, planId) || !plans[planId].price) {
      return res.status(503).json({ error: "Cette offre n’est pas disponible." });
    }
    const subscription = latestSubscription.get(req.user.id);
    if (subscription && !["canceled", "incomplete_expired"].includes(subscription.status)) {
      return res.status(409).json({ error: "Gérez votre abonnement depuis votre espace." });
    }
    const now = Math.floor(Date.now() / 1000);
    db.prepare("DELETE FROM checkout_attempts WHERE user_id=? AND expires<=?").run(req.user.id, now);
    db.prepare("INSERT INTO checkout_attempts VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING").run(req.user.id, planId, now + 35 * 60);
    const attempt = db.prepare("SELECT plan,expires FROM checkout_attempts WHERE user_id=?").get(req.user.id);
    if (attempt.plan !== planId) {
      return res.status(409).json({ error: "Un paiement est déjà ouvert pour une autre offre. Retrouvez-le ou attendez son expiration." });
    }
    try {
      const { billing_reference } = db.prepare("SELECT billing_reference FROM users WHERE id=?").get(req.user.id);
      const session = await stripe("checkout/sessions", {
        mode: "subscription", "line_items[0][price]": plans[planId].price, "line_items[0][quantity]": "1",
        "subscription_data[metadata][copilote_reference]": billing_reference,
        expires_at: String(attempt.expires),
        success_url: new URL("/compte.html?facturation=confirmee", baseUrl).href,
        cancel_url: new URL("/tarifs.html", baseUrl).href,
        ...(subscription?.customer ? { customer: subscription.customer } : { customer_email: req.user.email }),
      }, `copilote-checkout-${billing_reference}-${attempt.expires}`);
      res.json({ url: session.url });
    } catch {
      res.status(502).json({ error: "Impossible d’ouvrir le paiement." });
    }
  });
  app.post("/api/billing/portal", requireUser, limitBilling, async (req, res) => {
    const subscription = latestSubscription.get(req.user.id);
    if (!enabled || !subscription?.customer) return res.status(404).json({ error: "Aucun abonnement disponible." });
    try {
      const portal = await stripe("billing_portal/sessions", {
        customer: subscription.customer, return_url: new URL("/compte.html", baseUrl).href,
      });
      res.json({ url: portal.url });
    } catch {
      res.status(502).json({ error: "Impossible d’ouvrir la facturation." });
    }
  });
}
