
const COOKIE_NAME = "olvex_session";

async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getSession(request, env) {
  const cookieHeader = request.headers.get("Cookie") || "";

  const cookie = cookieHeader
    .split(";")
    .map(item => item.trim())
    .find(item => item.startsWith(COOKIE_NAME + "="));

  if (!cookie) return null;

  const token = cookie.slice(COOKIE_NAME.length + 1);

  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

  const tokenHash = await hashToken(token);

  return await env.DB.prepare(
    `SELECT users.id, users.email, users.full_name
     FROM user_sessions
     JOIN users ON users.id = user_sessions.user_id
     WHERE user_sessions.token_hash = ?
     AND user_sessions.expires_at > ?
     LIMIT 1`
  )
    .bind(tokenHash, new Date().toISOString())
    .first();
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) {
      return Response.json(
        { error: "Veritabanı bağlantısı bulunamadı." },
        { status: 500 }
      );
    }

    const user = await getSession(request, env);

    if (!user) {
      return Response.json(
        { error: "Oturum bulunamadı. Tekrar giriş yap." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const result = await env.DB.prepare(
      `SELECT
         businesses.id,
         businesses.name,
         businesses.created_at,
         business_members.role
       FROM business_members
       JOIN businesses
         ON businesses.id = business_members.business_id
       WHERE business_members.user_id = ?
       ORDER BY businesses.created_at ASC`
    )
      .bind(user.id)
      .all();

    return Response.json(
      {
        success: true,
        businesses: result.results || []
      },
      { headers: { "Cache-Control": "no-store" } }
    );

  } catch (error) {
    return Response.json(
      { error: "İşletmeler yüklenirken sunucu hatası oluştu." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return Response.json(
        { error: "Veritabanı bağlantısı bulunamadı." },
        { status: 500 }
      );
    }

    const user = await getSession(request, env);

    if (!user) {
      return Response.json(
        { error: "Oturum bulunamadı. Tekrar giriş yap." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    let data;

    try {
      data = await request.json();
    } catch {
      return Response.json(
        { error: "Geçersiz istek." },
        { status: 400 }
      );
    }

    const name = typeof data.name === "string"
      ? data.name.trim()
      : "";

    if (name.length < 2 || name.length > 100) {
      return Response.json(
        { error: "İşletme adı 2 ile 100 karakter arasında olmalıdır." },
        { status: 400 }
      );
    }

    const businessId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO businesses (id, name, created_by)
         VALUES (?, ?, ?)`
      ).bind(businessId, name, user.id),

      env.DB.prepare(
        `INSERT INTO business_members
         (id, business_id, user_id, role)
         VALUES (?, ?, ?, 'owner')`
      ).bind(membershipId, businessId, user.id)
    ]);

    return Response.json(
      {
        success: true,
        business: {
          id: businessId,
          name,
          role: "owner"
        }
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch (error) {
    return Response.json(
      { error: "İşletme oluşturulamadı. Lütfen tekrar dene." },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}

