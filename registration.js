import { createHash, createHmac, randomBytes } from 'node:crypto';
import { db } from './storage.js';
import { grant } from './quotas.js';
import { mailReady, sendMail } from './mailer.js';
import { limitRequests } from './security.js';

export const DOCUMENT_VERSION='2026-11-21';
db.exec(`CREATE TABLE IF NOT EXISTS consents (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, document TEXT NOT NULL,
 version TEXT NOT NULL, accepted_at INTEGER NOT NULL, PRIMARY KEY(user_id,document,version)
);
CREATE TABLE IF NOT EXISTS email_verifications (
 token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trial_registry (email_hash TEXT PRIMARY KEY, claimed_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invitations (code_hash TEXT PRIMARY KEY, remaining INTEGER NOT NULL, expires INTEGER NOT NULL);`);
const digest=value=>createHash('sha256').update(value).digest('hex');
const emailHash=email=>createHmac('sha256',process.env.TRIAL_IDENTITY_SECRET||'local-development-only').update(email.trim().toLowerCase()).digest('hex');
export function acceptDocuments(userId) {
  for(const document of ['cgu','confidentialite'])db.prepare('INSERT OR IGNORE INTO consents VALUES(?,?,?,?)').run(userId,document,DOCUMENT_VERSION,Date.now());
}
export function consumeInvitation(code) {
  if(process.env.INVITATION_REQUIRED!=='true')return;
  const result=db.prepare('UPDATE invitations SET remaining=remaining-1 WHERE code_hash=? AND expires>? AND remaining>0').run(digest(String(code||'')),Date.now());
  if(!result.changes)throw Object.assign(new Error('Un code d’invitation valide est requis pour cette bêta.'),{status:403});
}
export function verifyEmail(userId) {
  const user=db.prepare('SELECT email,email_verified_at FROM users WHERE id=?').get(userId);
  if(!user || user.email_verified_at)return;
  const now=Date.now();
  db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(now,userId);
  const claimed=db.prepare('INSERT OR IGNORE INTO trial_registry VALUES(?,?)').run(emailHash(user.email),now);
  if(claimed.changes) {
    const plan=db.prepare("SELECT valid_days FROM plans WHERE id='free'").get();
    grant(userId,'free','trial:'+emailHash(user.email),now,now+plan.valid_days*86400000);
  }
}
export async function sendVerification(userId) {
  if(!mailReady())return false;
  const user=db.prepare('SELECT email,email_verified_at FROM users WHERE id=?').get(userId);
  if(!user||user.email_verified_at)return true;
  const token=randomBytes(32).toString('hex');
  db.prepare('DELETE FROM email_verifications WHERE user_id=?').run(userId);
  db.prepare('INSERT INTO email_verifications VALUES(?,?,?)').run(digest(token),userId,Date.now()+86400000);
  const url=new URL('/verification.html',process.env.APP_BASE_URL);url.hash=token;
  try {await sendMail(user.email,'Confirmez votre adresse e-mail · COPILOTE.IA',`Confirmez votre adresse en ouvrant ce lien dans les 24 heures :\n${url.href}\nVotre essai démarre après confirmation. Si vous n’avez pas créé ce compte, ignorez ce message.`);return true;}
  catch {return false;}
}
export function registerVerification(app,requireUser) {
  app.get('/api/account/verification',requireUser,(req,res)=>res.json({verified:Boolean(req.user.email_verified_at),sending_available:mailReady(),document_version:DOCUMENT_VERSION,accepted:db.prepare("SELECT count(*) n FROM consents WHERE user_id=? AND version=? AND document IN ('cgu','confidentialite')").get(req.user.id,DOCUMENT_VERSION).n===2}));
  app.post('/api/account/verification/send',requireUser,limitRequests({limit:3,windowMs:3600000,key:req=>req.user.id}),async(req,res)=>{
    if(!await sendVerification(req.user.id))return res.status(503).json({error:'L’envoi d’e-mails n’est pas encore disponible. Votre compte et vos préparations restent accessibles.'});
    res.json({ok:true});
  });
  app.post('/api/account/verification/confirm',limitRequests({limit:20,windowMs:900000}),(req,res)=>{
    const token=String(req.body?.token||'');
    if(!/^[a-f0-9]{64}$/.test(token))return res.status(400).json({error:'Lien invalide ou expiré.'});
    db.exec('BEGIN IMMEDIATE');
    try {
      const entry=db.prepare('SELECT user_id FROM email_verifications WHERE token_hash=? AND expires>?').get(digest(token),Date.now());
      if(!entry){db.exec('ROLLBACK');return res.status(400).json({error:'Lien invalide ou expiré.'});}
      verifyEmail(entry.user_id);
      db.prepare('DELETE FROM email_verifications WHERE user_id=?').run(entry.user_id);
      db.exec('COMMIT');res.json({ok:true});
    }catch(error){db.exec('ROLLBACK');throw error;}
  });
  app.post('/api/account/consents',requireUser,(req,res)=>{
    if(req.body?.accepted!==true)return res.status(400).json({error:'Veuillez lire et accepter les documents.'});
    acceptDocuments(req.user.id);res.json({ok:true});
  });
}
