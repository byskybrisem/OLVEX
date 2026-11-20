-- Retain the identity of the order that established the current paid period.
ALTER TABLE olvex_polar_checkouts ADD COLUMN paid_order_id TEXT;
