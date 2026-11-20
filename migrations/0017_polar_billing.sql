CREATE TABLE olvex_polar_checkouts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','live')),
  offer TEXT NOT NULL CHECK(offer IN ('standard','launch')),
  product_id TEXT NOT NULL,
  discount_id TEXT,
  created_at INTEGER NOT NULL,
  checkout_id TEXT,
  checkout_url TEXT,
  expires_at INTEGER,
  subscription_id TEXT,
  state TEXT NOT NULL DEFAULT 'creating',
  closed INTEGER NOT NULL DEFAULT 0,
  paid_until INTEGER,
  trial_until INTEGER,
  used_trial INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  last_event TEXT,
  UNIQUE(environment, checkout_id),
  UNIQUE(environment, subscription_id)
);
CREATE UNIQUE INDEX olvex_polar_one_open ON olvex_polar_checkouts(environment,business_id) WHERE closed = 0;
CREATE INDEX olvex_polar_business ON olvex_polar_checkouts(business_id,environment,created_at);
CREATE TABLE olvex_polar_events (
  environment TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  checkout_id TEXT NOT NULL REFERENCES olvex_polar_checkouts(id),
  event_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  paid_until INTEGER,
  trial_until INTEGER,
  PRIMARY KEY(environment,delivery_id)
);
CREATE VIEW olvex_subscription_access AS
  SELECT business_id, environment, plan, paid_until, NULL AS trial_until
    FROM olvex_subscriptions
    WHERE state IN ('active','canceling') AND provider_ref IS NOT NULL AND customer_ref IS NOT NULL
  UNION ALL
  SELECT business_id, environment, 'profesyonel-monthly', paid_until, trial_until
    FROM olvex_polar_checkouts WHERE closed = 0;
