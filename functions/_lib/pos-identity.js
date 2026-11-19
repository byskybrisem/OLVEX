import { HttpError } from "./http.js";
import { choice, identifier, text } from "./validate.js";
import { rowExists, transact } from "./workspace.js";

function sourceKey(value, label, max = 100) {
  const key = text(value, label, { max });
  if (key !== value || /[\x00-\x1f\x7f]/.test(key)) throw new HttpError(400, `${label} geçersiz.`);
  return key;
}

function locator(value) {
  return sourceKey(value, "Kaynak belgesi ve kayıt konumu", 200);
}

export async function reconcilePos(ctx, body) {
  const registerId = identifier(body.registerId, "Kasa");
  const eventKind = choice(body.eventKind, ["sale", "return"], "Kaynak kayıt türü");
  const evidence = locator(body.evidence);
  const reference = sourceKey(body.reference, "Kalıcı referans");
  const guard = rowExists("olvex_pos_connections", registerId, "AND revoked_at IS NULL AND identity_mode = 'reconcile'");
  guard.message = "Bu kasa uzlaştırma için etkin değil.";
  try {
    return await transact(ctx, "pos-source-map", { requestId: body.requestId, registerId, eventKind, evidence, reference }, [
      ctx.db.prepare(`INSERT INTO olvex_pos_source_map
        (business_id, register_id, event_kind, evidence, reference, approved_by) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(ctx.businessId, registerId, eventKind, evidence, reference, ctx.actorId)
    ], guard);
  } catch (error) {
    if (error.message?.includes("UNIQUE constraint failed: olvex_pos_source_map.")) {
      throw new HttpError(409, "Bu kasa için kaynak kaydı veya kalıcı referans zaten eşleştirilmiş.");
    }
    throw error;
  }
}

async function referenceFor(ctx, kind, evidence) {
  if (!evidence) throw new HttpError(409, "Bu kasa için onaylanmış kaynak kaydı gerekli.");
  const row = await ctx.db.prepare(`SELECT reference FROM olvex_pos_source_map
    WHERE business_id = ? AND register_id = ? AND event_kind = ? AND evidence = ?`)
    .bind(ctx.businessId, ctx.pos.id, kind, locator(evidence)).first();
  if (!row) throw new HttpError(409, "Kaynak kaydının kasa yöneticisi tarafından uzlaştırılması gerekiyor.");
  return row.reference;
}

export async function sourceReferences(ctx, action, body) {
  if (ctx.pos.identity_mode === "native") return {
    reference: sourceKey(body.reference, "Kalıcı kaynak işlem kimliği"),
    ...(action === "return" ? { saleReference: sourceKey(body.saleReference, "Satış referansı") } : {})
  };
  const reference = await referenceFor(ctx, action === "void" ? "sale" : action, body.evidence);
  const saleReference = action === "return" ? await referenceFor(ctx, "sale", body.saleEvidence) : undefined;
  if ((body.reference != null && body.reference !== reference) ||
      (body.saleReference != null && body.saleReference !== saleReference)) {
    throw new HttpError(409, "Gönderilen referans onaylı kaynak kaydıyla uyuşmuyor.");
  }
  return { reference, saleReference };
}
