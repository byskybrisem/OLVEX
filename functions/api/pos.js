import { handle, HttpError, json, readJson } from "../_lib/http.js";
import { postRegisterEvent } from "../_lib/register.js";
import { sha256, TOKEN_PATTERN } from "../_lib/session.js";

export const onRequestPost = handle(async ({ request, env }) => {
  const prefix = "Bearer olvex_pos_";
  const authorization = request.headers.get("Authorization") || "";
  const secret = authorization.startsWith(prefix) ? authorization.slice(prefix.length) : "";
  if (!TOKEN_PATTERN.test(secret)) throw new HttpError(401, "POS anahtarı geçersiz.");
  const db = env.DB;
  const tokenHash = await sha256(secret);
  const pos = await db.prepare(`SELECT c.business_id, c.id, c.created_by, c.branch_id, c.identity_mode
    FROM olvex_pos_connections c JOIN olvex_branches b ON b.business_id = c.business_id AND b.id = c.branch_id
    WHERE c.token_hash = ? AND c.revoked_at IS NULL`).bind(tokenHash).first();
  if (!pos) throw new HttpError(401, "POS anahtarı geçersiz.");
  const body = await readJson(request, 16384);
  const result = await postRegisterEvent({ db, pos, tokenHash, businessId: pos.business_id, actorId: pos.created_by }, body);
  return json(result, result.repeated || body.action === "void" ? 200 : 201);
});
