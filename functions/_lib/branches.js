import { HttpError } from "./http.js";
import { date, identifier, integer, MAX_STOCK, text, today } from "./validate.js";
import { list, searchTerm, stableId, transact } from "./workspace.js";

export function locations(ctx) {
  const search = searchTerm(ctx.paramsUrl.get("q"));
  return list(ctx, `SELECT id, name, is_default FROM olvex_branches WHERE business_id = ?
    AND (name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')
    ORDER BY is_default DESC, name COLLATE NOCASE, id LIMIT ? OFFSET ?`, [search, search]);
}

export function createBranch(ctx, body) {
  const requestId = identifier(body.requestId);
  const name = text(body.name, "Şube adı", { max: 100 });
  return transact(ctx, "branch-create", { requestId, name }, [
    ctx.db.prepare("INSERT INTO olvex_branches (business_id, id, name) VALUES (?, ?, ?)")
      .bind(ctx.businessId, requestId, name)
  ]);
}

export async function resolveBranch(ctx, branchId) {
  const explicit = branchId != null;
  const branch = await ctx.db.prepare(`SELECT id FROM olvex_branches WHERE business_id = ?
    AND ${explicit ? "id = ?" : "is_default = 1"}`)
    .bind(ctx.businessId, ...(explicit ? [identifier(branchId, "Şube")] : [])).first();
  if (!branch) throw new HttpError(404, "Şube bulunamadı.");
  return branch.id;
}

export function transferHistory(ctx) {
  const search = searchTerm(ctx.paramsUrl.get("q"));
  return list(ctx, `SELECT t.id, t.source_branch_id, t.destination_branch_id, src.name AS source_name,
      dst.name AS destination_name, t.product_id, p.sku, p.name, t.quantity, t.note, t.created_at,
      COALESCE(t.occurred_on, substr(t.created_at, 1, 10)) AS occurred_on,
      t.created_by, COALESCE(NULLIF(u.full_name, ''), u.id) AS actor_name
    FROM olvex_stock_transfers t
    JOIN olvex_branches src ON src.business_id = t.business_id AND src.id = t.source_branch_id
    JOIN olvex_branches dst ON dst.business_id = t.business_id AND dst.id = t.destination_branch_id
    JOIN olvex_products p ON p.business_id = t.business_id AND p.id = t.product_id
    JOIN users u ON u.id = t.created_by
    WHERE t.business_id = ? AND (src.name LIKE ? ESCAPE '\\' OR dst.name LIKE ? ESCAPE '\\'
      OR p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR t.note LIKE ? ESCAPE '\\')
    ORDER BY occurred_on DESC, t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`,
  [search, search, search, search, search]);
}

export async function createTransfer(ctx, body) {
  const data = {
    requestId: identifier(body.requestId),
    sourceBranchId: identifier(body.sourceBranchId, "Kaynak şube"),
    destinationBranchId: identifier(body.destinationBranchId, "Hedef şube"),
    productId: identifier(body.productId, "Ürün"),
    quantity: integer(body.quantity, "Transfer adedi", 1, MAX_STOCK),
    date: date(body.date, "Transfer tarihi"),
    note: text(body.note, "Açıklama", { min: 0, max: 500 })
  };
  if (data.sourceBranchId === data.destinationBranchId) throw new HttpError(400, "Kaynak ve hedef şube farklı olmalı.");
  if (data.date > today()) throw new HttpError(400, "Transfer tarihi bugünden ileri olamaz.");
  await Promise.all([resolveBranch(ctx, data.sourceBranchId), resolveBranch(ctx, data.destinationBranchId)]);
  const id = await stableId(JSON.stringify(["transfer", ctx.businessId, data.requestId]));
  const result = await transact(ctx, "stock-transfer", data, [
    ctx.db.prepare(`INSERT INTO olvex_stock_transfers (business_id, id, source_branch_id, destination_branch_id,
      product_id, quantity, occurred_on, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(ctx.businessId, id, data.sourceBranchId, data.destinationBranchId, data.productId, data.quantity,
        data.date, data.note, ctx.actorId)
  ]);
  return { ...result, id };
}
