import { quotaStatus, localBeta } from "./quotas.js";
import { acceptDocuments, consumeInvitation, sendVerification } from "./registration.js";
import { db } from "./storage.js";
export { db };
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { PDFParse } from "pdf-parse";
import nodemailer from "nodemailer";
import { limitRequests, secureRequest } from "./security.js";

db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, goals TEXT DEFAULT '', salary TEXT DEFAULT '', notes TEXT DEFAULT '', trial_started INTEGER);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resumes (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS preparations (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, resume_id INTEGER, role TEXT DEFAULT '', company TEXT DEFAULT '', offer TEXT DEFAULT '', notes TEXT DEFAULT '');`);
const columns = db.prepare("PRAGMA table_info(users)").all().map(column => column.name);
if (!columns.includes("first_name")) db.exec("ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT ''");
if (!columns.includes("last_name")) db.exec("ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT ''");
if (!columns.includes("trial_started")) db.exec("ALTER TABLE users ADD COLUMN trial_started INTEGER");
if (!columns.includes("trial_eligible")) db.exec("ALTER TABLE users ADD COLUMN trial_eligible INTEGER NOT NULL DEFAULT 0");
if (!columns.includes("billing_reference")) db.exec("ALTER TABLE users ADD COLUMN billing_reference TEXT");
const assignReference = db.prepare("UPDATE users SET billing_reference=? WHERE id=? AND billing_reference IS NULL");
for (const { id } of db.prepare("SELECT id FROM users WHERE billing_reference IS NULL").all()) assignReference.run(randomUUID(), id);
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS account_billing_reference ON users(billing_reference)");
db.exec("CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL)");
db.exec(`CREATE TABLE IF NOT EXISTS extension_tokens (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL
)`);
const digest = value => createHash("sha256").update(value).digest("hex");
const cookieToken = (req) => req.get("cookie")?.match(/(?:^|;\s*)copilote_session=([a-f0-9]{64})(?:;|$)/)?.[1];
if (!columns.includes("email_verified_at")) db.exec("ALTER TABLE users ADD COLUMN email_verified_at INTEGER");
const publicFields = "users.id, users.email, users.first_name, users.last_name, users.goals, users.salary, users.notes, users.trial_started, users.trial_eligible, users.email_verified_at";
const sessionUser = db.prepare(`SELECT ${publicFields} FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>?`);
const extensionUser = db.prepare(`SELECT ${publicFields} FROM extension_tokens JOIN users ON users.id=extension_tokens.user_id WHERE token_hash=? AND expires>?`);
function current(req) {
  if (req.extensionRequest) {
    const token = req.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    return token && extensionUser.get(digest(token), Date.now());
  }
  const token = cookieToken(req);
  return token && sessionUser.get(digest(token), Date.now());
}

export function trialStatus(user) {
  if(localBeta)return {active:true,state:"free",remaining_seconds:null,total_seconds:null};
  const status=quotaStatus(user.id);
  return {active:status.remaining_seconds>0,state:!status.email_verified?"unverified":status.remaining_seconds>0?"active":"expired",
    remaining_seconds:status.remaining_seconds,total_seconds:status.allowances.reduce((sum,e)=>sum+e.minutes*60,0),
    expires_at:status.allowances.length?Math.min(...status.allowances.map(e=>e.ends)):null};
}
export function startTrial(user) { return trialStatus(user); }

export function requireUser(req, res, next) {
  req.user = current(req);
  if (!req.user) return res.status(401).json({ error: "Connectez-vous pour continuer." });
  next();
}
export function session(req, res, id) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM sessions WHERE expires<=? OR token_hash=?").run(Date.now(), digest(cookieToken(req) || ""));
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(digest(token), id, Date.now() + 86400000 * 7);
  const secure = secureRequest(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `copilote_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`);
}
const accountLimit = (limit) => limitRequests({ limit, windowMs: 15 * 60 * 1000 });

export function registerAccounts(app, upload) {
  app.post("/api/account/register", accountLimit(8), async (req, res) => {
    if (![true,"on"].includes(req.body?.accept_terms)) return res.status(400).json({error:"Acceptez les CGU et la politique de confidentialité."});
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const firstName = String(req.body?.first_name || "").trim();
    const lastName = String(req.body?.last_name || "").trim();
    if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) return res.status(400).json({error:"Renseignez votre prénom et votre nom."});
    if (password !== String(req.body?.password_confirmation || "")) return res.status(400).json({error:"Les mots de passe ne correspondent pas."});
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 10 || password.length > 200) return res.status(400).json({error:"Email valide et mot de passe de 10 caractères minimum requis."});
    try {
      const salt = randomBytes(16).toString("hex");
      const hash = scryptSync(password, salt, 64).toString("hex");
      db.exec("BEGIN IMMEDIATE");
      consumeInvitation(req.body?.invitation_code);
      const row = db.prepare("INSERT INTO users(email,salt,password_hash,first_name,last_name,trial_eligible,billing_reference) VALUES(?,?,?,?,?,1,?)").run(email, salt, hash, firstName, lastName, randomUUID());
      acceptDocuments(row.lastInsertRowid);
      db.exec("COMMIT");
      session(req, res, row.lastInsertRowid);
      const verification_sent=await sendVerification(row.lastInsertRowid);
      res.status(201).json({ok:true,verification_sent});
    } catch(error) { if(db.isTransaction)db.exec("ROLLBACK");res.status(error.status||400).json({error:error.status===403?error.message:"Impossible de créer le compte. Vérifiez vos informations."}); }
  });
  app.post("/api/account/forgot-password", accountLimit(5), async (req,res) => {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, APP_BASE_URL } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM || !APP_BASE_URL) return res.status(503).json({error:"L’envoi d’emails n’est pas encore configuré sur ce prototype."});
    const now = Date.now();
    if (![true,"on"].includes(req.body?.accept_terms)) return res.status(400).json({error:"Acceptez les CGU et la politique de confidentialité."});
    const email = String(req.body?.email || "").trim().toLowerCase();
    const user = db.prepare("SELECT id FROM users WHERE email=?").get(email);
    if (user) {
      const token = randomBytes(32).toString("hex");
      db.prepare("DELETE FROM password_resets WHERE user_id=? OR expires<?").run(user.id, now);
      db.prepare("INSERT INTO password_resets VALUES (?,?,?)").run(digest(token), user.id, now + 30 * 60 * 1000);
      try {
        const transport = nodemailer.createTransport({host:SMTP_HOST,port:Number(SMTP_PORT),secure:Number(SMTP_PORT)===465,auth:{user:SMTP_USER,pass:SMTP_PASSWORD}});
        const url = new URL("/mot-de-passe.html", APP_BASE_URL); url.hash = token;
        await transport.sendMail({from:SMTP_FROM,to:email,subject:"Réinitialisation de votre mot de passe",text:`Pour choisir un nouveau mot de passe, ouvrez ce lien dans les 30 minutes :\n${url.href}\nSi vous n’êtes pas à l’origine de cette demande, ignorez cet email.`});
      } catch { console.error("Échec de l’envoi de l’email de réinitialisation."); }
    }
    res.json({ok:true});
  });
  app.post("/api/account/reset-password", accountLimit(10), (req,res) => {
    const token = String(req.body?.token || ""), password = String(req.body?.password || "");
    if (!/^[a-f0-9]{64}$/.test(token) || password.length < 10 || password.length > 200 || password !== String(req.body?.password_confirmation || "")) return res.status(400).json({error:"Vérifiez le lien et les deux mots de passe (10 caractères minimum)."});
    const entry = db.prepare("SELECT user_id FROM password_resets WHERE token_hash=? AND expires>?").get(digest(token), Date.now());
    if (!entry) return res.status(400).json({error:"Lien invalide ou expiré. Demandez un nouveau lien."});
    const salt = randomBytes(16).toString("hex"), hash = scryptSync(password, salt, 64).toString("hex");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE users SET salt=?,password_hash=? WHERE id=?").run(salt,hash,entry.user_id);
      db.prepare("DELETE FROM password_resets WHERE user_id=?").run(entry.user_id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(entry.user_id);
      db.prepare("DELETE FROM extension_tokens WHERE user_id=?").run(entry.user_id);
      db.exec("COMMIT"); res.json({ok:true});
    } catch { db.exec("ROLLBACK"); res.status(500).json({error:"Impossible de modifier le mot de passe."}); }
  });
  app.post("/api/account/login", accountLimit(20), (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(String(req.body?.email || "").trim().toLowerCase());
    const password = String(req.body?.password || "");
    if (password.length > 200) return res.status(401).json({error:"Email ou mot de passe incorrect."});
    const computed = scryptSync(password, user?.salt || "00000000000000000000000000000000", 64);
    if (!user || !timingSafeEqual(computed, Buffer.from(user.password_hash,"hex"))) return res.status(401).json({error:"Email ou mot de passe incorrect."});
    session(req, res, user.id); res.json({ok:true});
  });
  app.post("/api/account/logout", (req,res) => {
    const match=(req.headers.cookie||"").match(/(?:^|;\s*)copilote_session=([a-f0-9]{64})(?:;|$)/);
    if(match) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(match[1]));
    const secure = secureRequest(req) ? "; Secure" : "";
    res.setHeader("Set-Cookie", `copilote_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`); res.json({ok:true});
  });
  app.get("/api/account/me",requireUser,(req,res)=>res.json(req.user));
  app.get("/api/account/trial", requireUser, (req, res) => res.json(trialStatus(req.user)));
  app.get("/api/account/context", requireUser, (req, res) => {
    const preparation = db.prepare(`SELECT p.resume_id, p.role, p.company, p.offer, p.notes, r.content
      FROM preparations p LEFT JOIN resumes r ON r.id=p.resume_id AND r.user_id=p.user_id WHERE p.user_id=?`).get(req.user.id) || {};
    const { content, ...settings } = preparation;
    const { id, first_name, goals, salary, notes } = req.user;
    res.json({ id, first_name, ...settings, profile: [
      content, goals && `Métiers recherchés : ${goals}`, salary && `Salaire recherché : ${salary}`, notes, settings.notes,
    ].filter(Boolean).join("\n\n") });
  });
  app.post("/api/account/extension", requireUser, (req, res) => {
    const token = randomBytes(32).toString("hex");
    const expires = Date.now() + 7 * 86400000;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM extension_tokens WHERE user_id=? OR expires<=?").run(req.user.id, Date.now());
      db.prepare("INSERT INTO extension_tokens VALUES (?, ?, ?)").run(digest(token), req.user.id, expires);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.status(201).json({ token, expires_at: expires });
  });
  app.delete("/api/account/extension", requireUser, (req, res) => {
    db.prepare("DELETE FROM extension_tokens WHERE user_id=?").run(req.user.id);
    res.json({ ok: true });
  });
  app.put("/api/account/profile",requireUser,(req,res)=>{
    const fields=["goals","salary","notes"].map(k=>String(req.body?.[k]||"").slice(0,12000));
    db.prepare("UPDATE users SET goals=?,salary=?,notes=? WHERE id=?").run(...fields,req.user.id);res.json({ok:true});
  });
  app.get("/api/account/resumes",requireUser,(req,res)=>res.json(db.prepare("SELECT id,name,content FROM resumes WHERE user_id=? ORDER BY id DESC").all(req.user.id)));
  app.post("/api/account/resumes",requireUser,upload.single("pdf"),async(req,res)=>{
    try {
      if(db.prepare('SELECT COUNT(*) AS n FROM resumes WHERE user_id=?').get(req.user.id).n>=50)return res.status(409).json({error:"Limite de 50 CV atteinte. Supprimez une ancienne version."});
      let content=String(req.body?.content||"").trim();
      if(req.file){
        if (/\.txt$/i.test(req.file.originalname)) {
          content = new TextDecoder('utf-8', { fatal: true }).decode(req.file.buffer).trim();
          if (content.includes('\0')) return res.status(400).json({error:"Choisissez un fichier texte UTF-8 valide."});
        } else {
        if(req.file.mimetype!=="application/pdf" || req.file.buffer.subarray(0,5).toString()!=="%PDF-") return res.status(400).json({error:"Choisissez un fichier PDF valide."});
        const parser=new PDFParse({data:req.file.buffer});
        try { content=(await parser.getText()).text.trim(); } finally { await parser.destroy(); }
        }
      }
      if(!content) return res.status(400).json({error:"Aucun texte trouvé. Collez le texte si le PDF est une image."});
      const name=String(req.body?.name||req.file?.originalname||"Mon CV").slice(0,120);
      const row=db.prepare("INSERT INTO resumes(user_id,name,content) VALUES(?,?,?)").run(req.user.id,name,content.slice(0,50000));
      if(req.file) db.prepare('UPDATE resumes SET original=?,mime=? WHERE id=?').run(req.file.buffer,/\.txt$/i.test(req.file.originalname)?'text/plain':'application/pdf',row.lastInsertRowid);
      res.json({id:Number(row.lastInsertRowid),name,content:content.slice(0,50000)});
    }catch{res.status(400).json({error:"Impossible de lire ce PDF. Essayez de coller le texte du CV."});}
  });
  app.delete("/api/account/resumes/:id", requireUser, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "CV invalide." });
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE preparations SET resume_id=NULL WHERE user_id=? AND resume_id=?").run(req.user.id, id);
      db.prepare("DELETE FROM resumes WHERE user_id=? AND id=?").run(req.user.id, id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.status(204).end();
  });
  app.get("/api/account/preparation",requireUser,(req,res)=>res.json(db.prepare("SELECT resume_id,role,company,offer,notes FROM preparations WHERE user_id=?").get(req.user.id)||{}));
  app.put("/api/account/preparation",requireUser,(req,res)=>{
    const id=Number(req.body?.resume_id)||null;
    if(id&&!db.prepare("SELECT id FROM resumes WHERE id=? AND user_id=?").get(id,req.user.id))return res.status(400).json({error:"CV introuvable."});
    const values=["role","company","offer","notes"].map(k=>String(req.body?.[k]||"").slice(0,30000));
    db.prepare("INSERT INTO preparations(user_id,resume_id,role,company,offer,notes) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET resume_id=excluded.resume_id,role=excluded.role,company=excluded.company,offer=excluded.offer,notes=excluded.notes").run(req.user.id,id,...values);
    res.json({ok:true});
  });
}
