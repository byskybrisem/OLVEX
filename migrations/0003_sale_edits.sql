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

-- A corrected line already has stock movements for every quantity change.
-- Reverse its final quantity once, preserving the original movements and their audit trail.
DROP TRIGGER olvex_reverse_order;
CREATE TRIGGER olvex_reverse_order AFTER UPDATE OF status ON olvex_orders
WHEN OLD.status = 'posted' AND NEW.status = 'void'
BEGIN
  INSERT INTO olvex_stock_movements (business_id, id, product_id, order_id, kind, delta, created_by)
  SELECT business_id, 'void:' || id, product_id, order_id, 'reversal',
         CASE NEW.kind WHEN 'sale' THEN quantity ELSE -quantity END, NEW.voided_by
  FROM olvex_order_items WHERE business_id = NEW.business_id AND order_id = NEW.id;
END;
