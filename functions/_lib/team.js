import { resolveBranch } from "./branches.js";
import { HttpError } from "./http.js";
import { sha256, TOKEN_PATTERN } from "./session.js";
import { choice, email, identifier, text } from "./validate.js";
import { list, rowExists, searchTerm, transact } from "./workspace.js";

export async function settings(ctx) {
  const queries = [
    ctx.db.prepare(`SELECT u.id, u.full_name AS name, u.email, m.role FROM business_members m
      JOIN users u ON u.id = m.user_id WHERE m.business_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.email`).bind(ctx.businessId)
  ];
  if (ctx.role === "owner") {
    queries.push(ctx.db.prepare(`SELECT id, email, role, expires_at FROM olvex_invitations
      WHERE business_id = ? AND revoked_at IS NULL AND accepted_by IS NULL AND expires_at > ?
      ORDER BY expires_at DESC`).bind(ctx.businessId, new Date().toISOString()));
  }
  const [members, invites] = await ctx.db.batch(queries);
  return { members: members.results, invites: invites?.results ?? [] };
}

export function rename(ctx, body) {
  const name = text(body.name, "İşletme adı", { min: 2, max: 100 });
  return transact(ctx, "business-rename", { requestId: body.requestId, name }, [
    ctx.db.prepare("UPDATE businesses SET name = ? WHERE id = ?").bind(name, ctx.businessId)
  ]);
}

export async function invite(ctx, body) {
  if (typeof body.secret !== "string" || !TOKEN_PATTERN.test(body.secret)) {
    throw new HttpError(400, "Davet kodu geçersiz.");
  }
  const data = {
    requestId: identifier(body.requestId), email: email(body.email),
    role: choice(body.role, ["admin", "member"], "Rol"), hash: await sha256(body.secret)
  };
  const validUntil = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
  return transact(ctx, "invite-create", data, [
    ctx.db.prepare(`INSERT INTO olvex_invitations (business_id, id, token_hash, email, role, created_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(ctx.businessId, data.requestId, data.hash, data.email, data.role, ctx.actorId, validUntil)
  ]);
}

export function revokeInvite(ctx, body) {
  const id = identifier(body.id);
  return transact(ctx, "invite-revoke", { requestId: body.requestId, id }, [
    ctx.db.prepare("UPDATE olvex_invitations SET revoked_at = CURRENT_TIMESTAMP WHERE business_id = ? AND id = ?")
      .bind(ctx.businessId, id)
  ], rowExists("olvex_invitations", id, "AND accepted_by IS NULL AND revoked_at IS NULL"));
}

export function changeMember(ctx, body) {
  const userId = identifier(body.userId, "Kullanıcı");
  const role = choice(body.role, ["admin", "member", "remove"], "Rol");
  const guard = {
    sql: "EXISTS (SELECT 1 FROM business_members WHERE business_id = ? AND user_id = ? AND role <> 'owner')",
    values: (businessId) => [businessId, userId]
  };
  const query = role === "remove"
    ? ctx.db.prepare("DELETE FROM business_members WHERE business_id = ? AND user_id = ?").bind(ctx.businessId, userId)
    : ctx.db.prepare("UPDATE business_members SET role = ? WHERE business_id = ? AND user_id = ?")
      .bind(role, ctx.businessId, userId);
  return transact(ctx, "member-change", { requestId: body.requestId, userId, role }, [query], guard);
}

export function posConnections(ctx) {
  const query = searchTerm(ctx.paramsUrl.get("q"));
  const active = ctx.paramsUrl.get("active") === "1";
  return list(ctx, `SELECT p.id, p.name, p.created_at, p.revoked_at, p.branch_id, p.identity_mode,
    p.device_brand, p.device_software, p.last_api_success_at, b.name AS branch_name
    FROM olvex_pos_connections p JOIN olvex_branches b ON b.id = p.branch_id AND b.business_id = p.business_id
    WHERE p.business_id = ? AND (? = 0 OR p.revoked_at IS NULL)
      AND (p.name LIKE ? ESCAPE '\\' OR p.id LIKE ? ESCAPE '\\' OR b.name LIKE ? ESCAPE '\\')
    ORDER BY p.revoked_at IS NOT NULL, p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`, [active ? 1 : 0, query, query, query]);
}

function posTokenHash(secret) {
  if (typeof secret !== "string" || !TOKEN_PATTERN.test(secret)) {
    throw new HttpError(400, "Bağlantı anahtarı geçersiz.");
  }
  return sha256(secret);
}

export async function createPos(ctx, body) {
  const hash = await posTokenHash(body.secret);
  const branchId = await resolveBranch(ctx, body.branchId);
  const identityMode = choice(body.identityMode ?? "reconcile", ["native", "reconcile"], "Kaynak kimliği doğrulama yöntemi");
  const data = {
    requestId: identifier(body.requestId), name: text(body.name, "Bağlantı adı", { max: 80 }),
    hash,
    ...(body.branchId != null && { branchId }),
    ...(body.identityMode != null && { identityMode }),
    ...(body.brand != null && { brand: text(body.brand, "Kasa markası", { min: 0, max: 80 }) }),
    ...(body.software != null && { software: text(body.software, "Satış yazılımı", { min: 0, max: 100 }) })
  };
  return transact(ctx, "pos-create", data, [
    ctx.db.prepare(`INSERT INTO olvex_pos_connections (business_id, id, name, token_hash, created_by, branch_id, identity_mode, device_brand, device_software)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(ctx.businessId, data.requestId, data.name, data.hash, ctx.actorId, branchId, identityMode, data.brand || null, data.software || null)
  ]);
}

export async function rotatePos(ctx, body) {
  const id = identifier(body.id, "Kasa");
  const hash = await posTokenHash(body.secret);
  return transact(ctx, "pos-rotate", { requestId: body.requestId, id, hash }, [
    ctx.db.prepare("UPDATE olvex_pos_connections SET token_hash = ?, revoked_at = NULL, last_api_success_at = NULL WHERE business_id = ? AND id = ?")
      .bind(hash, ctx.businessId, id)
  ], rowExists("olvex_pos_connections", id));
}

export function setPosIdentity(ctx, body) {
  const id = identifier(body.id, "Kasa");
  const identityMode = choice(body.identityMode, ["native", "reconcile"], "Kaynak kimliği doğrulama yöntemi");
  return transact(ctx, "pos-identity", { requestId: body.requestId, id, identityMode }, [
    ctx.db.prepare("UPDATE olvex_pos_connections SET identity_mode = ? WHERE business_id = ? AND id = ?")
      .bind(identityMode, ctx.businessId, id)
  ], rowExists("olvex_pos_connections", id, "AND revoked_at IS NULL"));
}

export function revokePos(ctx, body) {
  const id = identifier(body.id);
  return transact(ctx, "pos-revoke", { requestId: body.requestId, id }, [
    ctx.db.prepare("UPDATE olvex_pos_connections SET revoked_at = CURRENT_TIMESTAMP WHERE business_id = ? AND id = ?")
      .bind(ctx.businessId, id)
  ], rowExists("olvex_pos_connections", id, "AND revoked_at IS NULL"));
}
