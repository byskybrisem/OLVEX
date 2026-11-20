import { HttpError } from "./http.js";
import { createOrder, voidOrder } from "./inventory.js";
import { registeredSaleId } from "./legacy-csv.js";
import { sourceReferences } from "./pos-identity.js";
import { returnOrder } from "./returns.js";
import { choice, identifier, text } from "./validate.js";
import { list, searchTerm, stableId } from "./workspace.js";

export async function postRegisterEvent(ctx, body) {
  const { pos } = ctx;
  for (const [key, actual] of [["businessId", pos.business_id], ["branchId", pos.branch_id], ["registerId", pos.id]]) {
    if (Object.hasOwn(body, key) && body[key] !== actual) throw new HttpError(403, "Kasa bu işletme veya şube için yetkili değil.");
  }
  const action = choice(body.action, ["sale", "void", "return"], "POS işlemi");
  const refs = await sourceReferences(ctx, action, body);
  if (action === "void") {
    const id = await registeredSaleId(ctx, refs.reference);
    const requestId = await stableId(JSON.stringify([ctx.businessId, pos.id, "void", refs.reference]));
    return voidOrder(ctx, { id, requestId, date: body.date }, "sale");
  }
  if (action === "return") return returnOrder(ctx, { ...body, ...refs });
  if (body.paid !== undefined && typeof body.paid !== "boolean") {
    throw new HttpError(400, "Ödeme bilgisi true veya false olmalı.");
  }
  return createOrder(ctx, { ...body, ...refs, customerId: null }, "sale", "pos");
}

export function csvSources(ctx) {
  const term = searchTerm(ctx.paramsUrl.get("q"));
  return list(ctx, `SELECT p.id, p.name, b.name AS branch_name
    FROM olvex_pos_connections p JOIN olvex_branches b ON b.business_id = p.business_id AND b.id = p.branch_id
    WHERE p.business_id = ? AND p.revoked_at IS NULL
      AND (p.name LIKE ? ESCAPE '\\' OR b.name LIKE ? ESCAPE '\\')
    ORDER BY p.name COLLATE NOCASE, p.id LIMIT ? OFFSET ?`, [term, term]);
}

export async function importRegisterSale(ctx, body) {
  if (body.csvMode === "file" && body.registerId == null) {
    return createOrder(ctx, body, "sale", "csv");
  }
  if (body.registerId == null) {
    // Older clients may retry receipts already committed before registers were introduced.
    const existing = await ctx.db.prepare(`SELECT id FROM olvex_orders WHERE business_id = ?
      AND kind = 'sale' AND source = 'csv' AND source_key = '' AND reference = ?`)
      .bind(ctx.businessId, text(body.reference, "Referans", { max: 100 })).first();
    if (!existing) throw new HttpError(400, "CSV satışının kaynak kasasını seçin.");
    return createOrder(ctx, body, "sale", "csv");
  }
  const registerId = identifier(body.registerId, "Kasa");
  const pos = await ctx.db.prepare(`SELECT id, business_id, branch_id, identity_mode FROM olvex_pos_connections
    WHERE business_id = ? AND id = ? AND revoked_at IS NULL`).bind(ctx.businessId, registerId).first();
  if (!pos) throw new HttpError(403, "Bu işletmede etkin bir kaynak kasa seçin.");
  const sale = { ...body, action: "sale" };
  if (pos.identity_mode === "reconcile") {
    sale.evidence = body.reference;
    delete sale.reference;
  }
  return postRegisterEvent({ ...ctx, pos }, sale);
}
