CREATE TABLE IF NOT EXISTS user_video_history (
  telegram_id TEXT NOT NULL,
  video_id INTEGER NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (telegram_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_user_video_history_user ON user_video_history(telegram_id);

CREATE TABLE IF NOT EXISTS scheduled_message_deletions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  delete_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_message_deletions_due ON scheduled_message_deletions(delete_at);
