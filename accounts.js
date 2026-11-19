import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { PDFParse } from "pdf-parse";
import nodemailer from "nodemailer";

const db = new DatabaseSync(process.env.COPILOTE_DB_PATH || "copilote-local.sqlite");
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, goals TEXT DEFAULT '', salary TEXT DEFAULT '', notes TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resumes (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS preparations (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, resume_id INTEGER, role TEXT DEFAULT '', company TEXT DEFAULT '', offer TEXT DEFAULT '', notes TEXT DEFAULT '');`);
const columns = db.prepare("PRAGMA table_info(users)").all().map(column => column.name);
if (!columns.includes("first_name")) db.exec("ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT ''");
if (!columns.includes("last_name")) db.exec("ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT ''");
db.exec("CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL)");
const resetAttempts = new Map();
const digest = value => createHash("sha256").update(value).digest("hex");
function current(req) {
  const match = (req.headers.cookie || "").match(/(?:^|;\s*)copilote_session=([a-f0-9]{64})(?:;|$)/);
  return match && db.prepare("SELECT users.id, users.email, users.first_name, users.last_name, users.goals, users.salary, users.notes FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>?").get(digest(match[1]), Date.now());
}
function requireUser(req, res, next) {
  req.user = current(req);
  if (!req.user) return res.status(401).json({ error: "Connectez-vous pour continuer." });
  next();
}
function session(res, id) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(digest(token), id, Date.now() + 86400000 * 7);
  res.setHeader("Set-Cookie", `copilote_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
}
export function registerAccounts(app, upload) {
  app.post("/api/account/register", (req, res) => {
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
      const row = db.prepare("INSERT INTO users(email,salt,password_hash,first_name,last_name) VALUES(?,?,?,?,?)").run(email, salt, hash, firstName, lastName);
      session(res, row.lastInsertRowid); res.json({ok:true});
    } catch { res.status(400).json({error:"Impossible de créer le compte. Vérifiez vos informations."}); }
  });
  app.post("/api/account/forgot-password", async (req,res) => {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, APP_BASE_URL } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM || !APP_BASE_URL) return res.status(503).json({error:"L’envoi d’emails n’est pas encore configuré sur ce prototype."});
    const ip = req.ip || "local", now = Date.now();
    const attempts = (resetAttempts.get(ip) || []).filter(time => now - time < 15 * 60 * 1000);
    if (attempts.length >= 5) return res.status(429).json({error:"Trop de demandes. Réessayez dans 15 minutes."});
    attempts.push(now); resetAttempts.set(ip, attempts);
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
  app.post("/api/account/reset-password", (req,res) => {
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
      db.exec("COMMIT"); res.json({ok:true});
    } catch { db.exec("ROLLBACK"); res.status(500).json({error:"Impossible de modifier le mot de passe."}); }
  });
  app.post("/api/account/login", (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(String(req.body?.email || "").trim().toLowerCase());
    const password = String(req.body?.password || "").slice(0,200);
    const computed = scryptSync(password, user?.salt || "00000000000000000000000000000000", 64);
    if (!user || !timingSafeEqual(computed, Buffer.from(user.password_hash,"hex"))) return res.status(401).json({error:"Email ou mot de passe incorrect."});
    session(res,user.id); res.json({ok:true});
  });
  app.post("/api/account/logout", (req,res) => {
    const match=(req.headers.cookie||"").match(/(?:^|;\s*)copilote_session=([a-f0-9]{64})(?:;|$)/);
    if(match) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(match[1]));
    res.setHeader("Set-Cookie","copilote_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); res.json({ok:true});
  });
  app.get("/api/account/me",requireUser,(req,res)=>res.json(req.user));
  app.put("/api/account/profile",requireUser,(req,res)=>{
    const fields=["goals","salary","notes"].map(k=>String(req.body?.[k]||"").slice(0,12000));
    db.prepare("UPDATE users SET goals=?,salary=?,notes=? WHERE id=?").run(...fields,req.user.id);res.json({ok:true});
  });
  app.get("/api/account/resumes",requireUser,(req,res)=>res.json(db.prepare("SELECT id,name,content FROM resumes WHERE user_id=? ORDER BY id DESC").all(req.user.id)));
  app.post("/api/account/resumes",requireUser,upload.single("pdf"),async(req,res)=>{
    try {
      let content=String(req.body?.content||"").trim();
      if(req.file){
        if(req.file.mimetype!=="application/pdf" || req.file.buffer.subarray(0,5).toString()!=="%PDF-") return res.status(400).json({error:"Choisissez un fichier PDF valide."});
        const parser=new PDFParse({data:req.file.buffer});
        try { content=(await parser.getText()).text.trim(); } finally { await parser.destroy(); }
      }
      if(!content) return res.status(400).json({error:"Aucun texte trouvé. Collez le texte si le PDF est une image."});
      const name=String(req.body?.name||req.file?.originalname||"Mon CV").slice(0,120);
      const row=db.prepare("INSERT INTO resumes(user_id,name,content) VALUES(?,?,?)").run(req.user.id,name,content.slice(0,50000));
      res.json({id:Number(row.lastInsertRowid),name});
    }catch{res.status(400).json({error:"Impossible de lire ce PDF. Essayez de coller le texte du CV."});}
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
