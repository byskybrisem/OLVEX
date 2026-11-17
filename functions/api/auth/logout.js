
const COOKIE_NAME = "olvex_session";
const ALLOWED_ORIGINS = new Set([
  "https://olvex.com.tr",
  "https://www.olvex.com.tr"
]);

async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequestPost({ request, env }) {
  try {
    const origin = request.headers.get("Origin");

    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      return Response.json(
        { error: "İstek reddedildi." },
        {
          status: 403,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

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

    if (cookie) {
      const token = cookie.slice(COOKIE_NAME.length + 1);

      if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
        const tokenHash = await hashToken(token);

        await env.DB.prepare(
          "DELETE FROM user_sessions WHERE token_hash = ?"
        )
          .bind(tokenHash)
          .run();
      }
    }

    return Response.json(
      { success: true },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie":
            `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
        }
      }
    );

  } catch {
    return Response.json(
      { error: "Çıkış işlemi tamamlanamadı." },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
