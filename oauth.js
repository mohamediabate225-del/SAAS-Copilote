import express from "express";
import { verifyEmail, consumeInvitation } from "./registration.js";
import { randomBytes, randomUUID, scryptSync, createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db, session } from "./accounts.js";
import { limitRequests } from "./security.js";

const providers = {
  google: {
    issuer: "https://accounts.google.com",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    keys: "https://www.googleapis.com/oauth2/v3/certs",
  },
  apple: {
    issuer: "https://appleid.apple.com",
    authorize: "https://appleid.apple.com/auth/authorize",
    token: "https://appleid.apple.com/auth/token",
    keys: "https://appleid.apple.com/auth/keys",
  },
};
for (const provider of Object.values(providers))
  provider.jwks = createRemoteJWKSet(new URL(provider.keys));
const random = () => randomBytes(32).toString("base64url");
const digest = (value) =>
  createHash("sha256").update(value).digest("base64url");
db.exec(`CREATE TABLE IF NOT EXISTS identities(provider TEXT NOT NULL, subject TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(provider,subject));
CREATE TABLE IF NOT EXISTS oauth_attempts(state TEXT PRIMARY KEY, cookie TEXT NOT NULL, nonce TEXT NOT NULL, provider TEXT NOT NULL, expires INTEGER NOT NULL);`);
function settings(name) {
  if (
    !Object.hasOwn(providers, name) ||
    !process.env.APP_BASE_URL?.startsWith("https://") ||
    process.env.APP_PASSWORD
  )
    return null;
  const client = process.env[name.toUpperCase() + "_CLIENT_ID"],
    secret = process.env[name.toUpperCase() + "_CLIENT_SECRET"];
  if (!client || !secret) return null;
  return {
    ...providers[name],
    client,
    secret,
    callback: new URL("/auth/return/" + name, process.env.APP_BASE_URL).href,
  };
}
const cookie = "__Host-copilote-oauth",
  options = { secure: true, httpOnly: true, sameSite: "none", path: "/" };
function resolveUser(name, claims) {
  const linked = db
    .prepare("SELECT user_id FROM identities WHERE provider=? AND subject=?")
    .get(name, claims.sub);
  if (linked) return linked.user_id;
  const email = String(claims.email || "")
    .trim()
    .toLowerCase();
  if (
    ![true, "true"].includes(claims.email_verified) ||
    !email.includes("@") ||
    email.length > 254
  )
    throw new Error();
  if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
    throw new Error("existing");
  consumeInvitation(null);
  const salt = random(),
    hash = scryptSync(random(), salt, 64).toString("hex");
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        "INSERT INTO users(email,salt,password_hash,first_name,last_name,trial_eligible,billing_reference) VALUES(?,?,?,?,?,1,?)",
      )
      .run(
        email,
        salt,
        hash,
        String(claims.given_name || "").slice(0, 100),
        String(claims.family_name || "").slice(0, 100),
        randomUUID(),
      );
    db.prepare("INSERT INTO identities VALUES(?,?,?)").run(
      name,
      claims.sub,
      row.lastInsertRowid,
    );
    verifyEmail(row.lastInsertRowid);
    db.exec("COMMIT");
    return row.lastInsertRowid;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
async function finish(req, res) {
  res.set("Cache-Control", "no-store");
  const name = req.params.provider,
    cfg = settings(name),
    incoming = req.method === "POST" ? req.body : req.query;
  const browser = req
    .get("cookie")
    ?.match(/(?:^|;\s*)__Host-copilote-oauth=([\w-]{43})(?:;|$)/)?.[1];
  try {
    if (
      !cfg ||
      !browser ||
      typeof incoming?.code !== "string" ||
      typeof incoming.state !== "string"
    )
      throw new Error();
    const attempt = db
      .prepare(
        "DELETE FROM oauth_attempts WHERE state=? AND cookie=? AND provider=? AND expires>? RETURNING nonce",
      )
      .get(incoming.state, digest(browser), name, Date.now());
    if (!attempt) throw new Error();
    const result = await fetch(cfg.token, {
      method: "POST",
      body: new URLSearchParams({
        code: incoming.code,
        client_id: cfg.client,
        client_secret: cfg.secret,
        redirect_uri: cfg.callback,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) throw new Error();
    const { id_token } = await result.json();
    const { payload } = await jwtVerify(id_token, cfg.jwks, {
      issuer: cfg.issuer,
      audience: cfg.client,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub", "nonce"],
    });
    if (
      payload.nonce !== attempt.nonce ||
      typeof payload.sub !== "string" ||
      (payload.azp && payload.azp !== cfg.client)
    )
      throw new Error();
    const id = resolveUser(name, payload);
    session(req, res, id);
    res.clearCookie(cookie, options);
    res.redirect(303, "/dashboard.html");
  } catch (e) {
    res.clearCookie(cookie, options);
    res.redirect(
      303,
      "/connexion.html?oauth=" +
        (e.message === "existing" ? "existing" : "failed"),
    );
  }
}
export function mountOAuthCallbacks(app) {
  app.get("/auth/return/:provider", finish);
  app.post(
    "/auth/return/:provider",
    express.urlencoded({ extended: false, limit: "16kb" }),
    finish,
  );
}
export function mountOAuthStart(app) {
  app.get("/api/account/providers", (_req, res) =>
    res.json(Object.keys(providers).filter(settings)),
  );
  app.get(
    "/auth/start/:provider",
    limitRequests({ limit: 25, windowMs: 900000 }),
    (req, res) => {
      const name = req.params.provider,
        cfg = settings(name);
      if (!cfg) return res.sendStatus(404);
      const state = random(),
        nonce = random(),
        browser = random();
      db.prepare("DELETE FROM oauth_attempts WHERE expires<=?").run(Date.now());
      db.prepare("INSERT INTO oauth_attempts VALUES(?,?,?,?,?)").run(
        state,
        digest(browser),
        nonce,
        name,
        Date.now() + 600000,
      );
      res.cookie(cookie, browser, { ...options, maxAge: 600000 });
      const url = new URL(cfg.authorize);
      url.search = new URLSearchParams({
        client_id: cfg.client,
        redirect_uri: cfg.callback,
        response_type: "code",
        scope: name === "apple" ? "name email" : "openid email profile",
        state,
        nonce,
        ...(name === "apple" ? { response_mode: "form_post" } : {}),
      });
      res.set("Cache-Control", "no-store").redirect(url.href);
    },
  );
}
