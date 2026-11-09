CREATE TABLE IF NOT EXISTS payment_utr_sessions (
  telegram_id TEXT PRIMARY KEY,
  payment_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
