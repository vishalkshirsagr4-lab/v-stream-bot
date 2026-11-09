export async function upsertUser(db, from, trialLimit) {
  await db.prepare(
    "INSERT INTO users(telegram_id, username, first_name, trial_remaining, last_seen_at) " +
    "VALUES (?, ?, ?, ?, datetime('now')) " +
    "ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, " +
    "first_name=excluded.first_name, last_seen_at=datetime('now')"
  ).bind(String(from.id), from.username || null, from.first_name || null, trialLimit).run();
}

export function getUser(db, telegramId) {
  return db.prepare("SELECT * FROM users WHERE telegram_id=?").bind(String(telegramId)).first();
}

export async function getActiveSubscription(db, telegramId) {
  return db.prepare(
    "SELECT plan_name, expires_at FROM subscriptions " +
    "WHERE telegram_id=? AND status='active' AND expires_at > datetime('now') " +
    "ORDER BY expires_at DESC LIMIT 1"
  ).bind(String(telegramId)).first();
}

export async function listPlans(db) {
  const result = await db.prepare(
    "SELECT id, name, amount_paise, duration_days FROM plans WHERE active=1 ORDER BY duration_days"
  ).all();
  return result.results || [];
}

export function getRandomVideo(db) {
  return db.prepare(
    "SELECT id, file_id, caption FROM videos ORDER BY RANDOM() LIMIT 1"
  ).first();
}
