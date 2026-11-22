import { stripe, paymentsEnabled, registerPaymentsWebhook } from "./payments.js";
export const registerBillingWebhook = registerPaymentsWebhook;
import { meterContext, quotaStatus, catalog } from "./quotas.js";
import { freeAccess } from "./access.js";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { db, requireUser } from "./accounts.js";
import { limitRequests, secureRequest } from "./security.js";

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

const baseUrl = process.env.APP_BASE_URL || "http://localhost:3100";
const subscriptionColumns=db.prepare("PRAGMA table_info(subscriptions)").all().map(x=>x.name);
for(const [name,type] of [["period_start","INTEGER"],["period_end","INTEGER"],["cancel_at_period_end","INTEGER NOT NULL DEFAULT 0"]])
  if(!subscriptionColumns.includes(name))db.exec(`ALTER TABLE subscriptions ADD COLUMN ${name} ${type}`);
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
  limitRequests({limit:120,windowMs:60000,key:req=>req.user.id,scope:"ai"}),
  (req,res,next) => {
    const status=quotaStatus(req.user.id);
    if(!status.local_beta && db.prepare("SELECT count(*) n FROM consents WHERE user_id=? AND version='2026-11-21' AND document IN ('cgu','confidentialite')").get(req.user.id).n!==2)
      return res.status(403).json({error:"Acceptez les CGU et la confidentialité depuis Mon compte pour continuer."});
    if(!status.local_beta&&!status.email_verified)return res.status(403).json({error:"Vérifiez votre adresse e-mail depuis Mon compte avant de démarrer."});
    if(!status.allowances.some(x=>x.remaining_seconds>0 && x.cost_remaining>0 && x.tokens_remaining>0))
      return res.status(402).json({error:"Votre crédit IA est épuisé ou expiré. Consultez vos offres dans Mon compte."});
    req.usageDay=dayKey();
    db.prepare("INSERT INTO ai_usage(user_id,day,calls) VALUES(?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET calls=calls+1").run(req.user.id,req.usageDay);
    meterContext.run(req,next);
  }
];

