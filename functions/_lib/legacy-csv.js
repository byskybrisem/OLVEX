import { HttpError } from "./http.js";
import { sha256 } from "./session.js";
import { choice, identifier, text } from "./validate.js";
import { stableId, transact } from "./workspace.js";

export async function linkLegacyCsv(ctx, body) {
  const registerId = identifier(body.registerId, "Kasa");
  const reference = text(body.reference, "Eski CSV fiş referansı", { max: 100 });
  const evidence = text(body.evidence, "Kaynak belgesi ve kayıt konumu", { max: 200 });
  const decision = choice(body.decision ?? "same", ["same", "distinct"], "Eşleştirme kararı");
  const guard = {
    sql: `EXISTS (SELECT 1 FROM olvex_orders o JOIN olvex_pos_connections c ON c.business_id = o.business_id
      WHERE o.business_id = ? AND o.kind = 'sale' AND o.source = 'csv' AND o.source_key = ''
        AND o.reference = ? AND c.id = ? AND c.revoked_at IS NULL AND (? = 'distinct' OR (
          o.branch_id = c.branch_id AND NOT EXISTS (SELECT 1 FROM olvex_orders p WHERE p.business_id = o.business_id
            AND p.source = 'pos' AND p.kind = 'sale' AND p.source_key = c.id AND p.reference = o.reference))))`,
    values: (businessId) => [businessId, reference, registerId, decision],
    message: "Eski fiş ve etkin kasa bulunmalı. Aynı fiş için kasa stokun işlendiği şubeye ait olmalı ve kasada ayrı bir satış bulunmamalı."
  };
  try {
    return await transact(ctx, "legacy-csv-match", { requestId: body.requestId, registerId, reference, evidence, decision }, [
      ctx.db.prepare(`INSERT INTO olvex_csv_receipt_matches (business_id, order_id, register_id, decision, evidence, approved_by)
        SELECT business_id, id, ?, ?, ?, ? FROM olvex_orders WHERE business_id = ? AND kind = 'sale'
          AND source = 'csv' AND source_key = '' AND reference = ?`)
        .bind(registerId, decision, evidence, ctx.actorId, ctx.businessId, reference)
    ], guard);
  } catch (error) {
    if (error.message?.includes("UNIQUE constraint failed: olvex_csv_receipt_matches.")) {
      throw new HttpError(409, "Bu eski CSV fişi için daha önce kasa kararı kaydedilmiş.");
    }
    throw error;
  }
}

const matchedOrder = `FROM olvex_orders o JOIN olvex_csv_receipt_matches m
  ON m.business_id = o.business_id AND m.order_id = o.id
  WHERE o.business_id = ? AND o.kind = 'sale' AND o.source = 'csv' AND o.source_key = ''
    AND o.reference = ? AND m.decision = 'same' AND m.register_id = ?`;

export async function registeredSaleId(ctx, reference) {
  const matched = await ctx.db.prepare(`SELECT o.id ${matchedOrder}`).bind(ctx.businessId, reference, ctx.pos.id).first();
  return matched?.id ?? await stableId(JSON.stringify([ctx.businessId, ctx.pos.id, "sale", reference]));
}

// Used inside the reversal/return write guard; the original CSV sale keeps its historical ID.
export const registerOwnsOrder = `AND branch_id = ? AND (
  (source = 'pos' AND source_key = ?) OR (source = 'csv' AND EXISTS (
    SELECT 1 FROM olvex_csv_receipt_matches m WHERE m.business_id = olvex_orders.business_id
      AND m.order_id = olvex_orders.id AND m.register_id = ? AND m.decision = 'same')))`;

export async function replayLegacyCsv(ctx, data) {
  const match = await ctx.db.prepare(`SELECT o.id, (SELECT fingerprint FROM olvex_operations op
    WHERE op.business_id = o.business_id AND op.request_id = o.id AND op.action = 'sale-create') AS fingerprint
    ${matchedOrder}`).bind(ctx.businessId, data.reference, ctx.pos.id).first();
  if (!match) throw new HttpError(409, "Bu referansta kasa bilgisi eksik bir eski CSV fişi var. Kaynak belgesini doğrulayıp fişi kasayla eşleştirin.");
  const fingerprint = await sha256(JSON.stringify({ ...data, requestId: match.id, source: "csv" }));
  if (match.fingerprint !== fingerprint) throw new HttpError(409, "Gönderilen işlem eşleştirilmiş eski CSV satışının içeriğiyle uyuşmuyor.");
  return { success: true, id: match.id, repeated: true };
}
