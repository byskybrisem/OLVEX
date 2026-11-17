CREATE TABLE olvex_operations (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  request_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, request_id)
);

CREATE TABLE olvex_products (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  id TEXT NOT NULL,
  sku TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  price_minor INTEGER NOT NULL CHECK (price_minor BETWEEN 0 AND 100000000),
  cost_minor INTEGER NOT NULL CHECK (cost_minor BETWEEN 0 AND 100000000),
  stock INTEGER NOT NULL DEFAULT 0 CONSTRAINT valid_stock CHECK (stock BETWEEN 0 AND 10000000),
  reorder_at INTEGER NOT NULL DEFAULT 0 CHECK (reorder_at BETWEEN 0 AND 10000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, id),
  UNIQUE (business_id, sku)
);

CREATE TABLE olvex_customers (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, id)
);

CREATE TABLE olvex_pos_connections (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  PRIMARY KEY (business_id, id)
);

CREATE TABLE olvex_orders (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sale', 'purchase')),
  source TEXT NOT NULL CHECK (source IN ('manual', 'csv', 'pos')),
  source_key TEXT NOT NULL DEFAULT '',
  reference TEXT,
  occurred_on TEXT NOT NULL,
  customer_id TEXT,
  supplier TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  paid_on TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'void')),
  created_by TEXT NOT NULL REFERENCES users(id),
  voided_by TEXT REFERENCES users(id),
  voided_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, id),
  UNIQUE (business_id, kind, source, source_key, reference),
  FOREIGN KEY (business_id, customer_id) REFERENCES olvex_customers(business_id, id)
);

CREATE INDEX idx_olvex_orders_when ON olvex_orders(business_id, kind, occurred_on DESC, created_at DESC);
CREATE INDEX idx_olvex_orders_paid ON olvex_orders(business_id, paid_on);
CREATE INDEX idx_olvex_orders_voided ON olvex_orders(business_id, voided_on);
CREATE INDEX idx_olvex_orders_customer ON olvex_orders(business_id, customer_id);

CREATE TABLE olvex_order_items (
  business_id TEXT NOT NULL,
  id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  unit_minor INTEGER NOT NULL CHECK (unit_minor BETWEEN 0 AND 100000000),
  cost_minor INTEGER NOT NULL CHECK (cost_minor BETWEEN 0 AND 100000000),
  PRIMARY KEY (business_id, id),
  UNIQUE (business_id, order_id, product_id),
  FOREIGN KEY (business_id, order_id) REFERENCES olvex_orders(business_id, id),
  FOREIGN KEY (business_id, product_id) REFERENCES olvex_products(business_id, id)
);

CREATE TABLE olvex_stock_movements (
  business_id TEXT NOT NULL,
  id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  order_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('opening', 'sale', 'purchase', 'adjustment', 'reversal')),
  delta INTEGER NOT NULL CHECK (delta BETWEEN -10000000 AND 10000000 AND delta <> 0),
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, id),
  FOREIGN KEY (business_id, order_id) REFERENCES olvex_orders(business_id, id),
  FOREIGN KEY (business_id, product_id) REFERENCES olvex_products(business_id, id)
);

CREATE INDEX idx_olvex_stock_history ON olvex_stock_movements(business_id, created_at DESC, id DESC);

CREATE INDEX idx_olvex_stock_by_product ON olvex_stock_movements(business_id, product_id, created_at DESC, id DESC);

CREATE TRIGGER olvex_check_movement BEFORE INSERT ON olvex_stock_movements
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM olvex_products
      WHERE business_id = NEW.business_id AND id = NEW.product_id
        AND (active = 1 OR NEW.kind = 'reversal')
    ) THEN RAISE(ABORT, 'olvex_product_unavailable')
    WHEN (
      SELECT stock + NEW.delta FROM olvex_products
      WHERE business_id = NEW.business_id AND id = NEW.product_id
    ) < 0 THEN RAISE(ABORT, 'olvex_insufficient_stock')
    WHEN (
      SELECT stock + NEW.delta FROM olvex_products
      WHERE business_id = NEW.business_id AND id = NEW.product_id
    ) > 10000000 THEN RAISE(ABORT, 'olvex_stock_limit')
  END;
END;

CREATE TRIGGER olvex_apply_movement AFTER INSERT ON olvex_stock_movements
BEGIN
  UPDATE olvex_products SET stock = stock + NEW.delta
  WHERE business_id = NEW.business_id AND id = NEW.product_id;
END;

