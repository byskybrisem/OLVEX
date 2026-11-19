-- Confirmed entries in a vendor journal or an immutable export.
CREATE TABLE olvex_pos_source_map (
  business_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('sale', 'return')),
  evidence TEXT NOT NULL,
  reference TEXT NOT NULL,
  approved_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, register_id, event_kind, evidence),
  UNIQUE (business_id, register_id, event_kind, reference),
  FOREIGN KEY (business_id, register_id) REFERENCES olvex_pos_connections(business_id, id)
);
