CREATE TABLE olvex_returns (
  business_id TEXT NOT NULL,
  id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  reference TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, id),
  UNIQUE (business_id, register_id, reference),
  UNIQUE (business_id, id, order_id),
  FOREIGN KEY (business_id, order_id) REFERENCES olvex_orders(business_id, id),
  FOREIGN KEY (business_id, register_id) REFERENCES olvex_pos_connections(business_id, id)
);

CREATE INDEX idx_olvex_returns_order ON olvex_returns(business_id, order_id, occurred_on);
CREATE INDEX idx_olvex_returns_day ON olvex_returns(business_id, occurred_on);
CREATE UNIQUE INDEX idx_olvex_order_item_parent ON olvex_order_items(business_id, order_id, id);

CREATE TABLE olvex_return_items (
  business_id TEXT NOT NULL,
  return_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  PRIMARY KEY (business_id, return_id, item_id),
  FOREIGN KEY (business_id, return_id, order_id) REFERENCES olvex_returns(business_id, id, order_id),
  FOREIGN KEY (business_id, order_id, item_id) REFERENCES olvex_order_items(business_id, order_id, id)
);
CREATE INDEX idx_olvex_returned_item ON olvex_return_items(business_id, order_id, item_id);

CREATE VIEW olvex_net_order_items AS
SELECT i.business_id, i.id, i.order_id, i.product_id, i.product_sku, i.product_name, i.unit_minor, i.cost_minor,
  i.quantity AS gross_quantity, i.quantity - COALESCE((
    SELECT SUM(ri.quantity) FROM olvex_return_items ri
    WHERE ri.business_id = i.business_id AND ri.order_id = i.order_id AND ri.item_id = i.id
  ), 0) AS quantity
FROM olvex_order_items i;

CREATE TABLE olvex_order_payments (
  business_id TEXT NOT NULL,
  id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('payment', 'refund')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 0 AND 25000000000000),
  occurred_on TEXT NOT NULL,
  PRIMARY KEY (business_id, id),
  FOREIGN KEY (business_id, order_id) REFERENCES olvex_orders(business_id, id)
);
CREATE INDEX idx_olvex_payment_day ON olvex_order_payments(business_id, occurred_on);
CREATE INDEX idx_olvex_payment_order ON olvex_order_payments(business_id, order_id);

-- Capture original settlement and reversal dates for orders predating this migration.
INSERT INTO olvex_order_payments (business_id, id, order_id, kind, amount_minor, occurred_on)
SELECT o.business_id, 'payment:' || o.id, o.id, 'payment', SUM(i.quantity * i.unit_minor), o.paid_on
FROM olvex_orders o JOIN olvex_order_items i ON i.business_id = o.business_id AND i.order_id = o.id
WHERE o.paid_on IS NOT NULL GROUP BY o.business_id, o.id;

INSERT INTO olvex_order_payments (business_id, id, order_id, kind, amount_minor, occurred_on)
SELECT p.business_id, 'void:' || p.order_id, p.order_id, 'refund', p.amount_minor, o.voided_on
FROM olvex_order_payments p JOIN olvex_orders o ON o.business_id = p.business_id AND o.id = p.order_id
WHERE p.kind = 'payment' AND o.status = 'void';

-- Paid-at-sale lines are posted in one D1 batch and produce one payment per order.
CREATE TRIGGER olvex_collect_at_sale AFTER INSERT ON olvex_order_items
BEGIN
  INSERT INTO olvex_order_payments (business_id, id, order_id, kind, occurred_on, amount_minor)
  SELECT o.business_id, 'payment:' || o.id, o.id, 'payment', o.paid_on, NEW.quantity * NEW.unit_minor
  FROM olvex_orders o WHERE o.business_id = NEW.business_id AND o.id = NEW.order_id AND o.paid_on IS NOT NULL
  ON CONFLICT (business_id, id) DO UPDATE SET amount_minor = amount_minor + excluded.amount_minor;
END;

-- Returns registered before settlement reduce the outstanding receivable.
CREATE TRIGGER olvex_collect_later AFTER UPDATE OF paid_on ON olvex_orders
WHEN OLD.paid_on IS NULL AND NEW.paid_on IS NOT NULL
BEGIN
  INSERT INTO olvex_order_payments (business_id, id, order_id, kind, occurred_on, amount_minor)
  SELECT NEW.business_id, 'payment:' || NEW.id, NEW.id, 'payment', NEW.paid_on, SUM(i.quantity * i.unit_minor)
  FROM olvex_net_order_items i WHERE i.business_id = NEW.business_id AND i.order_id = NEW.id;
