CREATE TABLE olvex_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  plan TEXT NOT NULL CHECK (plan IN ('esnaf-monthly', 'esnaf-yearly', 'profesyonel-monthly', 'profesyonel-yearly')),
  plan_ref TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'creating', 'checkout', 'failed', 'pending', 'active', 'unpaid', 'canceling', 'canceled', 'expired', 'upgraded'
  )),
  token_hash TEXT UNIQUE,
  provider_ref TEXT,
  customer_ref TEXT,
  paid_until INTEGER,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (environment, provider_ref)
);

CREATE UNIQUE INDEX olvex_one_open_subscription ON olvex_subscriptions (environment, business_id)
  WHERE state IN ('creating', 'checkout', 'pending', 'active', 'unpaid', 'canceling');
CREATE INDEX olvex_subscription_business ON olvex_subscriptions (business_id, environment, created_at);
