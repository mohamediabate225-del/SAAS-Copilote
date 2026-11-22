import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { db } from './storage.js';

export const meterContext = new AsyncLocalStorage();
export const localBeta = process.env.NODE_ENV !== 'production' && process.env.BILLING_ENABLED !== 'true';
db.exec(`CREATE TABLE IF NOT EXISTS plans (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, mode TEXT NOT NULL, amount_cents INTEGER NOT NULL,
 minutes REAL NOT NULL CHECK(minutes>=0), valid_days INTEGER NOT NULL, live_questions INTEGER,
 daily_audio_minutes REAL NOT NULL DEFAULT 30, token_limit INTEGER NOT NULL DEFAULT 500000,
 cost_limit_usd REAL NOT NULL DEFAULT 5, stripe_price_id TEXT, enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS entitlements (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan_id TEXT NOT NULL REFERENCES plans(id), source TEXT UNIQUE NOT NULL,
 starts INTEGER NOT NULL, ends INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS usage (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 entitlement_id TEXT REFERENCES entitlements(id) ON DELETE CASCADE, type TEXT NOT NULL,
 model TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
 audio_seconds REAL NOT NULL DEFAULT 0, billable_seconds REAL NOT NULL DEFAULT 0,
 live_questions INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0,
 output_tokens INTEGER NOT NULL DEFAULT 0, reserved_tokens INTEGER NOT NULL DEFAULT 0,
 estimated_cost_usd REAL NOT NULL DEFAULT 0, receipt_used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS usage_user_date ON usage(user_id,created_at);
CREATE INDEX IF NOT EXISTS usage_entitlement ON usage(entitlement_id,state);`);
const seed = db.prepare('INSERT OR IGNORE INTO plans(id,label,mode,amount_cents,minutes,valid_days,live_questions,token_limit,cost_limit_usd) VALUES(?,?,?,?,?,?,?,?,?)');
for (const plan of [
 ['free','Gratuit','free',0,15,7,5,100000,1],
 ['sprint','Pass Sprint','payment',900,90,14,null,300000,3],
 ['essentiel','Essentiel','subscription',1400,150,31,null,600000,5],
 ['pro','Pro','subscription',2900,400,31,null,1500000,10],
 ['beta','Bêta locale','hidden',0,400,31,null,1500000,10],
]) seed.run(...plan);

