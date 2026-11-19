CREATE TABLE olvex_branches (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  id TEXT NOT NULL PRIMARY KEY DEFAULT (
    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2)
      || '-8' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
  ),
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX olvex_default_branch ON olvex_branches(business_id) WHERE is_default = 1;
CREATE INDEX olvex_branch_names ON olvex_branches(business_id, name COLLATE NOCASE, id);

INSERT INTO olvex_branches (business_id, name, is_default)
SELECT id, 'Merkez', 1 FROM businesses;

CREATE TRIGGER olvex_open_default_branch AFTER INSERT ON businesses
BEGIN
  INSERT INTO olvex_branches (business_id, name, is_default) VALUES (NEW.id, 'Merkez', 1);
END;

ALTER TABLE olvex_pos_connections ADD COLUMN branch_id TEXT REFERENCES olvex_branches(id);
ALTER TABLE olvex_pos_connections ADD COLUMN identity_mode TEXT NOT NULL DEFAULT 'reconcile'
  CHECK (identity_mode IN ('native', 'reconcile'));
ALTER TABLE olvex_orders ADD COLUMN branch_id TEXT REFERENCES olvex_branches(id);
ALTER TABLE olvex_stock_movements ADD COLUMN branch_id TEXT REFERENCES olvex_branches(id);

UPDATE olvex_pos_connections SET branch_id = (SELECT id FROM olvex_branches
  WHERE business_id = olvex_pos_connections.business_id AND is_default = 1);
UPDATE olvex_orders SET branch_id = (SELECT id FROM olvex_branches
  WHERE business_id = olvex_orders.business_id AND is_default = 1);
UPDATE olvex_stock_movements SET branch_id = (SELECT id FROM olvex_branches
  WHERE business_id = olvex_stock_movements.business_id AND is_default = 1);

CREATE INDEX olvex_orders_branch ON olvex_orders (business_id, branch_id, occurred_on);
CREATE INDEX olvex_movements_branch ON olvex_stock_movements (business_id, branch_id, created_at, id);

CREATE TABLE olvex_branch_stock (
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  stock INTEGER NOT NULL CHECK (stock BETWEEN 0 AND 10000000),
  PRIMARY KEY (business_id, branch_id, product_id),
  FOREIGN KEY (business_id, branch_id) REFERENCES olvex_branches(business_id, id),
  FOREIGN KEY (business_id, product_id) REFERENCES olvex_products(business_id, id)
);
-- The pre-migration business balance already includes all historical movements.
INSERT INTO olvex_branch_stock (business_id, branch_id, product_id, stock)
SELECT p.business_id, b.id, p.id, p.stock FROM olvex_products p JOIN olvex_branches b
  ON p.business_id = b.business_id AND b.is_default = 1 WHERE p.stock <> 0;

CREATE TRIGGER olvex_check_pos_branch BEFORE INSERT ON olvex_pos_connections
WHEN NOT EXISTS (SELECT 1 FROM olvex_branches WHERE id = NEW.branch_id AND business_id = NEW.business_id)
BEGIN
  SELECT RAISE(ABORT, 'olvex_invalid_branch');
END;
CREATE TRIGGER olvex_fixed_pos_branch BEFORE UPDATE OF branch_id, business_id, id ON olvex_pos_connections
WHEN NEW.branch_id IS NOT OLD.branch_id OR NEW.business_id <> OLD.business_id OR NEW.id <> OLD.id
BEGIN
  SELECT RAISE(ABORT, 'olvex_invalid_branch');
END;
CREATE TRIGGER olvex_check_order_branch BEFORE INSERT ON olvex_orders
WHEN NOT EXISTS (SELECT 1 FROM olvex_branches WHERE id = NEW.branch_id AND business_id = NEW.business_id)
  OR (NEW.source = 'pos' AND NOT EXISTS (
    SELECT 1 FROM olvex_pos_connections WHERE business_id = NEW.business_id AND id = NEW.source_key
      AND branch_id = NEW.branch_id AND revoked_at IS NULL
  ))
BEGIN
  SELECT RAISE(ABORT, 'olvex_invalid_branch');
END;
CREATE TRIGGER olvex_fixed_order_branch BEFORE UPDATE OF branch_id, business_id, source, source_key ON olvex_orders
WHEN NEW.branch_id IS NOT OLD.branch_id OR NEW.business_id <> OLD.business_id
  OR NEW.source <> OLD.source OR NEW.source_key <> OLD.source_key
BEGIN
  SELECT RAISE(ABORT, 'olvex_invalid_branch');
END;
CREATE TRIGGER olvex_check_movement_branch BEFORE INSERT ON olvex_stock_movements
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM olvex_branches WHERE id = NEW.branch_id AND business_id = NEW.business_id)
      OR (NEW.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM olvex_orders
        WHERE business_id = NEW.business_id AND id = NEW.order_id AND branch_id = NEW.branch_id))
      THEN RAISE(ABORT, 'olvex_invalid_branch')
    WHEN COALESCE((SELECT stock FROM olvex_branch_stock WHERE business_id = NEW.business_id
      AND branch_id = NEW.branch_id AND product_id = NEW.product_id), 0) + NEW.delta < 0
      THEN RAISE(ABORT, 'olvex_insufficient_stock')
  END;
