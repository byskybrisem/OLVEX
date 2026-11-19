import { sha256 } from "../../_lib/session.js";

// Failed key attempts and successful register traffic have independent budgets.
export async function reachedRateLimit(db, key, limit, windowSeconds) {
  const since = Math.floor(Date.now() / 1000) - windowSeconds;
  const row = await db.prepare(`SELECT 1 FROM auth_rate_limits
    WHERE key_hash = ? AND window_started_at > ? AND attempts >= ?`)
    .bind(await sha256(key), since, limit).first();
  return row !== null;
}

export async function isRateLimited(db, key, limit, windowSeconds) {
  const keyHash = await sha256(key);
  const now = Math.floor(Date.now() / 1000);

  const result = await db.prepare(`
    INSERT INTO auth_rate_limits
      (key_hash, attempts, window_started_at, blocked_until, updated_at)
    VALUES (?, 1, ?, NULL, ?)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE
        WHEN auth_rate_limits.window_started_at <= excluded.updated_at - ?
        THEN 1
        ELSE auth_rate_limits.attempts + 1
      END,
      window_started_at = CASE
        WHEN auth_rate_limits.window_started_at <= excluded.updated_at - ?
        THEN excluded.updated_at
        ELSE auth_rate_limits.window_started_at
      END,
      updated_at = excluded.updated_at
    RETURNING attempts
  `).bind(
    keyHash,
    now,
    now,
    windowSeconds,
    windowSeconds
  ).first();

  if (!result) {
    throw new Error("Rate limit kontrolü başarısız.");
  }

  return Number(result.attempts) > limit;
}

export async function clearRateLimit(db, key) {
  const keyHash = await sha256(key);

  await db.prepare(
    "DELETE FROM auth_rate_limits WHERE key_hash = ?"
  ).bind(keyHash).run();
}
