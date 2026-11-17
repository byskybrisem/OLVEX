CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  password_hash TEXT
);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS business_members (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_members_business ON business_members(business_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_rate_limits_updated_at ON auth_rate_limits(updated_at);

CREATE TABLE IF NOT EXISTS olvex_terms_acceptances (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, version)
);

CREATE TABLE IF NOT EXISTS olvex_password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_olvex_resets_user ON olvex_password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_olvex_resets_expiry ON olvex_password_resets(expires_at);
