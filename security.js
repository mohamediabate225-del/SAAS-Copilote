import { db } from "./storage.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function equalSecret(left, right) {
  const hash = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(left), hash(right));
}

export function limitRequests({ limit, windowMs, key = (req) => req.ip, scope }) {
  return (req, res, next) => {
    const now = Date.now();
    const bucket = scope || req.method + ":" + req.baseUrl + (req.route?.path || req.path);
    const identity = createHash("sha256").update(String(key(req))).digest("hex");
    const entry = db.prepare(`INSERT INTO rate_limits(scope,identity,count,expires) VALUES(?,?,1,?)
      ON CONFLICT(scope,identity) DO UPDATE SET
      count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,
      expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END
      WHERE expires<=? OR count<? RETURNING count,expires`).get(bucket,identity,now+windowMs,now,now,now,limit);
    if (!entry) {
      const current = db.prepare("SELECT expires FROM rate_limits WHERE scope=? AND identity=?").get(bucket,identity);
      res.set("Retry-After",String(Math.max(1,Math.ceil((current.expires-now)/1000))));
      return res.status(429).json({error:"Trop de demandes. Réessayez dans quelques instants."});
    }
    next();
  };
}

export const isExtension = (origin = "") => Boolean(process.env.EXTENSION_ID &&
  /^[a-p]{32}$/.test(process.env.EXTENSION_ID) && origin === "chrome-extension://" + process.env.EXTENSION_ID);

export function secureRequest(req) {
  return process.env.NODE_ENV === "production" || req.secure || req.previewAccess === true;
}

export function apiSecurity(req, res, next) {
  res.set("Cache-Control", "no-store");
  const origin = req.get("origin");
  if (origin?.startsWith("chrome-extension://") && !isExtension(origin)) return res.status(403).json({error:"Extension non autorisée."});
  if (isExtension(origin) || (!origin && /^Bearer /.test(req.get("authorization")||""))) {
    // Extension requests are limited to scoped bearer tokens. Cookies never identify an extension user.
    res.vary("Origin");
    if(origin)res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    req.extensionRequest = true;
    if (!["/account/context", "/transcribe", "/answer", "/health"].includes(req.path)) {
      return res.status(403).json({ error: "Action indisponible depuis l’extension." });
    }
  } else if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const host = req.get("host");
    const expected = process.env.APP_BASE_URL
      ? new URL(process.env.APP_BASE_URL).origin
      : `${secureRequest(req) ? "https" : req.protocol}://${host}`;
    if ((origin && origin !== expected) || req.get("sec-fetch-site") === "cross-site") {
      return res.status(403).json({ error: "Origine de la requête refusée." });
    }
  }
  next();
}

export function createPreviewGate(secret) {
  const sign = (expires) => createHmac("sha256", secret).update(`preview:v1:${expires}`).digest("hex");
  return (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
    if (req.method === "GET" && typeof req.query.preview === "string" && equalSecret(req.query.preview, secret)) {
      const expires = Math.floor(Date.now() / 1000) + 86400;
      res.cookie("__Host-preview", `${expires}.${sign(expires)}`, {
        httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 86400000,
      });
      return res.redirect(303, "/");
    }
    const cookie = req.get("cookie")?.match(/(?:^|;\s*)__Host-preview=(\d{1,12})\.([a-f0-9]{64})(?:;|$)/);
    if (cookie && Number(cookie[1]) > Date.now() / 1000 && equalSecret(cookie[2], sign(cookie[1]))) {
      req.previewAccess = true;
      return next();
    }
    res.status(401).type("text").send("Lien de prévisualisation requis.");
  };
}
