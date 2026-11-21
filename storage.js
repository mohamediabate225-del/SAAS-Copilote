import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';

export const db = new DatabaseSync(process.env.COPILOTE_DB_PATH || 'copilote-local.sqlite');
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
db.exec(`CREATE TABLE IF NOT EXISTS rate_limits (
  scope TEXT NOT NULL, identity TEXT NOT NULL, count INTEGER NOT NULL, expires INTEGER NOT NULL,
  PRIMARY KEY(scope,identity)
); CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(expires);`);

export function cleanupExpired() {
  const tables = ['sessions','extension_tokens','password_resets','oauth_attempts','email_verifications','rate_limits'];
  for (const table of tables) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
      db.prepare(`DELETE FROM ${table} WHERE expires<=?`).run(Date.now());
  }
}
