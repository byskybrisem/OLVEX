import { handle, HttpError, json, readJson } from "../_lib/http.js";
import { createOrder, voidOrder } from "../_lib/inventory.js";
import { sha256, TOKEN_PATTERN } from "../_lib/session.js";
import { choice, text } from "../_lib/validate.js";
import { stableId } from "../_lib/workspace.js";

export const onRequestPost = handle(async ({ request, env }) => {
  const prefix = "Bearer olvex_pos_";
  const authorization = request.headers.get("Authorization") || "";
  const secret = authorization.startsWith(prefix) ? authorization.slice(prefix.length) : "";
  if (!TOKEN_PATTERN.test(secret)) throw new HttpError(401, "POS anahtarı geçersiz.");
  const db = env.DB;
  const pos = await db.prepare(`SELECT business_id, id, created_by
    FROM olvex_pos_connections WHERE token_hash = ? AND revoked_at IS NULL`).bind(await sha256(secret)).first();
  if (!pos) throw new HttpError(401, "POS anahtarı geçersiz.");
  const ctx = { db, pos, businessId: pos.business_id, actorId: pos.created_by };
  const body = await readJson(request, 16384);
  const action = choice(body.action, ["sale", "void"], "POS işlemi");
  const reference = text(body.reference, "Satış referansı", { max: 100 });
  if (action === "sale") {
    const result = await createOrder(ctx, { ...body, reference, customerId: null }, "sale", "pos");
    return json(result, result.repeated ? 200 : 201);
  }

  const id = await stableId(JSON.stringify([ctx.businessId, pos.id, "sale", reference]));
  const requestId = await stableId(JSON.stringify([ctx.businessId, pos.id, "void", reference]));
  const row = await db.prepare("SELECT status FROM olvex_orders WHERE business_id = ? AND id = ?")
    .bind(ctx.businessId, id).first();
  if (!row) throw new HttpError(404, "Bu bağlantıya ait satış bulunamadı.");
  if (row.status === "void") return json({ success: true, id: requestId, repeated: true });
  return json(await voidOrder(ctx, { id, requestId, date: body.date }, "sale"));
});
