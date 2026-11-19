-- Existing accounts and sessions continue to use their existing credentials.
CREATE TABLE olvex_signup_links (
  token_hash TEXT PRIMARY KEY NOT NULL,
  email TEXT COLLATE NOCASE NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_olvex_signup_links_expiry ON olvex_signup_links(expires_at);
