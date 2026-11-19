import { HttpError } from "./http.js";
import { identifier, text } from "./validate.js";
import { list, searchTerm, transact } from "./workspace.js";

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
