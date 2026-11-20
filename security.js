import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function equalSecret(left, right) {
  const hash = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(left), hash(right));
}

export function limitRequests({ limit, windowMs, key = (req) => req.ip }) {
  const entries = new Map();
  let sweepAt = 0;

  return (req, res, next) => {
    const now = Date.now();
    if (now >= sweepAt) {
      for (const [id, entry] of entries) if (entry.expires <= now) entries.delete(id);
      sweepAt = now + windowMs;
    }
    const id = key(req);
    let entry = entries.get(id);
    if (!entry || entry.expires <= now) {
      entry = { count: 0, expires: now + windowMs };
      entries.set(id, entry);
    }
    if (entry.count >= limit) {
      res.set("Retry-After", String(Math.ceil((entry.expires - now) / 1000)));
      return res.status(429).json({ error: "Trop de demandes. Réessayez dans quelques instants." });
    }
    entry.count++;
    next();
  };
}

export const isExtension = (origin = "") => /^chrome-extension:\/\/[a-p]{32}$/.test(origin);

export function secureRequest(req) {
  return process.env.NODE_ENV === "production" || req.secure || req.previewAccess === true;
}

export function apiSecurity(req, res, next) {
  res.set("Cache-Control", "no-store");
  const origin = req.get("origin");
  if (isExtension(origin)) {
    // Extension requests are limited to scoped bearer tokens. Cookies never identify an extension user.
    res.vary("Origin");
    res.set("Access-Control-Allow-Origin", origin);
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
