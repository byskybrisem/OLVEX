-- Operator-owned platform accounts are distinct from tenant financial records.
-- All money values are integer Turkish kurus; historical entries are never deleted.
CREATE TABLE olvex_platform_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 25000000000000),
  occurred_on TEXT NOT NULL CHECK (length(occurred_on) = 10),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT,
  voided_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_olvex_platform_ledger_period ON olvex_platform_ledger(occurred_on DESC, id DESC);
CREATE INDEX idx_olvex_platform_ledger_kind_period ON olvex_platform_ledger(kind, occurred_on);

CREATE TABLE olvex_admin_audit (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('ledger_create', 'ledger_void')),
  subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_olvex_admin_audit_created ON olvex_admin_audit(created_at DESC, id DESC);

CREATE TRIGGER olvex_admin_ledger_created AFTER INSERT ON olvex_platform_ledger
BEGIN
  INSERT INTO olvex_admin_audit(id, actor_id, action, subject_id)
  VALUES (lower(hex(randomblob(16))), NEW.created_by, 'ledger_create', NEW.id);
END;

CREATE TRIGGER olvex_admin_ledger_voided AFTER UPDATE OF voided_at ON olvex_platform_ledger
WHEN OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL
BEGIN
  INSERT INTO olvex_admin_audit(id, actor_id, action, subject_id)
  VALUES (lower(hex(randomblob(16))), NEW.voided_by, 'ledger_void', NEW.id);
END;
