ALTER TABLE olvex_orders ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);

CREATE TABLE olvex_sale_edits (
  business_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  old_reference TEXT,
  new_reference TEXT,
  old_note TEXT NOT NULL,
  new_note TEXT NOT NULL,
  line_changes TEXT NOT NULL CHECK (json_valid(line_changes)),
  PRIMARY KEY (business_id, order_id, revision),
  FOREIGN KEY (business_id, request_id) REFERENCES olvex_operations(business_id, request_id),
  FOREIGN KEY (business_id, order_id) REFERENCES olvex_orders(business_id, id)
);

-- A return changes the quantity and balance visible to a cashier confirming an order.
CREATE TRIGGER olvex_return_revision AFTER INSERT ON olvex_returns
BEGIN
  UPDATE olvex_orders SET revision = revision + 1 WHERE business_id = NEW.business_id AND id = NEW.order_id;
END;