export function quotaError(message,status=429) { return Object.assign(new Error(message),{status,quota:true}); }
export function catalog() {return db.prepare("SELECT * FROM plans WHERE enabled=1 AND mode!='hidden' ORDER BY amount_cents").all();}
export function grant(userId,plan,source,starts,ends) {
  db.prepare('INSERT OR IGNORE INTO entitlements(id,user_id,plan_id,source,starts,ends) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(),userId,plan,source,starts,ends);
}
function entitlement(userId, now) {
  if (localBeta) {
    const month = new Date(now).toISOString().slice(0,7);
    const starts = Date.parse(month+'-01T00:00:00Z');
    const next = new Date(starts);next.setUTCMonth(next.getUTCMonth()+1);
    grant(userId,'beta',`beta:${userId}:${month}`,starts,next.getTime());
  }
  return db.prepare(`SELECT e.*,p.label,p.minutes,p.live_questions,p.daily_audio_minutes,p.token_limit,p.cost_limit_usd
    FROM entitlements e JOIN plans p ON p.id=e.plan_id
    WHERE e.user_id=? AND e.active=1 AND e.starts<=? AND e.ends>? AND p.enabled=1
    ORDER BY (p.mode='hidden' AND ?) DESC, p.amount_cents DESC,e.ends ASC`).all(userId,now,now,Number(localBeta));
}
function total(id) {
  return db.prepare(`SELECT coalesce(sum(billable_seconds),0) seconds,coalesce(sum(live_questions),0) questions,
    coalesce(sum(CASE WHEN state IN ('pending','uncertain') THEN reserved_tokens ELSE input_tokens+output_tokens END),0) tokens,
    coalesce(sum(estimated_cost_usd),0) cost FROM usage WHERE entitlement_id=? AND state!='failed'`).get(id);
}
export function quotaStatus(userId) {
  const now=Date.now(), entries=entitlement(userId,now);
  const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  // DST-safe civil day comparison, also used by reservations.
  const daily = db.prepare("SELECT audio_seconds,created_at FROM usage WHERE user_id=? AND created_at>? AND state!='failed' AND audio_seconds>0")
    .all(userId,now-27*3600000).filter(row => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(row.created_at)===day)
    .reduce((sum,row)=>sum+row.audio_seconds,0);
  const allowances=entries.map(entry=>{const used=total(entry.id);return {...entry,remaining_seconds:Math.max(0,entry.minutes*60-used.seconds),remaining_questions:entry.live_questions==null?null:Math.max(0,entry.live_questions-used.questions),tokens_remaining:Math.max(0,entry.token_limit-used.tokens),cost_remaining:Math.max(0,entry.cost_limit_usd-used.cost),used};});
  return {local_beta:localBeta,allowances,remaining_seconds:allowances.reduce((s,e)=>s+e.remaining_seconds,0),daily_audio_seconds:daily,
    daily_audio_limit_seconds:allowances.length?Math.max(...allowances.map(e=>e.daily_audio_minutes*60)):1800,
    email_verified:Boolean(db.prepare('SELECT email_verified_at FROM users WHERE id=?').get(userId)?.email_verified_at)};
}

// Rates are estimates in USD, configurable separately from selling prices. No content is stored here.
export function estimateCost(model,input,output,audioSeconds=0,type='chat') {
  if(type==='local') return 0;
  if(type==='audio') return audioSeconds/60*Number(process.env.AUDIO_USD_PER_MINUTE||0.006);
  if(type==='image') return Number(process.env.IMAGE_USD_PER_REQUEST||0.25);
  const rates = model.includes('mini') ? [0.4,1.6] : [2,8];
  const configured=JSON.parse(process.env.AI_COST_RATES_JSON||'{}')[model];
  return input/1e6*(configured?.input??rates[0])+output/1e6*(configured?.output??rates[1])+(type==='web'?0.03:0);
}
export function reserve(req,type,params) {
  if(!req?.user?.id)throw quotaError('Connectez-vous pour continuer.',401);
  const now=Date.now();
  const audio=type==='audio'?req.audioSeconds||0:0;
  if(type==='audio'&&!audio)throw quotaError('La durée audio doit être vérifiée.',400);
  const feedback=req.path==='/api/training/feedback';
  const receipts=feedback&&Array.isArray(req.body?.speech_receipts)?[...new Set(req.body.speech_receipts)].slice(0,20):[];
  const valid=receipts.map(id=>db.prepare("SELECT id FROM usage WHERE id=? AND user_id=? AND type='audio' AND state='succeeded' AND receipt_used=0 AND created_at>?").get(id,req.user.id,now-86400000)).filter(Boolean);
  const seconds=audio||(feedback && !valid.length?60:0);
  const questions=req.path==='/api/answer'&&!req.questionMetered?1:0;
  const input=type==='local'?0:type==='audio'?Math.ceil(audio*100)+1024:type==='web'?65536:Buffer.byteLength(JSON.stringify(params.messages||params.input||''),'utf8')+2048;
  const output=type==='local'?0:type==='audio'?Math.ceil(audio*20)+256:params.max_completion_tokens||params.max_output_tokens||1024;
  const cost=estimateCost(params.model,input,output,audio,type);
  db.exec('BEGIN IMMEDIATE');
  try {
    const status=quotaStatus(req.user.id);
    if(!localBeta&&!status.email_verified)throw quotaError('Vérifiez votre adresse e-mail dans Mon compte avant de démarrer.',403);
    if(audio+status.daily_audio_seconds>status.daily_audio_limit_seconds)throw quotaError('Votre plafond audio quotidien est atteint. Réessayez demain (heure de Paris).');
    const entry=status.allowances.find(e=>e.remaining_seconds>=seconds && e.remaining_seconds>0 &&
      (e.remaining_questions==null||e.remaining_questions>=questions) && e.tokens_remaining>=input+output && e.cost_remaining>=cost);
    if(!entry)throw quotaError('Votre crédit ou plafond IA est atteint, ou votre accès a expiré. Consultez Mon compte et les offres.',402);
    const id=randomUUID();
    db.prepare('INSERT INTO usage(id,user_id,entitlement_id,type,model,state,created_at,audio_seconds,billable_seconds,live_questions,reserved_tokens,estimated_cost_usd) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,req.user.id,entry.id,type,params.model,'pending',now,audio,seconds,questions,input+output,cost);
    for(const receipt of valid)db.prepare('UPDATE usage SET receipt_used=1 WHERE id=?').run(receipt.id);
    db.exec('COMMIT');req.questionMetered ||= questions>0;
    return {id,model:params.model,type,audio,input,output,cost,receipts:valid.map(x=>x.id)};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function settle(reservation,result,state='succeeded') {
  const u=result?.usage;
  const input=u?.prompt_tokens??u?.input_tokens??reservation.input;
  const output=u?.completion_tokens??u?.output_tokens??reservation.output;
  const cost=state==='failed'?0:estimateCost(reservation.model,input,output,reservation.audio,reservation.type);
  db.prepare('UPDATE usage SET state=?,input_tokens=?,output_tokens=?,estimated_cost_usd=? WHERE id=?')
    .run(state,input,output,cost,reservation.id);
  if(state==='failed')for(const id of reservation.receipts)db.prepare('UPDATE usage SET receipt_used=0 WHERE id=?').run(id);
}
export function meteredClient(client) {
  const wrap=(fn,type)=>async(params,...args)=>{
    const req=meterContext.getStore(), reservation=reserve(req,type,params);
    try {
      const result=await fn({...params,...(type==='chat'||type==='web'?{store:false}:{})},...args);
      req.lastUsageId=reservation.id;
      if(params.stream) {
        return (async function*(){let usage,complete=false;try{for await(const chunk of result){if(chunk.usage)usage=chunk.usage;yield chunk;}complete=true;}
          finally{settle(reservation,{usage},complete?'succeeded':'uncertain');}})();
      }
      settle(reservation,result);return result;
    }catch(error){settle(reservation,null,error.status && error.status<500?'failed':'uncertain');throw error;}
  };
  return {chat:{completions:{create:wrap(client.chat.completions.create.bind(client.chat.completions),'chat')}},
    audio:{transcriptions:{create:wrap(client.audio.transcriptions.create.bind(client.audio.transcriptions),'audio')}},
    responses:{create:wrap(client.responses.create.bind(client.responses),'web')},
    images:{edit:wrap(client.images.edit.bind(client.images),'image')}};
}
