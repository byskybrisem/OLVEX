import { handle, HttpError, json, readJson, sameOrigin } from "../_lib/http.js";
import { subscriptionEnvironment, professionalSql, seatLimitSql } from "../_lib/entitlements.js";
import { requireUser, sha256, TOKEN_PATTERN } from "../_lib/session.js";
import { isRateLimited } from "./auth/rate-limit.js";

export const onRequestPost = handle(async ({ request, env }) => {
  sameOrigin(request);
  const db = env.DB;
  const user = await requireUser(request, db);
  const { token } = await readJson(request, 2048);
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw new HttpError(400, "Davet kodu geçersiz.");
  if (await isRateLimited(db, `invite-join:${user.id}`, 20, 900)) {
    throw new HttpError(429, "Biraz sonra tekrar deneyin.", { "Retry-After": "900" });
  }
  const hash = await sha256(token);
  const environment = subscriptionEnvironment({ env, request });
  const invitation = await db.prepare(`SELECT business_id, role FROM olvex_invitations
    WHERE token_hash = ? AND email = ? COLLATE NOCASE AND accepted_by IS NULL AND revoked_at IS NULL AND expires_at > ?`)
    .bind(hash, user.email, new Date().toISOString()).first();
  const guard = `AND (role = 'member' OR ${professionalSql})
    AND ((SELECT COUNT(*) FROM business_members WHERE business_id = ?) < ${seatLimitSql}
      OR EXISTS (SELECT 1 FROM business_members WHERE business_id = ? AND user_id = ?))`;
  const scoped = invitation ? [invitation.business_id, environment, invitation.business_id, invitation.business_id, environment,
    invitation.business_id, user.id] : [];
  let record = invitation && await db.prepare(`UPDATE olvex_invitations SET accepted_by = ?
    WHERE token_hash = ? AND email = ? COLLATE NOCASE AND accepted_by IS NULL AND revoked_at IS NULL AND expires_at > ?
    ${guard} RETURNING business_id`).bind(user.id, hash, user.email, new Date().toISOString(), ...scoped).first();
  if (!record) {
    record = await db.prepare(`SELECT i.business_id FROM olvex_invitations i JOIN business_members m
      ON i.business_id = m.business_id AND i.accepted_by = m.user_id
      WHERE i.token_hash = ? AND i.accepted_by = ?`).bind(hash, user.id).first();
  }
  if (!record && invitation) throw new HttpError(409, "Bu davet mevcut paketin kullanıcı sınırı veya rol kuralı nedeniyle kabul edilemiyor.");
  if (!record) throw new HttpError(400, "Bu davet hesabınız için geçerli değil veya süresi dolmuş.");
  return json({ success: true, businessId: record.business_id });
});
