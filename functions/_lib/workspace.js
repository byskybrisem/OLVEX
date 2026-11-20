import { HttpError } from "./http.js";
import { requireUser, sha256 } from "./session.js";
import { identifier, integer, text } from "./validate.js";

export const EVERY_ROLE = ["owner", "admin", "member"];
export const MANAGERS = ["owner", "admin"];
export const OWNER = ["owner"];

export async function workspace(context, roles = EVERY_ROLE) {
  const db = context.env.DB;
  const user = await requireUser(context.request, db);
  const businessId = text(context.params.businessId, "İşletme kimliği", { max: 100 });
  const business = await db.prepare(`SELECT b.name, m.role FROM business_members m
    JOIN businesses b ON m.business_id = b.id WHERE m.business_id = ? AND m.user_id = ?`)
    .bind(businessId, user.id).first();

  if (!business) throw new HttpError(404, "İşletme bulunamadı.");
  if (!roles.includes(business.role)) throw new HttpError(403, "Bu işlem için yetkiniz yok.");
  return {
    ...context, db, businessId, businessName: business.name,
    user, actorId: user.id, role: business.role, roles
  };
}

export function rowExists(table, id, where = "", ...values) {
  return {
    sql: `EXISTS (SELECT 1 FROM ${table} WHERE business_id = ? AND id = ? ${where})`,
    values: (businessId) => [businessId, id, ...values]
  };
}

export function page(params) {
  const number = integer(Number(params.get("page") ?? 1), "Sayfa", 1, 100_000);
  return { number, limit: 50, offset: (number - 1) * 50 };
}

export async function list(ctx, sql, bindings = []) {
  const { number, limit, offset } = page(ctx.paramsUrl);
  const { results } = await ctx.db.prepare(sql).bind(ctx.businessId, ...bindings, limit + 1, offset).all();
  return { rows: results.slice(0, limit), page: number, hasMore: results.length > limit };
}

export function searchTerm(value) {
  return `%${text(value, "Arama", { min: 0, max: 80 }).replace(/[\\%_]/g, "\\$&")}%`;
}

export async function stableId(value) {
  const hash = await sha256(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function transact(ctx, action, data, statements, guard) {
  const { db, businessId, actorId, pos, roles } = ctx;
  const requestId = identifier(data.requestId, "İstek kimliği");
  const fingerprint = await sha256(JSON.stringify({ ...data, requestId }));
  const premium = ctx.packageGuard;
  if (premium) {
    const operation = guard;
    guard = operation ? {
      sql: `(${premium.sql}) AND (${operation.sql})`,
      values: id => [...premium.values(id), ...operation.values(id)],
      message: operation.message || premium.message
    } : premium;
  }
  const conditions = guard ? guard.values(businessId) : [];
  const checks = [];
  const actorValues = [actorId];
  if (pos) {
    const tokenCheck = ctx.user ? "" : "AND token_hash = ?";
    checks.push(`EXISTS (SELECT 1 FROM olvex_pos_connections WHERE business_id = ? AND id = ?
      AND branch_id = ? AND identity_mode = ? AND revoked_at IS NULL ${tokenCheck})`);
    actorValues.push(businessId, pos.id, pos.branch_id, pos.identity_mode);
    if (!ctx.user) actorValues.push(ctx.tokenHash);
  }
  if (!pos || ctx.user) {
    checks.push(`EXISTS (SELECT 1 FROM business_members WHERE business_id = ? AND user_id = ?
      AND role IN (${roles.map(() => "?").join(", ")}))`);
    actorValues.push(businessId, actorId, ...roles);
  }
  const actorQuery = `SELECT ? WHERE ${checks.join(" AND ")}`;
  const requestIdSql = guard ? `CASE WHEN ${guard.sql} OR EXISTS (
    SELECT 1 FROM olvex_operations WHERE business_id = ? AND request_id = ?
  ) THEN ? ELSE NULL END` : "?";
  if (guard) conditions.push(businessId, requestId);

  try {
    await db.batch([
      db.prepare(`INSERT INTO olvex_operations (business_id, request_id, actor_id, action, fingerprint)
        VALUES (?, ${requestIdSql}, (${actorQuery}), ?, ?)`)
        .bind(businessId, ...conditions, requestId, ...actorValues, action, fingerprint),
      ...statements
    ]);
  } catch (error) {
    const message = error.message || "";
    if (message.includes("UNIQUE constraint failed: olvex_operations.")) {
      const record = await db.prepare(`SELECT actor_id, action, fingerprint FROM olvex_operations
        WHERE business_id = ? AND request_id = ?`).bind(businessId, requestId).first();
      if (record && (record.actor_id === actorId || pos) && record.action === action && record.fingerprint === fingerprint) {
        return { success: true, id: requestId, repeated: true };
      }
      throw new HttpError(409, "Bu istek kimliği başka bir işlemde kullanılmış.");
    }
    if (message.includes("olvex_operations.actor_id")) throw new HttpError(403, "İşlem yetkisi sona ermiş.");
    if (message.includes("olvex_operations.request_id")) {
      throw new HttpError(409, guard?.message || "Kayıt bulunamadı veya durumu değişmiş.");
    }
    if (message.includes("olvex_insufficient_stock")) throw new HttpError(409, "Yeterli stok yok. Kayıt oluşturulmadı.");
    if (message.includes("olvex_stock_limit")) throw new HttpError(409, "Stok üst sınırı aşıldı.");
    if (message.includes("olvex_product_unavailable") || message.includes("olvex_order_items.product_id")) {
      throw new HttpError(400, "Ürün bulunamadı veya arşivlenmiş. SKU bilgilerini kontrol edin.");
    }
    if (message.includes("olvex_pos_connections.token_hash") || message.includes("olvex_pos_token_history.token_hash")) {
      throw new HttpError(409, "Bu kasa anahtarı daha önce kullanılmış.");
    }
    if (message.includes("olvex_invalid_branch")) throw new HttpError(409, "İşlem kasanın kayıtlı şubesiyle uyuşmuyor.");
    if (message.includes("olvex_branches.id")) throw new HttpError(409, "Bu şube kimliği kullanılıyor.");
    if (message.includes("olvex_orders.business_id")) throw new HttpError(409, "Bu satış ya da satın alma referansı daha önce kaydedilmiş.");
    if (message.includes("olvex_products.business_id")) throw new HttpError(409, "Bu SKU işletmede zaten kullanılıyor.");
    if (message.includes("olvex_order_items.business_id")) throw new HttpError(400, "Aynı ürün bir işlemde yalnızca bir satırda yer alabilir.");
    if (message.includes("olvex_invoices.business_id")) throw new HttpError(409, "Bu fatura numarası ve taraf daha önce kaydedilmiş.");
    if (message.includes("olvex_shift_overlap")) throw new HttpError(409, "Bu çalışan için vardiya saatleri çakışıyor.");
    if (message.includes("FOREIGN KEY constraint failed")) throw new HttpError(400, "İlişkili kayıt bulunamadı.");
    throw error;
  }
  return { success: true, id: requestId, repeated: false };
}
