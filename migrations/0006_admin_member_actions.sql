CREATE TABLE IF NOT EXISTS admin_dm_sessions (
  admin_id TEXT PRIMARY KEY,
  target_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
