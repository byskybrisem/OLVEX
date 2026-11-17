import { HttpError } from "./http.js";
import { sha256, TOKEN_PATTERN } from "./session.js";
import { choice, email, identifier, text } from "./validate.js";
import { list, rowExists, transact } from "./workspace.js";

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
  return list(ctx, `SELECT id, name, created_at, revoked_at FROM olvex_pos_connections WHERE business_id = ?
    ORDER BY revoked_at IS NOT NULL, created_at DESC, id DESC LIMIT ? OFFSET ?`);
}

export async function createPos(ctx, body) {
  if (typeof body.secret !== "string" || !TOKEN_PATTERN.test(body.secret)) {
    throw new HttpError(400, "Bağlantı anahtarı geçersiz.");
  }
  const data = {
    requestId: identifier(body.requestId), name: text(body.name, "Bağlantı adı", { max: 80 }),
    hash: await sha256(body.secret)
  };
  try {
    return await transact(ctx, "pos-create", data, [
      ctx.db.prepare(`INSERT INTO olvex_pos_connections (business_id, id, name, token_hash, created_by)
        VALUES (?, ?, ?, ?, ?)`)
        .bind(ctx.businessId, data.requestId, data.name, data.hash, ctx.actorId)
    ]);
  } catch (error) {
    if (error.message?.includes("olvex_pos_connections.token_hash")) {
      throw new HttpError(409, "Bu bağlantı anahtarı daha önce kullanılmış.");
    }
    throw error;
  }
}

export function revokePos(ctx, body) {
  const id = identifier(body.id);
  return transact(ctx, "pos-revoke", { requestId: body.requestId, id }, [
    ctx.db.prepare("UPDATE olvex_pos_connections SET revoked_at = CURRENT_TIMESTAMP WHERE business_id = ? AND id = ?")
      .bind(ctx.businessId, id)
  ], rowExists("olvex_pos_connections", id, "AND revoked_at IS NULL"));
}
