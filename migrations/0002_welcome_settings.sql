CREATE TABLE IF NOT EXISTS welcome_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'animation', 'video')),
  media_file_id TEXT NOT NULL,
  welcome_text TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_welcome_sessions (
  admin_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('media', 'text')),
  media_type TEXT,
  media_file_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
