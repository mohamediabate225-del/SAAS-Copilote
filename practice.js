import { db, requireUser } from "./accounts.js";

export const criteria = {
  relevance: "Pertinence",
  structure: "Structure",
  specificity: "Précision",
  impact: "Impact",
  clarity: "Clarté",
};

export const clean = (value, size) => typeof value === "string" ? value.trim().slice(0, size) : "";
export function cleanContext(value = {}) {
  return {
    role: clean(value?.role, 200),
    company: clean(value?.company, 200),
    profile: clean(value?.profile, 16000),
    offer: clean(value?.offer, 16000),
    model: clean(value?.model, 100),
    instructions: clean(value?.instructions, 3000),
    style: ['concise','detailed','bullets'].includes(value?.style) ? value.style : 'concise',
    language: ["fr", "en", "es", "de"].includes(value?.language) ? value.language : "auto",
  };
}

export function cleanCoach(data) {
  const scores = Object.fromEntries(Object.keys(criteria).map((id) => {
    const score = data?.scores?.[id];
    if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error("Invalid coach score");
    return [id, score];
  }));
  const summary = clean(data.summary, 800);
  const model = clean(data.model, 2500);
  const list = (values) => Array.isArray(values) ? values.slice(0, 3).map((value) => clean(value, 350)).filter(Boolean) : [];
  const strengths = list(data.strengths);
  const improvements = list(data.improvements);
  if (!summary || !model || !strengths.length || !improvements.length) throw new Error("Incomplete coach response");
  return { summary, model, strengths, improvements, scores };
}

function cleanDelivery(value, answer) {
  if (!value || !Number.isFinite(value.duration) || value.duration < 1 || value.duration > 180) return null;
  const words = answer.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || [];
  const fillers = answer.match(/(?:^|[^\p{L}])(?:euh+|heu+|hum+|um+|uh+)(?=$|[^\p{L}])/giu) || [];
  const duration = Math.round(value.duration);
  return {
    duration,
    words: words.length,
    words_per_minute: Math.round(words.length * 60 / duration),
    thinking_seconds: Number.isFinite(value.thinking_seconds) ? Math.max(0, Math.min(3600, Math.round(value.thinking_seconds))) : null,
    fillers: fillers.length,
  };
}

export function normalizePractice(data) {
  const total = data?.total === 3 ? 3 : 5;
  const status = data?.status === "completed" ? "completed" : "draft";
  const turns = Array.isArray(data?.turns) ? data.turns.slice(0, total).map((item) => {
    const q = clean(item?.q, 2000);
    const a = clean(item?.a, 6000);
    if (!q || !a) throw new Error("Tour incomplet.");
    return { q, a, coach: cleanCoach(item.coach), delivery: cleanDelivery(item.delivery, a) };
  }) : [];
  if (status === "completed" && turns.length !== total) throw new Error("La simulation est encore incomplète.");
  return {
    status, total, turns, context: cleanContext(data?.context),
    question: clean(data?.question, 2000), answer: clean(data?.answer, 6000),
    delivery: cleanDelivery(data?.delivery, clean(data?.answer, 6000)),
  };
}

db.exec(`CREATE TABLE IF NOT EXISTS practice_sessions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL, version INTEGER NOT NULL, updated INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (user_id,id)
);
CREATE INDEX IF NOT EXISTS practice_recency ON practice_sessions(user_id, updated DESC)`);

const byOwner = db.prepare("SELECT * FROM practice_sessions WHERE user_id=? AND id=?");
const view = (row) => ({ id: row.id, version: row.version, updated: row.updated, ...JSON.parse(row.data) });
const validId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function registerPractice(app) {
  app.get("/api/practice", requireUser, (req, res) => {
    const rows = db.prepare("SELECT * FROM practice_sessions WHERE user_id=? ORDER BY updated DESC LIMIT 60").all(req.user.id);
    const sessions = rows.map(view).map(({ id, version, updated, status, context, turns, total }) => ({
      id, version, updated, status, role: context.role, company: context.company, total, answered: turns.length,
      scores: turns.length ? Object.fromEntries(Object.keys(criteria).map(key => [
        key, Math.round(turns.reduce((sum, turn) => sum + turn.coach.scores[key], 0) / turns.length),
      ])) : null,
    }));
    res.json(sessions);
  });
  app.get("/api/practice/:id", requireUser, (req, res) => {
    const row = byOwner.get(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: "Simulation introuvable." });
    res.json(view(row));
  });
  app.put("/api/practice/:id", requireUser, (req, res) => {
    const { id } = req.params;
    const version = req.body?.version;
    if (!validId.test(id) || !Number.isSafeInteger(version) || version < 0) {
      return res.status(400).json({ error: "Identifiant de simulation invalide." });
    }
    let data;
    try { data = normalizePractice(req.body); }
    catch { return res.status(400).json({ error: "La simulation contient des données invalides." }); }
    const content = JSON.stringify(data);
    const row = byOwner.get(req.user.id, id);
    if (row?.data === content) return res.json(view(row));
    if ((row?.version ?? 0) !== version || row?.status === "completed") {
      return res.status(409).json({ error: "Cette simulation a changé. Rouvrez-la depuis votre historique." });
    }
    if (!row && db.prepare("SELECT count(*) AS count FROM practice_sessions WHERE user_id=?").get(req.user.id).count >= 120) {
      return res.status(409).json({ error: "Historique plein. Supprimez une ancienne simulation." });
    }
    db.prepare(`INSERT INTO practice_sessions VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id,id) DO UPDATE SET version=excluded.version, updated=excluded.updated,
      status=excluded.status, data=excluded.data`).run(req.user.id, id, version + 1, Date.now(), data.status, content);
    res.json(view(byOwner.get(req.user.id, id)));
  });
  app.delete("/api/practice/:id", requireUser, (req, res) => {
    db.prepare("DELETE FROM practice_sessions WHERE user_id=? AND id=?").run(req.user.id, req.params.id);
    res.status(204).end();
  });
}

export function deliveryMetrics(value, answer) {
  return cleanDelivery(value, answer);
}
