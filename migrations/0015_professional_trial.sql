-- Additive migration: existing Esnaf subscriptions and customer records remain intact.
ALTER TABLE olvex_subscriptions ADD COLUMN trial_until INTEGER;
ALTER TABLE olvex_subscriptions ADD COLUMN billing_terms_accepted_at TEXT;
CREATE INDEX IF NOT EXISTS olvex_subscription_trials ON olvex_subscriptions (business_id, environment, trial_until);
ALTER TABLE olvex_subscriptions ADD COLUMN trial_started_at INTEGER;
ALTER TABLE olvex_subscriptions ADD COLUMN cancel_requested_at INTEGER;
ALTER TABLE olvex_subscriptions ADD COLUMN trial_owner_id TEXT;
ALTER TABLE olvex_subscriptions ADD COLUMN trial_identity_key TEXT;

-- Reserve before calling the provider. A definitive initialization failure releases the reservation.
CREATE UNIQUE INDEX olvex_trial_owner ON olvex_subscriptions(environment, trial_owner_id)
  WHERE trial_owner_id IS NOT NULL AND (state != 'failed' OR trial_started_at IS NOT NULL);
CREATE UNIQUE INDEX olvex_trial_identity ON olvex_subscriptions(environment, trial_identity_key)
  WHERE trial_identity_key IS NOT NULL AND (state != 'failed' OR trial_started_at IS NOT NULL);
