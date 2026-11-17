
const COOKIE_NAME = "olvex_session";

async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) {
      return Response.json(
        { error: "Sunucu şu anda kullanılamıyor." },
        {
          status: 503,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const cookieHeader = request.headers.get("Cookie") || "";

    const cookie = cookieHeader
      .split(";")
      .map(item => item.trim())
      .find(item => item.startsWith(COOKIE_NAME + "="));

    if (!cookie) {
      return Response.json(
        { authenticated: false },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const token = cookie.slice(COOKIE_NAME.length + 1);

    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return Response.json(
        { authenticated: false },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const tokenHash = await hashToken(token);

    const session = await env.DB.prepare(
      `SELECT users.id, users.email, users.full_name
       FROM user_sessions
       JOIN users ON users.id = user_sessions.user_id
       WHERE user_sessions.token_hash = ?
       AND user_sessions.expires_at > ?
       LIMIT 1`
    )
      .bind(tokenHash, new Date().toISOString())
      .first();

    if (!session) {
      return Response.json(
        { authenticated: false },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    return Response.json(
      {
        authenticated: true,
        user: {
          id: session.id,
          email: session.email,
          fullName: session.full_name
        }
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );

  } catch {
    return Response.json(
      { error: "Sunucu hatası." },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