END;

DROP TRIGGER olvex_apply_movement;
CREATE TRIGGER olvex_apply_movement AFTER INSERT ON olvex_stock_movements
BEGIN
  INSERT INTO olvex_branch_stock (business_id, branch_id, product_id, stock)
    VALUES (NEW.business_id, NEW.branch_id, NEW.product_id, 0)
    ON CONFLICT (business_id, branch_id, product_id) DO NOTHING;
  UPDATE olvex_branch_stock SET stock = stock + NEW.delta
    WHERE business_id = NEW.business_id AND branch_id = NEW.branch_id AND product_id = NEW.product_id;
  UPDATE olvex_products SET stock = stock + NEW.delta
    WHERE business_id = NEW.business_id AND id = NEW.product_id;
END;

DROP TRIGGER olvex_post_item;
CREATE TRIGGER olvex_post_item AFTER INSERT ON olvex_order_items
BEGIN
  INSERT INTO olvex_stock_movements (business_id, branch_id, id, product_id, order_id, kind, delta, created_by)
  SELECT NEW.business_id, branch_id, NEW.id, NEW.product_id, NEW.order_id, kind,
         CASE kind WHEN 'sale' THEN -NEW.quantity ELSE NEW.quantity END, created_by
  FROM olvex_orders WHERE business_id = NEW.business_id AND id = NEW.order_id;
END;

DROP TRIGGER olvex_reverse_order;
CREATE TRIGGER olvex_reverse_order AFTER UPDATE OF status ON olvex_orders
WHEN OLD.status = 'posted' AND NEW.status = 'void'
BEGIN
  INSERT INTO olvex_stock_movements (business_id, branch_id, id, product_id, order_id, kind, delta, created_by)
  SELECT m.business_id, NEW.branch_id, 'void:' || m.id, m.product_id, m.order_id, 'reversal', -m.delta, NEW.voided_by
  FROM olvex_stock_movements m
  WHERE m.business_id = NEW.business_id AND m.order_id = NEW.id AND m.kind = NEW.kind;
END;

-- One row represents one posted product transfer. Both legs share its ID.
CREATE TABLE olvex_stock_transfers (
  business_id TEXT NOT NULL,
  id TEXT NOT NULL PRIMARY KEY,
  source_branch_id TEXT NOT NULL,
  destination_branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 10000000),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (source_branch_id <> destination_branch_id),
  FOREIGN KEY (business_id, source_branch_id) REFERENCES olvex_branches(business_id, id),
  FOREIGN KEY (business_id, destination_branch_id) REFERENCES olvex_branches(business_id, id),
  FOREIGN KEY (business_id, product_id) REFERENCES olvex_products(business_id, id)
);
ALTER TABLE olvex_stock_movements ADD COLUMN transfer_id TEXT REFERENCES olvex_stock_transfers(id);
CREATE UNIQUE INDEX olvex_transfer_leg ON olvex_stock_movements (transfer_id, branch_id) WHERE transfer_id IS NOT NULL;
CREATE TRIGGER olvex_post_transfer AFTER INSERT ON olvex_stock_transfers
BEGIN
  INSERT INTO olvex_stock_movements (business_id, branch_id, id, product_id, kind, delta, note, created_by, transfer_id)
    VALUES (NEW.business_id, NEW.source_branch_id, 'transfer-out:' || NEW.id, NEW.product_id,
            'adjustment', -NEW.quantity, 'Şubeler arası transfer çıkışı', NEW.created_by, NEW.id),
           (NEW.business_id, NEW.destination_branch_id, 'transfer-in:' || NEW.id, NEW.product_id,
            'adjustment', NEW.quantity, 'Şubeler arası transfer girişi', NEW.created_by, NEW.id);
END;

CREATE TRIGGER olvex_immutable_transfer BEFORE UPDATE ON olvex_stock_transfers
BEGIN
  SELECT RAISE(ABORT, 'olvex_posted_transfer');
END;

-- The register ID identifies transactions across credential renewals.
CREATE TABLE olvex_pos_token_history (
  token_hash TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  FOREIGN KEY (business_id, register_id) REFERENCES olvex_pos_connections(business_id, id)
);
INSERT INTO olvex_pos_token_history (token_hash, business_id, register_id)
SELECT token_hash, business_id, id FROM olvex_pos_connections;

CREATE TRIGGER olvex_remember_pos_token AFTER INSERT ON olvex_pos_connections
BEGIN
  INSERT INTO olvex_pos_token_history (token_hash, business_id, register_id)
  VALUES (NEW.token_hash, NEW.business_id, NEW.id);
END;
CREATE TRIGGER olvex_remember_rotated_pos_token AFTER UPDATE OF token_hash ON olvex_pos_connections
BEGIN
  INSERT INTO olvex_pos_token_history (token_hash, business_id, register_id)
  VALUES (NEW.token_hash, NEW.business_id, NEW.id);
END;
