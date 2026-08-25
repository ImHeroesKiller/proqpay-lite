CREATE TABLE IF NOT EXISTS app_user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  avatar_url TEXT,
  job_title TEXT,
  department TEXT,
  phone TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
