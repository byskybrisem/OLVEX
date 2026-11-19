import { registerOwnsOrder, registeredSaleId } from "./legacy-csv.js";
import { HttpError } from "./http.js";
import { date, integer, MAX_LINES, MAX_QUANTITY, sku, text, today } from "./validate.js";
import { rowExists, stableId, transact } from "./workspace.js";

export async function returnOrder(ctx, body) {
  const { db, businessId, pos } = ctx;
  const reference = text(body.reference, "İade işlem kimliği", { max: 100 });
  const saleReference = text(body.saleReference, "Özgün satış kimliği", { max: 100 });
  const occurredOn = date(body.date, "İade tarihi");
  if (occurredOn > today()) throw new HttpError(400, "İade tarihi bugünden ileri olamaz.");
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > MAX_LINES) {
    throw new HttpError(400, `1 ile ${MAX_LINES} arasında iade satırı girin.`);
  }
  const items = body.lines.map((line) => ({
    sku: sku(line?.sku), quantity: integer(line?.quantity, "İade adedi", 1, MAX_QUANTITY)
  })).sort((a, b) => a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0);
  if (new Set(items.map((item) => item.sku)).size !== items.length) {
    throw new HttpError(400, "Aynı SKU bir iadede yalnızca bir satırda yer alabilir.");
  }

  const requestId = await stableId(JSON.stringify([businessId, pos.id, "return", reference]));
  const orderId = await registeredSaleId(ctx, saleReference);
  const guard = rowExists("olvex_orders", orderId, `AND kind = 'sale' ${registerOwnsOrder} AND status = 'posted' AND occurred_on <= ? AND (paid_on IS NULL OR paid_on <= ?)`,
    pos.branch_id, pos.id, pos.id, occurredOn, occurredOn);
  guard.message = "İade için bu kasaya ait açık bir satış ve geçerli bir tarih gerekli. Satış henüz aktarılmadıysa önce satışı gönderin.";
  try {
    return await transact(ctx, "sale-return", { requestId, reference, saleReference, occurredOn, items }, [
      db.prepare(`INSERT INTO olvex_returns (business_id, id, order_id, register_id, reference, occurred_on, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(businessId, requestId, orderId, pos.id, reference, occurredOn, ctx.actorId),
      ...items.map((item) => db.prepare(`INSERT INTO olvex_return_items (business_id, return_id, order_id, item_id, quantity)
        VALUES (?, ?, ?, (SELECT id FROM olvex_order_items WHERE business_id = ? AND order_id = ? AND product_sku = ? COLLATE NOCASE), ?)`)
        .bind(businessId, requestId, orderId, businessId, orderId, item.sku, item.quantity))
    ], guard);
  } catch (error) {
    if (error.message?.includes("olvex_return_quantity")) {
      throw new HttpError(409, "İade edilen ürün veya miktar satışın kalan kalemleriyle uyuşmuyor.");
    }
    throw error;
  }
}
