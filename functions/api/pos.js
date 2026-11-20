import { clientIp, handle, HttpError, json, readJson } from "../_lib/http.js";
import { professionalGuard, requireProfessional } from "../_lib/entitlements.js";
import { postRegisterEvent } from "../_lib/register.js";
import { sha256, TOKEN_PATTERN } from "../_lib/session.js";
import { isRateLimited, reachedRateLimit } from "./auth/rate-limit.js";

const WINDOW_SECONDS = 60;
const KEY_FAILURE_LIMIT = 20;
const REGISTER_LIMIT = 6000;

function limited() {
  return new HttpError(429, "Kasa istek sınırına ulaşıldı. Aynı işlem kimliğiyle tekrar deneyin.", { "Retry-After": String(WINDOW_SECONDS) });
}

export const onRequestPost = handle(async ({ request, env }) => {
  const prefix = "Bearer olvex_pos_";
  const authorization = request.headers.get("Authorization") || "";
  const secret = authorization.startsWith(prefix) ? authorization.slice(prefix.length) : "";
  const db = env.DB;
  const originKey = `pos-auth:${clientIp(request)}`;
  if (await reachedRateLimit(db, originKey, KEY_FAILURE_LIMIT, WINDOW_SECONDS)) throw limited();
  const tokenHash = TOKEN_PATTERN.test(secret) ? await sha256(secret) : null;
  const pos = tokenHash && await db.prepare(`SELECT c.business_id, c.id, c.created_by, c.branch_id, c.identity_mode
    FROM olvex_pos_connections c JOIN olvex_branches b ON b.business_id = c.business_id AND b.id = c.branch_id
    WHERE c.token_hash = ? AND c.revoked_at IS NULL`).bind(tokenHash).first();
  if (!pos) {
    if (await isRateLimited(db, originKey, KEY_FAILURE_LIMIT, WINDOW_SECONDS)) throw limited();
    throw new HttpError(401, "Kasa anahtarı geçersiz veya bağlantı iptal edilmiş. OLVEX’teki kasa kaydını ve güncel anahtarı kontrol edin.");
  }
  const ctx = { db, env, request, pos, tokenHash, businessId: pos.business_id, actorId: pos.created_by };
  ctx.packageGuard = professionalGuard(await requireProfessional(ctx));
  const configured = Number(env.OLVEX_POS_REQUESTS_PER_MINUTE);
  const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : REGISTER_LIMIT;
  if (await isRateLimited(db, `pos-register:${pos.business_id}:${pos.id}`, limit, WINDOW_SECONDS)) throw limited();
  const body = await readJson(request, 16384);
  const result = await postRegisterEvent(ctx, body);
  // A recorded acknowledgment proves this key reached the API, even on an idempotent replay.
  await db.prepare(`UPDATE olvex_pos_connections SET last_api_success_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE business_id = ? AND id = ? AND token_hash = ? AND revoked_at IS NULL`)
    .bind(pos.business_id, pos.id, tokenHash).run()
    .catch(() => console.warn("OLVEX POS aktarım zamanı kaydedilemedi."));
  return json(result, result.repeated || body.action === "void" ? 200 : 201);
});