END;

CREATE TRIGGER olvex_check_return_item BEFORE INSERT ON olvex_return_items
WHEN NEW.quantity > COALESCE((SELECT i.quantity FROM olvex_net_order_items i
  WHERE i.business_id = NEW.business_id AND i.order_id = NEW.order_id AND i.id = NEW.item_id), 0)
BEGIN
  SELECT RAISE(ABORT, 'olvex_return_quantity');
END;

CREATE TRIGGER olvex_post_return_item AFTER INSERT ON olvex_return_items
BEGIN
  INSERT INTO olvex_stock_movements (business_id, id, product_id, order_id, branch_id, kind, delta, created_by)
  SELECT r.business_id, 'return:' || r.id || ':' || i.id, i.product_id, r.order_id, o.branch_id, 'reversal', NEW.quantity, r.created_by
  FROM olvex_returns r JOIN olvex_orders o ON o.business_id = r.business_id AND o.id = r.order_id
  JOIN olvex_order_items i ON i.business_id = r.business_id AND i.order_id = r.order_id AND i.id = NEW.item_id
  WHERE r.business_id = NEW.business_id AND r.id = NEW.return_id;

  INSERT INTO olvex_order_payments (business_id, id, order_id, kind, occurred_on, amount_minor)
  SELECT r.business_id, 'return:' || r.id, r.order_id, 'refund', r.occurred_on, NEW.quantity * i.unit_minor
  FROM olvex_returns r JOIN olvex_orders o ON o.business_id = r.business_id AND o.id = r.order_id
  JOIN olvex_order_items i ON i.business_id = r.business_id AND i.order_id = r.order_id AND i.id = NEW.item_id
  WHERE r.business_id = NEW.business_id AND r.id = NEW.return_id AND o.paid_on IS NOT NULL
  ON CONFLICT (business_id, id) DO UPDATE SET amount_minor = amount_minor + excluded.amount_minor;
END;

DROP TRIGGER olvex_reverse_order;
CREATE TRIGGER olvex_reverse_order AFTER UPDATE OF status ON olvex_orders
WHEN OLD.status = 'posted' AND NEW.status = 'void'
BEGIN
  INSERT INTO olvex_stock_movements (business_id, id, product_id, order_id, branch_id, kind, delta, created_by)
  SELECT i.business_id, 'void:' || i.id, i.product_id, i.order_id, NEW.branch_id, 'reversal',
    CASE NEW.kind WHEN 'sale' THEN i.quantity ELSE -i.quantity END, NEW.voided_by
  FROM olvex_net_order_items i WHERE i.business_id = NEW.business_id AND i.order_id = NEW.id AND i.quantity > 0;

  INSERT INTO olvex_order_payments (business_id, id, order_id, kind, occurred_on, amount_minor)
  SELECT NEW.business_id, 'void:' || NEW.id, NEW.id, 'refund', NEW.voided_on, SUM(i.quantity * i.unit_minor)
  FROM olvex_net_order_items i WHERE i.business_id = NEW.business_id AND i.order_id = NEW.id
    AND NEW.paid_on IS NOT NULL HAVING SUM(i.quantity) > 0;
END;

-- Signed line events put returns and voids in their own accounting period.
CREATE VIEW olvex_order_events AS
SELECT o.business_id, o.branch_id, o.id AS order_id, o.kind, o.occurred_on, 'order' AS event,
  i.product_id, i.quantity, i.unit_minor, i.cost_minor
FROM olvex_orders o JOIN olvex_order_items i ON i.business_id = o.business_id AND i.order_id = o.id
UNION ALL
SELECT o.business_id, o.branch_id, o.id, o.kind, r.occurred_on, 'return',
  i.product_id, -ri.quantity, i.unit_minor, i.cost_minor
FROM olvex_returns r JOIN olvex_orders o ON o.business_id = r.business_id AND o.id = r.order_id
JOIN olvex_return_items ri ON ri.business_id = r.business_id AND ri.return_id = r.id
JOIN olvex_order_items i ON i.business_id = ri.business_id AND i.id = ri.item_id
UNION ALL
SELECT o.business_id, o.branch_id, o.id, o.kind, o.voided_on, 'void',
  i.product_id, -i.quantity, i.unit_minor, i.cost_minor
FROM olvex_orders o JOIN olvex_net_order_items i ON i.business_id = o.business_id AND i.order_id = o.id
WHERE o.status = 'void';
