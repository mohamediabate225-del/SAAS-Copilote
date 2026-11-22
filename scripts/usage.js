import "dotenv/config";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(process.env.COPILOTE_DB_PATH || "copilote-local.sqlite", { readOnly: true });
try {
  const usage = database.prepare(`SELECT count(DISTINCT user_id) AS ai_users, coalesce(sum(calls),0) AS ai_calls,
    coalesce(sum(input_tokens),0) AS input_tokens, coalesce(sum(output_tokens),0) AS output_tokens,
    coalesce(sum(audio_bytes),0) AS audio_bytes FROM ai_usage WHERE day>=date('now','-29 days')`).get();
  const costs=database.prepare(`SELECT user_id,model,type,count(*) calls,sum(audio_seconds) audio_seconds,
    sum(billable_seconds) billable_seconds,sum(input_tokens) input_tokens,sum(output_tokens) output_tokens,
    sum(estimated_cost_usd) estimated_cost_usd FROM usage WHERE created_at>=? AND state!='failed'
    GROUP BY user_id,model,type`).all(Date.now()-30*86400000);
  const practice = database.prepare(`SELECT count(*) AS completed_practices, count(DISTINCT user_id) AS practice_users
    FROM practice_sessions WHERE status='completed' AND updated>=?`).get(Date.now() - 30 * 86400000);
  const accounts = database.prepare(`SELECT count(*) AS accounts,
    count(trial_started) AS started_trials FROM users`).get();
  const converted = database.prepare(`SELECT count(DISTINCT users.id) AS subscribers_after_trial FROM users
    JOIN subscriptions ON users.id=subscriptions.user_id WHERE users.trial_started IS NOT NULL
    AND subscriptions.status IN ('active','trialing')`).get();
  process.stdout.write(JSON.stringify({ costs_by_internal_user_id:costs, recent_30_days: { ...usage, ...practice }, lifetime: { ...accounts, ...converted } }, null, 2) + "\n");
} finally {
  database.close();
}
