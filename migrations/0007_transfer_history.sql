-- Legacy transfers retain their original timestamps and already-posted stock movements.
ALTER TABLE olvex_stock_transfers ADD COLUMN occurred_on TEXT;
ALTER TABLE olvex_stock_transfers ADD COLUMN note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500);

CREATE INDEX olvex_transfer_history ON olvex_stock_transfers (
  business_id, COALESCE(occurred_on, substr(created_at, 1, 10)) DESC, created_at DESC, id DESC
);

CREATE TRIGGER olvex_check_transfer_product BEFORE INSERT ON olvex_stock_transfers
WHEN NOT EXISTS (SELECT 1 FROM olvex_products
  WHERE business_id = NEW.business_id AND id = NEW.product_id AND active = 1)
BEGIN
  SELECT RAISE(ABORT, 'olvex_product_unavailable');
END;