CREATE TRIGGER olvex_post_item AFTER INSERT ON olvex_order_items
BEGIN
  INSERT INTO olvex_stock_movements (business_id, id, product_id, order_id, kind, delta, created_by)
  SELECT NEW.business_id, NEW.id, NEW.product_id, NEW.order_id, kind,
         CASE kind WHEN 'sale' THEN -NEW.quantity ELSE NEW.quantity END, created_by
  FROM olvex_orders WHERE business_id = NEW.business_id AND id = NEW.order_id;
END;

CREATE TRIGGER olvex_reverse_order AFTER UPDATE OF status ON olvex_orders
WHEN OLD.status = 'posted' AND NEW.status = 'void'
BEGIN
  INSERT INTO olvex_stock_movements (business_id, id, product_id, order_id, kind, delta, created_by)
  SELECT m.business_id, 'void:' || m.id, m.product_id, m.order_id, 'reversal', -m.delta,
         NEW.voided_by
  FROM olvex_stock_movements m
  WHERE m.business_id = NEW.business_id AND m.order_id = NEW.id AND m.kind = NEW.kind;
END;

CREATE INDEX idx_olvex_stock_by_order ON olvex_stock_movements(business_id, order_id);

CREATE TABLE olvex_cash_entries (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000),
  occurred_on TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT,
  PRIMARY KEY (business_id, id)
);

CREATE INDEX idx_olvex_cash_when ON olvex_cash_entries(business_id, occurred_on DESC, created_at DESC);

CREATE TABLE olvex_invoices (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  number TEXT NOT NULL COLLATE NOCASE,
  counterparty TEXT NOT NULL,
  issued_on TEXT NOT NULL,
  due_on TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 0 AND 25000000000000),
  status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, id),
  UNIQUE (business_id, direction, counterparty, number)
);

CREATE TABLE olvex_employees (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  job_title TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, id)
);

CREATE TABLE olvex_shifts (
  business_id TEXT NOT NULL,
  id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  shift_on TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, id),
  FOREIGN KEY (business_id, employee_id) REFERENCES olvex_employees(business_id, id)
);

CREATE INDEX idx_olvex_shifts_when ON olvex_shifts(business_id, shift_on, start_time);

CREATE TABLE olvex_tasks (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  due_on TEXT NOT NULL,
  repeat_rule TEXT NOT NULL CHECK (repeat_rule IN ('none', 'daily', 'weekly', 'monthly')),
  repeat_day INTEGER NOT NULL CHECK (repeat_day BETWEEN 1 AND 31),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, id)
);

CREATE INDEX idx_olvex_tasks_due ON olvex_tasks(business_id, due_on, completed_at);

CREATE TABLE olvex_invitations (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  accepted_by TEXT REFERENCES users(id),
  revoked_at TEXT,
  PRIMARY KEY (business_id, id)
);

CREATE TABLE olvex_ai_proposals (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'stock')),
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'applied', 'discarded')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, id)
);

CREATE INDEX idx_olvex_ai_pending ON olvex_ai_proposals(business_id, user_id, state, expires_at);

CREATE TRIGGER olvex_validate_shift BEFORE INSERT ON olvex_shifts
WHEN EXISTS (
  SELECT 1 FROM olvex_shifts s
  WHERE s.business_id = NEW.business_id AND s.employee_id = NEW.employee_id
    AND s.shift_on BETWEEN date(NEW.shift_on, '-1 day') AND date(NEW.shift_on, '+1 day')
    AND datetime(s.shift_on || ' ' || s.start_time) <
        datetime(NEW.shift_on || ' ' || NEW.end_time, CASE WHEN NEW.end_time < NEW.start_time THEN '+1 day' ELSE '+0 days' END)
    AND datetime(NEW.shift_on || ' ' || NEW.start_time) <
        datetime(s.shift_on || ' ' || s.end_time, CASE WHEN s.end_time < s.start_time THEN '+1 day' ELSE '+0 days' END)
)
BEGIN
  SELECT RAISE(ABORT, 'olvex_shift_overlap');
END;

CREATE TRIGGER olvex_accept_invitation AFTER UPDATE OF accepted_by ON olvex_invitations
WHEN OLD.accepted_by IS NULL AND NEW.accepted_by IS NOT NULL
BEGIN
  INSERT INTO business_members (id, business_id, user_id, role)
  VALUES ('invite:' || NEW.id, NEW.business_id, NEW.accepted_by, NEW.role)
  ON CONFLICT (business_id, user_id) DO NOTHING;
END;
