import express from 'express';
import { createHmac } from 'node:crypto';
import { db } from './storage.js';
import { equalSecret } from './security.js';
import { grant } from './quotas.js';
import { mailReady, sendMail } from './mailer.js';

db.exec(`CREATE TABLE IF NOT EXISTS payment_settings(name TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stripe_events(id TEXT PRIMARY KEY,type TEXT NOT NULL,processed_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS stripe_prices(price_id TEXT PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES plans(id));
CREATE TABLE IF NOT EXISTS payment_emails(event_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,sent INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0);`);
export const paymentsEnabled=()=>process.env.BILLING_ENABLED==='true' && Boolean(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_WEBHOOK_SECRET&&process.env.APP_BASE_URL);
export async function stripe(path, params, idempotencyKey) {
  const secret=process.env.STRIPE_SECRET_KEY;
  if(!secret)throw new Error('Stripe is not configured');
  if(!secret.startsWith('sk_test_') && process.env.STRIPE_LIVE_ENABLED!=='true')throw new Error('Live payments disabled');
  // The test fixture cannot be selected outside NODE_ENV=test.
  const base=process.env.NODE_ENV==='test'&&process.env.STRIPE_TEST_API_URL?process.env.STRIPE_TEST_API_URL:'https://api.stripe.com/v1/';
  const response=await fetch(base+path,{method:params?'POST':'GET',headers:{Authorization:`Bearer ${secret}`,...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:params?new URLSearchParams(params):undefined,signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('Stripe HTTP '+response.status);
  return response.json();
}
export function verifiedEvent(body,header,secret=process.env.STRIPE_WEBHOOK_SECRET,now=Date.now()) {
  if(!secret||!Buffer.isBuffer(body)||typeof header!=='string')return null;
  const fields=header.split(','),time=fields.find(x=>x.startsWith('t='))?.slice(2);
  if(!/^\d+$/.test(time||'')||Math.abs(now/1000-Number(time))>300)return null;
  const signature=createHmac('sha256',secret).update(time+'.').update(body).digest('hex');
  if(!fields.some(x=>x.startsWith('v1=')&&equalSecret(x.slice(3),signature)))return null;
  try{return JSON.parse(body.toString('utf8'));}catch{return null;}
}
function planFor(price) {
  return db.prepare('SELECT p.* FROM plans p LEFT JOIN stripe_prices s ON s.plan_id=p.id WHERE p.stripe_price_id=? OR s.price_id=? LIMIT 1').get(price,price);
}
function accountFor(reference) {return db.prepare('SELECT id FROM users WHERE billing_reference=?').get(reference||'');}
export async function processEvent(event,requestStripe=stripe) {
  if(!/^evt_[\w]+$/.test(event?.id||'')||!Number.isSafeInteger(event.created))throw new Error('Invalid event');
  if(db.prepare('SELECT 1 FROM stripe_events WHERE id=?').get(event.id))return;
  let apply=()=>{};
  const obj=event.data?.object;
  if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) {
    if(!/^cs_[\w]+$/.test(obj?.id||''))throw new Error('Invalid checkout');
    const checkout=await requestStripe(`checkout/sessions/${obj.id}?expand[]=line_items`);
    if(checkout.mode==='payment'&&checkout.payment_status==='paid') {
      const plan=planFor(checkout.line_items?.data?.[0]?.price?.id),account=accountFor(checkout.metadata?.copilote_reference);
      if(!account||!plan||plan.mode!=='payment'||checkout.currency!=='eur')throw new Error('Unknown paid checkout');
      const starts=event.created*1000;
      apply=()=>{
        grant(account.id,plan.id,'checkout:'+checkout.id,starts,starts+plan.valid_days*86400000);
        db.prepare('DELETE FROM checkout_attempts WHERE user_id=?').run(account.id);
        db.prepare('INSERT OR IGNORE INTO payment_emails(event_id,user_id,kind) VALUES(?,?,?)').run('checkout:'+checkout.id,account.id,'payment');
      };
    }
  } else if(event.type.startsWith('customer.subscription.')||event.type==='invoice.paid'||event.type==='invoice.payment_failed') {
    const id=event.type.startsWith('customer.subscription.')?obj?.id:obj?.subscription||obj?.parent?.subscription_details?.subscription;
    if(!/^sub_[\w]+$/.test(id||''))throw new Error('Invalid subscription');
    const subscription=await requestStripe(`subscriptions/${id}?expand[]=latest_invoice`);
    const item=subscription.items?.data?.[0],plan=planFor(item?.price?.id),account=accountFor(subscription.metadata?.copilote_reference);
    if(!account||!plan||plan.mode!=='subscription')throw new Error('Unknown subscription');
    const starts=Number(item?.current_period_start||subscription.current_period_start)*1000;
    const ends=Number(item?.current_period_end||subscription.current_period_end)*1000;
    if(!Number.isFinite(starts)||!Number.isFinite(ends)||ends<=starts)throw new Error('Invalid billing period');
    const paid=subscription.latest_invoice?.status==='paid';
    apply=()=>{
      const previous=db.prepare('SELECT event_time FROM subscriptions WHERE id=?').get(id);
      if(previous&&previous.event_time>event.created)return;
      db.prepare(`INSERT INTO subscriptions(id,user_id,customer,plan,status,event_time,period_start,period_end,cancel_at_period_end) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status,plan=excluded.plan,event_time=excluded.event_time,period_start=excluded.period_start,period_end=excluded.period_end,cancel_at_period_end=excluded.cancel_at_period_end WHERE subscriptions.user_id=excluded.user_id`)
        .run(id,account.id,subscription.customer,plan.id,subscription.status,event.created,starts,ends,Number(Boolean(subscription.cancel_at_period_end)));
      const active=['active','trialing'].includes(subscription.status);
      if(active&&paid)grant(account.id,plan.id,`subscription:${id}:${starts}`,starts,ends);
      if(!active)db.prepare('UPDATE entitlements SET active=0 WHERE user_id=? AND source LIKE ?').run(account.id,`subscription:${id}:%`);
      // A late invoice.paid restores only its current period, never resets consumed usage.
      if(active&&paid)db.prepare('UPDATE entitlements SET active=1 WHERE user_id=? AND source=?').run(account.id,`subscription:${id}:${starts}`);
      db.prepare('DELETE FROM checkout_attempts WHERE user_id=?').run(account.id);
      if(event.type==='invoice.paid'||event.type==='invoice.payment_failed'||event.type==='customer.subscription.deleted')
        db.prepare('INSERT OR IGNORE INTO payment_emails(event_id,user_id,kind) VALUES(?,?,?)').run(event.id,account.id,event.type);
    };
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    if(!db.prepare('SELECT 1 FROM stripe_events WHERE id=?').get(event.id)){
      apply();db.prepare('INSERT INTO stripe_events VALUES(?,?,?)').run(event.id,event.type,Date.now());
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function registerPaymentsWebhook(app) {
  app.post('/api/billing/webhook',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{
    if(!paymentsEnabled())return res.sendStatus(503);
    const event=verifiedEvent(req.body,req.get('stripe-signature'));
    if(!event)return res.sendStatus(400);
    try {await processEvent(event);res.sendStatus(204);}
    catch {res.sendStatus(502);}
  });
}
let mailing=false;
export async function flushPaymentEmails() {
  if(mailing||!mailReady())return;
  mailing=true;
  try {
    for(const job of db.prepare('SELECT e.*,u.email FROM payment_emails e JOIN users u ON u.id=e.user_id WHERE sent=0 AND attempts<8 AND next_attempt<=? LIMIT 10').all(Date.now())) {
      const text=job.kind==='invoice.payment_failed'?'Votre paiement a échoué. Vérifiez votre moyen de paiement depuis Mon compte.':job.kind==='customer.subscription.deleted'?'Votre abonnement a pris fin. Vos préparations restent accessibles.':'Votre paiement est confirmé. Vos crédits sont disponibles dans Mon compte.';
      try {await sendMail(job.email,'Votre accès · COPILOTE.IA',text+'\n'+new URL('/compte.html',process.env.APP_BASE_URL).href);db.prepare('UPDATE payment_emails SET sent=1 WHERE event_id=?').run(job.event_id);}
      catch {db.prepare('UPDATE payment_emails SET attempts=attempts+1,next_attempt=? WHERE event_id=?').run(Date.now()+Math.min(86400000,60000*2**job.attempts),job.event_id);}
    }
  }finally{mailing=false;}
}
