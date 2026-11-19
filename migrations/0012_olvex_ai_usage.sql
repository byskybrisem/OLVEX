CREATE TABLE olvex_ai_usage (
  id TEXT PRIMARY KEY NOT NULL,
  day TEXT NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  cached_tokens INTEGER,
  cache_write_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  estimated_nano_usd INTEGER
);
CREATE INDEX idx_olvex_ai_usage_day_business ON olvex_ai_usage(day, business_id);
CREATE INDEX idx_olvex_ai_usage_day_user ON olvex_ai_usage(day, user_id);
CREATE INDEX idx_olvex_ai_usage_business_day ON olvex_ai_usage(business_id, day);
