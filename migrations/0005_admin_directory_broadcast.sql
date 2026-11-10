ALTER TABLE broadcast_jobs ADD COLUMN media_type TEXT;
ALTER TABLE broadcast_jobs ADD COLUMN media_file_id TEXT;

CREATE TABLE IF NOT EXISTS admin_broadcast_sessions (
  admin_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  media_type TEXT,
  media_file_id TEXT,
  message_text TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
