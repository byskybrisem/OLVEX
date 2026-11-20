-- Additive migration: existing Esnaf subscriptions and customer records remain intact.
ALTER TABLE olvex_subscriptions ADD COLUMN trial_until INTEGER;
ALTER TABLE olvex_subscriptions ADD COLUMN billing_terms_accepted_at TEXT;
CREATE INDEX IF NOT EXISTS olvex_subscription_trials ON olvex_subscriptions (business_id, environment, trial_until);
