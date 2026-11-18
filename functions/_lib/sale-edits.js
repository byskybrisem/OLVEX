import { HttpError } from "./http.js";
import { identifier, integer, MAX_LINES, MAX_QUANTITY, MAX_UNIT_MINOR, text } from "./validate.js";
import { list, rowExists, transact } from "./workspace.js";

export function saleEditHistory(ctx) {
  const id = identifier(ctx.paramsUrl.get("id"), "Satış");
  return list(ctx, `SELECT e.revision, e.reason, e.old_reference, e.new_reference, e.old_note, e.new_note,
      e.line_changes, op.created_at, u.full_name AS actor
    FROM olvex_sale_edits e JOIN olvex_operations op
      ON op.business_id = e.business_id AND op.request_id = e.request_id
    JOIN users u ON u.id = op.actor_id WHERE e.business_id = ? AND e.order_id = ?
    ORDER BY e.revision DESC LIMIT ? OFFSET ?`, [id]);
}

export function editSale(ctx, body) {
  const { db, businessId, actorId } = ctx;
  const requestId = identifier(body.requestId);
  const id = identifier(body.id, "Satış");
  const revision = integer(body.revision, "Sürüm", 0, Number.MAX_SAFE_INTEGER);
  const reference = text(body.reference, "Referans", { min: 0, max: 100 }) || null;
  const note = text(body.note, "Not", { min: 0, max: 500 });
  const reason = text(body.reason, "Düzeltme nedeni", { max: 180 });
  if (!Array.isArray(body.lines) || body.lines.length > MAX_LINES) throw new HttpError(400, "Satış satırlarını kontrol edin.");
  const lines = body.lines.map(line => ({
    id: identifier(line?.id, "Satır"),
    quantity: integer(line.quantity, "Adet", 1, MAX_QUANTITY),
    unit: integer(line.unit, "Birim fiyat", 0, MAX_UNIT_MINOR)
  })).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(lines.map(line => line.id)).size !== lines.length) throw new HttpError(400, "Tekrarlanan satış satırı.");
  const changes = JSON.stringify(lines);
  // Only changed lines of this exact order may be included. All checks run inside the write batch.
  const joined = `FROM olvex_order_items i JOIN json_each(?) j ON j.value ->> 'id' = i.id
    WHERE i.business_id = ? AND i.order_id = ?`;
  const guard = rowExists("olvex_orders", id, `AND kind = 'sale' AND source = 'manual' AND status = 'posted'
    AND revision = ? AND (paid_on IS NULL OR ? = 0)
    AND (? > 0 OR reference IS NOT ? OR note <> ?)
    AND (SELECT count(*) ${joined} AND (i.quantity <> j.value ->> 'quantity' OR i.unit_minor <> j.value ->> 'unit')) = ?`,
    revision, lines.length, lines.length, reference, note, changes, businessId, id, lines.length);
  guard.message = "Değişiklik uygulanamadı. Satışı yenileyip durumunu ve değiştirdiğiniz alanları kontrol edin.";
  const data = { requestId, id, revision, reference, note, reason, lines };
  return transact(ctx, "sale-edit", data, [
    db.prepare(`INSERT INTO olvex_sale_edits (business_id, order_id, revision, request_id, reason,
        old_reference, new_reference, old_note, new_note, line_changes)
      SELECT business_id, id, revision + 1, ?, ?, reference, ?, note, ?,
        (SELECT json_group_array(json_object('sku', i.product_sku, 'oldQuantity', i.quantity,
          'newQuantity', j.value ->> 'quantity', 'oldUnit', i.unit_minor, 'newUnit', j.value ->> 'unit'))
         ${joined}) FROM olvex_orders WHERE business_id = ? AND id = ?`)
      .bind(requestId, reason, reference, note, changes, businessId, id, businessId, id),
    db.prepare(`INSERT INTO olvex_stock_movements (business_id, id, product_id, order_id, kind, delta, note, created_by)
      SELECT i.business_id, ? || ':' || i.id, i.product_id, i.order_id, 'adjustment',
        i.quantity - (j.value ->> 'quantity'), ?, ? ${joined} AND i.quantity <> j.value ->> 'quantity'`)
      .bind(requestId, reason, actorId, changes, businessId, id),
    db.prepare(`UPDATE olvex_order_items SET quantity = j.value ->> 'quantity', unit_minor = j.value ->> 'unit'
      FROM json_each(?) j WHERE business_id = ? AND order_id = ? AND olvex_order_items.id = j.value ->> 'id'`)
      .bind(changes, businessId, id),
    db.prepare(`UPDATE olvex_orders SET reference = ?, note = ?, revision = revision + 1
      WHERE business_id = ? AND id = ?`).bind(reference, note, businessId, id)
  ], guard);
}