export function registerBilling(app) {
  app.get("/api/account/usage",requireUser,(req,res)=>res.json(quotaStatus(req.user.id)));
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
      usage: byUser("usage","id,type,model,state,created_at,audio_seconds,billable_seconds,input_tokens,output_tokens,estimated_cost_usd"),
      consents: byUser("consents","document,version,accepted_at"),
      entitlements: byUser("entitlements","plan_id,starts,ends,active"),
      subscriptions: byUser("subscriptions","plan,status,period_start,period_end,cancel_at_period_end"),
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
  app.get("/api/billing/plans", (_req,res)=>res.json({enabled:paymentsEnabled(),free_access:freeAccess,
    test_mode:!process.env.STRIPE_SECRET_KEY||process.env.STRIPE_SECRET_KEY.startsWith("sk_test_"),
    plans:catalog().map(p=>({id:p.id,label:p.label,mode:p.mode,amount:p.amount_cents,currency:"EUR",minutes:p.minutes,valid_days:p.valid_days,live_questions:p.live_questions,daily_audio_minutes:p.daily_audio_minutes,available:p.mode==="free"||(paymentsEnabled()&&Boolean(p.stripe_price_id))}))}));
  app.get("/api/billing/status", requireUser, (req, res) => {
    const subscription = latestSubscription.get(req.user.id);
    res.json({free_access:freeAccess,enabled:paymentsEnabled(),active:Boolean(inUse(subscription)),portal:Boolean(paymentsEnabled()&&subscription?.customer),plan:subscription?.plan||"",usage:quotaStatus(req.user.id)});
  });
  const limitBilling = limitRequests({ limit: 5, windowMs: 60000, key: req => req.user.id });
  app.post("/api/billing/checkout", requireUser, limitBilling, async (req, res) => {
    const planId = req.body?.plan;
    const plan=catalog().find(p=>p.id===planId && p.mode!=="free");
    if (!paymentsEnabled() || !plan?.stripe_price_id) {
      return res.status(503).json({ error: "Cette offre n’est pas disponible." });
    }
    const subscription = latestSubscription.get(req.user.id);
    if (plan.mode==="subscription" && subscription && !["canceled", "incomplete_expired"].includes(subscription.status)) {
      return res.status(409).json({ error: "Gérez votre abonnement depuis votre espace." });
    }
    if(!req.user.email_verified_at)return res.status(403).json({error:"Vérifiez votre adresse e-mail avant de payer."});
    if(req.body?.accept_cgv!==true)return res.status(400).json({error:"Acceptez les CGV avant de continuer vers Stripe."});
    db.prepare("INSERT OR IGNORE INTO consents VALUES(?,?,?,?)").run(req.user.id,"cgv","2026-11-21",Date.now());
    const now = Math.floor(Date.now() / 1000);
    db.prepare("DELETE FROM checkout_attempts WHERE user_id=? AND expires<=?").run(req.user.id, now);
    db.prepare("INSERT INTO checkout_attempts VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING").run(req.user.id, planId, now + 35 * 60);
    const attempt = db.prepare("SELECT plan,expires FROM checkout_attempts WHERE user_id=?").get(req.user.id);
    if (attempt.plan !== planId) {
      return res.status(409).json({ error: "Un paiement est déjà ouvert pour une autre offre. Retrouvez-le ou attendez son expiration." });
    }
    try {
      const { billing_reference } = db.prepare("SELECT billing_reference FROM users WHERE id=?").get(req.user.id);
      const price=await stripe("prices/"+encodeURIComponent(plan.stripe_price_id));
      if(!price.active || price.currency!=="eur" || price.unit_amount!==plan.amount_cents || price.tax_behavior!=="inclusive" ||
        (plan.mode==="subscription" && (price.recurring?.interval!=="month"||price.recurring?.interval_count!==1)) || (plan.mode==="payment" && price.recurring))
        return res.status(503).json({error:"Ce tarif nécessite une vérification avant paiement."});
      const session = await stripe("checkout/sessions", {
        mode: plan.mode, "line_items[0][price]": plan.stripe_price_id, "line_items[0][quantity]": "1",
        "metadata[copilote_reference]":billing_reference,"metadata[plan_id]":plan.id,
        ...(plan.mode==="subscription"?{"subscription_data[metadata][copilote_reference]":billing_reference}:{}),
        ...(process.env.STRIPE_TAX_ENABLED==="true"?{"automatic_tax[enabled]":"true"}:{}),
        expires_at: String(attempt.expires),
        success_url: new URL("/paiement-succes.html", baseUrl).href,
        cancel_url: new URL("/paiement-annule.html", baseUrl).href,
        ...(subscription?.customer ? { customer: subscription.customer } : { customer_email: req.user.email }),
      }, `copilote-checkout-${billing_reference}-${attempt.expires}`);
      res.json({ url: session.url });
    } catch {
      res.status(502).json({ error: "Impossible d’ouvrir le paiement." });
    }
  });
  app.post("/api/billing/portal", requireUser, limitBilling, async (req, res) => {
    const subscription = latestSubscription.get(req.user.id);
    if (!paymentsEnabled() || !subscription?.customer) return res.status(404).json({ error: "Aucun abonnement disponible." });
    try {
      const portal = await stripe("billing_portal/sessions", {
        customer: subscription.customer, return_url: new URL("/compte.html", baseUrl).href,
        ...(db.prepare("SELECT value FROM payment_settings WHERE name='portal_configuration'").get()?.value ? {configuration:db.prepare("SELECT value FROM payment_settings WHERE name='portal_configuration'").get().value}:{}),
      });
      res.json({ url: portal.url });
    } catch {
      res.status(502).json({ error: "Impossible d’ouvrir la facturation." });
    }
  });
}
