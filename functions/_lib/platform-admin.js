import { HttpError } from "./http.js";
import { platformAdminId, PLATFORM_ADMIN_SESSION_SECONDS, requireUser } from "./session.js";
import { choice, date, identifier, integer, period, text, today, addDays } from "./validate.js";

const SUBSCRIPTION_EXEMPT_EMAIL = "vayymatik0@gmail.com";

// Use a stable, private user ID, not an email address, tenant owner role, or
// a client-side flag. Fail closed until an operator explicitly provisions it.
export async function requirePlatformAdmin(request, env) {
  const user = await requireUser(request, env.DB, PLATFORM_ADMIN_SESSION_SECONDS);
  const allowedId = platformAdminId(env);
  if (!allowedId) {
    throw new HttpError(503, "Yönetici erişimi henüz yapılandırılmadı.");
  }
  if (user.id.toLowerCase() !== allowedId) {
    throw new HttpError(403, "Bu bölüme erişim yetkiniz yok.");
  }
  return user;
}

// The exemption is deliberately narrower than platform administration. A configured
// platform-admin ID alone is insufficient: the verified user must also own the
// explicitly approved account. Browser requests repeat the normal fresh-session
// Super Admin check. POS requests have no browser session, so their server-stored
// key creator is checked against the same configured identity and email instead.
export async function hasSubscriptionExemption(ctx) {
  const allowedId = platformAdminId(ctx.env);
  if (!allowedId || typeof ctx.actorId !== "string" || ctx.actorId.toLowerCase() !== allowedId) return false;

  if (ctx.user) {
    try {
      const user = await requirePlatformAdmin(ctx.request, ctx.env);
      return user.id.toLowerCase() === ctx.actorId.toLowerCase() &&
        user.email.toLowerCase() === SUBSCRIPTION_EXEMPT_EMAIL;
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) return false;
      throw error;
    }
  }

  const user = await ctx.db.prepare("SELECT email FROM users WHERE id = ?").bind(ctx.actorId).first();
  return user?.email?.toLowerCase() === SUBSCRIPTION_EXEMPT_EMAIL;
}

function pagination(params) {
  const raw = params.get("page") ?? "0";
  if (!/^(0|[1-9]\d{0,3})$/.test(raw)) throw new HttpError(400, "Sayfa geçersiz.");
  return Math.min(Number(raw), 1000);
}

