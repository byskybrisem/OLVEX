-- Pre-branch CSV files contained receipt numbers but did not identify a till.
CREATE TABLE olvex_csv_receipt_matches (
  business_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('same', 'distinct')),
  evidence TEXT NOT NULL,
  approved_by TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (business_id, order_id, register_id),
  FOREIGN KEY (business_id, order_id) REFERENCES olvex_orders(business_id, id),
  FOREIGN KEY (business_id, register_id) REFERENCES olvex_pos_connections(business_id, id)
);
CREATE UNIQUE INDEX olvex_csv_original_till ON olvex_csv_receipt_matches(business_id, order_id)
  WHERE decision = 'same';

CREATE TRIGGER olvex_protect_legacy_csv BEFORE INSERT ON olvex_orders
WHEN NEW.kind = 'sale' AND NEW.source = 'pos' AND EXISTS (
  SELECT 1 FROM olvex_orders old
  WHERE old.business_id = NEW.business_id AND old.kind = 'sale' AND old.source = 'csv'
    AND old.source_key = '' AND old.reference = NEW.reference
    AND NOT EXISTS (
      SELECT 1 FROM olvex_csv_receipt_matches m
      WHERE m.business_id = old.business_id AND m.order_id = old.id
        AND ((m.register_id = NEW.source_key AND m.decision = 'distinct')
          OR (m.register_id <> NEW.source_key AND m.decision = 'same'))
    )
)
BEGIN
  SELECT RAISE(ABORT, 'olvex_csv_history');
END;
