
const ITERATIONS = 100000;
const COOKIE_NAME = "olvex_session";

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyPassword(password, storedHash) {
  try {
    const parts = storedHash.split("$");

    if (
      parts.length !== 4 ||
      parts[0] !== "pbkdf2_sha256" ||
      Number(parts[1]) !== ITERATIONS
    ) {
      return false;
    }

    const salt = fromBase64(parts[2]);
    const expectedHash = fromBase64(parts[3]);

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations: ITERATIONS,
        hash: "SHA-256"
      },
      key,
      256
    );

    const actualHash = new Uint8Array(bits);

    if (actualHash.length !== expectedHash.length) {
      return false;
    }

    let difference = 0;

    for (let i = 0; i < actualHash.length; i++) {
      difference |= actualHash[i] ^ expectedHash[i];
    }

    return difference === 0;
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return Response.json(
        { error: "Sunucu yapılandırma hatası." },
        { status: 500 }
      );
    }

    const data = await request.json();

    const email = String(data.email || "").trim().toLowerCase();
    const password = String(data.password || "");
    const remember = data.remember === true;

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 1 ||
      password.length > 128
    ) {
      return Response.json(
        { error: "E-posta veya şifre hatalı." },
        { status: 401 }
      );
    }

    const user = await env.DB.prepare(
      `SELECT id, email, full_name, password_hash
       FROM users
       WHERE email = ? COLLATE NOCASE
       LIMIT 1`
    )
      .bind(email)
      .first();

    if (!user || !user.password_hash) {
      return Response.json(
        { error: "E-posta veya şifre hatalı." },
        { status: 401 }
      );
    }

    const validPassword = await verifyPassword(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return Response.json(
        { error: "E-posta veya şifre hatalı." },
        { status: 401 }
      );
    }

    const tokenBytes = crypto.getRandomValues(
      new Uint8Array(32)
    );

    const token = toBase64Url(tokenBytes);
    const tokenHash = await hashToken(token);

    const sessionId = crypto.randomUUID();

    const duration = remember
      ? 30 * 24 * 60 * 60
      : 24 * 60 * 60;

    const expiresAt = new Date(
      Date.now() + duration * 1000
    ).toISOString();

    await env.DB.prepare(
      `INSERT INTO user_sessions
       (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`
    )
      .bind(sessionId, user.id, tokenHash, expiresAt)
      .run();

    await env.DB.prepare(
      `DELETE FROM user_sessions
       WHERE expires_at <= ?`
    )
      .bind(new Date().toISOString())
      .run();

    const cookieParts = [
      `${COOKIE_NAME}=${token}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax"
    ];

    if (remember) {
      cookieParts.push(`Max-Age=${duration}`);
    }

    return Response.json(
      {
        success: true,
        message: "Giriş başarılı."
      },
      {
        status: 200,
        headers: {
          "Set-Cookie": cookieParts.join("; "),
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    return Response.json(
      {
        error: "Sunucu hatası. Lütfen daha sonra tekrar deneyin."
      },
      { status: 500 }
    );
  }
}
