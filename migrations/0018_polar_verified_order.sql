-- Retain the identity of the order that established the current paid period.
ALTER TABLE olvex_polar_checkouts ADD COLUMN paid_order_id TEXT;

-- A delayed order read must not reopen a period after a confirmed refund.
CREATE TABLE olvex_polar_refunded_orders (
  checkout_id TEXT NOT NULL REFERENCES olvex_polar_checkouts(id),
  order_id TEXT NOT NULL,
  PRIMARY KEY (checkout_id, order_id)
);
