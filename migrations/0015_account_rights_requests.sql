CREATE TABLE olvex_account_rights_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('close', 'access', 'correction', 'erasure', 'other')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  processed_by TEXT REFERENCES users(id),
  CHECK ((processed_at IS NULL) = (processed_by IS NULL))
);

CREATE UNIQUE INDEX olvex_rights_pending
  ON olvex_account_rights_requests (user_id, kind) WHERE processed_at IS NULL;

CREATE INDEX olvex_rights_history ON olvex_account_rights_requests (user_id, created_at DESC, id DESC);
CREATE INDEX olvex_rights_queue ON olvex_account_rights_requests (processed_at, created_at, id);