async function ledgerTotal(db, start, end) {
  const result = await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_minor ELSE 0 END), 0) AS income,
    COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_minor ELSE 0 END), 0) AS expense,
    COUNT(*) AS entries
    FROM olvex_platform_ledger
    WHERE voided_at IS NULL AND occurred_on BETWEEN ? AND ?`).bind(start, end).first();
  return { ...result, net: result.income - result.expense };
}

async function overview(db, params) {
  const { start, end } = period(params);
  const [counts, finance, subscriptions, ai, latest] = await Promise.all([
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM businesses) AS businesses,
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(DISTINCT user_id) FROM user_sessions WHERE expires_at > ?) AS loggedInUsers,
      (SELECT COUNT(*) FROM olvex_pos_connections WHERE revoked_at IS NULL) AS registers`)
      .bind(new Date().toISOString()).first(),
    ledgerTotal(db, start, end),
    db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN environment = 'live' AND state = 'active' AND paid_until > ? THEN 1 ELSE 0 END) AS liveActive,
      SUM(CASE WHEN environment = 'sandbox' THEN 1 ELSE 0 END) AS sandbox
      FROM olvex_subscriptions`).bind(Date.now()).first(),
    db.prepare(`SELECT COUNT(*) AS requests, COUNT(DISTINCT business_id) AS businesses
      FROM olvex_ai_usage WHERE day = ?`).bind(today()).first(),
    db.prepare(`SELECT b.name, b.created_at,
      (SELECT COUNT(*) FROM business_members m WHERE m.business_id = b.id) AS members
      FROM businesses b ORDER BY b.created_at DESC, b.id DESC LIMIT 7`).all()
  ]);
  return { start, end, counts, finance, subscriptions, ai, latestBusinesses: latest.results };
}

async function businesses(db, params) {
  const page = pagination(params);
  const { results } = await db.prepare(`SELECT b.id, b.name, b.created_at,
    COALESCE((SELECT COUNT(*) FROM business_members m WHERE m.business_id = b.id), 0) AS members,
    COALESCE((SELECT COUNT(*) FROM olvex_pos_connections p WHERE p.business_id = b.id AND p.revoked_at IS NULL), 0) AS registers,
    u.full_name AS owner_name
    FROM businesses b LEFT JOIN users u ON u.id = b.created_by
    ORDER BY b.created_at DESC, b.id DESC LIMIT 51 OFFSET ?`).bind(page * 50).all();
  return { page, hasMore: results.length > 50, rows: results.slice(0, 50) };
}

async function users(db, params) {
  const page = pagination(params);
  const { results } = await db.prepare(`SELECT u.id, u.email, u.full_name, u.created_at,
    (SELECT COUNT(*) FROM business_members m WHERE m.user_id = u.id) AS memberships
    FROM users u ORDER BY u.created_at DESC, u.id DESC LIMIT 51 OFFSET ?`).bind(page * 50).all();
  return { page, hasMore: results.length > 50, rows: results.slice(0, 50) };
}

async function subscriptions(db, params) {
  const page = pagination(params);
  const { results } = await db.prepare(`SELECT s.id, b.name AS business, s.environment, s.plan, s.state, s.created_at, s.paid_until
    FROM olvex_subscriptions s JOIN businesses b ON b.id = s.business_id
    ORDER BY s.created_at DESC, s.id DESC LIMIT 51 OFFSET ?`).bind(page * 50).all();
  return { page, hasMore: results.length > 50, rows: results.slice(0, 50),
    note: "Abonelik durumu tahsil edilmiş gelir değildir. Gelir/gider defteri ayrı tutulur." };
}

async function ai(db, params) {
  const { start, end } = period(params);
  const [models, days] = await Promise.all([
    db.prepare(`SELECT model, COUNT(*) AS requests, COUNT(DISTINCT business_id) AS businesses,
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens,
      COALESCE(SUM(estimated_nano_usd), 0) AS estimatedNanoUsd,
      COUNT(estimated_nano_usd) AS estimatedCount
      FROM olvex_ai_usage WHERE day BETWEEN ? AND ?
      GROUP BY model ORDER BY requests DESC, model`).bind(start, end).all(),
    db.prepare(`SELECT day, COUNT(*) AS requests FROM olvex_ai_usage
      WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day ASC`).bind(start, end).all()
  ]);
  return { start, end, models: models.results, days: days.results };
}

async function finance(db, params) {
  const { start, end } = period(params);
  const page = pagination(params);
  const [totals, rows, days] = await Promise.all([
    ledgerTotal(db, start, end),
    db.prepare(`SELECT l.id, l.kind, l.category, l.description, l.amount_minor, l.occurred_on,
      l.created_at, l.voided_at, u.full_name AS entered_by
      FROM olvex_platform_ledger l JOIN users u ON u.id = l.created_by
      WHERE l.occurred_on BETWEEN ? AND ?
      ORDER BY l.occurred_on DESC, l.created_at DESC, l.id DESC LIMIT 81 OFFSET ?`)
      .bind(start, end, page * 80).all(),
    db.prepare(`SELECT occurred_on AS day,
      COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_minor ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_minor ELSE 0 END), 0) AS expense
      FROM olvex_platform_ledger WHERE voided_at IS NULL AND occurred_on BETWEEN ? AND ?
      GROUP BY occurred_on ORDER BY occurred_on`).bind(start, end).all()
  ]);
  return { start, end, totals, page, hasMore: rows.results.length > 80,
    rows: rows.results.slice(0, 80), days: days.results,
    note: "Yalnızca OLVEX yönetiminin bu deftere girdiği hareketler. Müşterilerin satışları ve iyzico durum kayıtları bu toplamlara dahil değildir." };
}

async function system(db) {
  const [migration, recent] = await Promise.all([
    db.prepare("SELECT id, name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 1").first(),
    db.prepare(`SELECT a.action, a.created_at, a.subject_id, u.full_name AS actor
      FROM olvex_admin_audit a JOIN users u ON u.id = a.actor_id
      ORDER BY a.created_at DESC, a.id DESC LIMIT 30`).all()
  ]);
  return { db: "connected", migration, recent: recent.results };
}

async function rightsRequests(db, params) {
  const page = pagination(params);
  const { results } = await db.prepare(`SELECT r.id, r.kind, r.created_at, r.processed_at, u.email
    FROM olvex_account_rights_requests r JOIN users u ON u.id = r.user_id
    ORDER BY r.processed_at IS NOT NULL, r.created_at DESC, r.id DESC LIMIT 51 OFFSET ?`).bind(page * 50).all();
  return { rows: results.slice(0, 50), page, hasMore: results.length > 50 };
}

export async function markRightsResponded(db, body, admin) {
  if (body.action !== "responded" || body.confirmed !== true) throw new HttpError(400, "Yanıtın iletildiğini doğrulayın.");
  const id = identifier(body.id, "Talep");
  const record = await db.prepare(`UPDATE olvex_account_rights_requests SET processed_at = CURRENT_TIMESTAMP, processed_by = ?
    WHERE id = ? AND processed_at IS NULL RETURNING id`).bind(admin.id, id).first();
  if (!record) throw new HttpError(409, "Bekleyen talep bulunamadı.");
  return { success: true };
}

export async function adminData(db, section, params, user) {
  if (section === "me") return { user: { name: user.full_name, email: user.email } };
  if (section === "overview") return overview(db, params);
  if (section === "businesses") return businesses(db, params);
  if (section === "users") return users(db, params);
  if (section === "subscriptions") return subscriptions(db, params);
  if (section === "ai") return ai(db, params);
  if (section === "finance") return finance(db, params);
  if (section === "rights") return rightsRequests(db, params);
  if (section === "system") return system(db);
  throw new HttpError(404, "Bölüm bulunamadı.");
}

export async function adminFinanceAction(db, body, user) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "İstek geçersiz.");
  const action = choice(body.action, ["create", "void"], "İşlem");
  if (action === "create") {
    const id = identifier(body.requestId, "İstek kimliği");
    const kind = choice(body.kind, ["income", "expense"], "Hareket türü");
    const category = text(body.category, "Kategori", { min: 0, max: 64 });
    const description = text(body.description, "Açıklama", { min: 2, max: 180 });
    const amount = integer(body.amountMinor, "Tutar (kuruş)", 1, 25_000_000_000_000);
    const occurredOn = date(body.occurredOn);
    try {
      await db.prepare(`INSERT INTO olvex_platform_ledger
        (id,kind,category,description,amount_minor,occurred_on,created_by)
        VALUES (?,?,?,?,?,?,?)`).bind(id, kind, category, description, amount, occurredOn, user.id).run();
    } catch (error) {
      if (!/UNIQUE constraint failed: olvex_platform_ledger.id/.test(String(error?.message))) throw error;
      const existing = await db.prepare(`SELECT kind,category,description,amount_minor,occurred_on,created_by,voided_at
        FROM olvex_platform_ledger WHERE id = ?`).bind(id).first();
      if (!existing || existing.voided_at || existing.created_by !== user.id ||
          existing.kind !== kind || existing.category !== category || existing.description !== description ||
          existing.amount_minor !== amount || existing.occurred_on !== occurredOn) {
        throw new HttpError(409, "İstek kimliği daha önce farklı bir işlemde kullanılmış.");
      }
    }
    return { success: true, id };
  }
  const id = identifier(body.id);
  const updated = await db.prepare(`UPDATE olvex_platform_ledger SET voided_at = CURRENT_TIMESTAMP, voided_by = ?
    WHERE id = ? AND voided_at IS NULL RETURNING id`).bind(user.id, id).first();
  if (updated?.id !== id) throw new HttpError(409, "Hareket zaten iptal edilmiş veya bulunamadı.");
  return { success: true, id };
}
