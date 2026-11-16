
const ITERATIONS = 600000;

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function hashPassword(password, salt) {
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

  return new Uint8Array(bits);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return Response.json(
        { error: "Veritabanı bağlantısı bulunamadı." },
        { status: 500 }
      );
    }

    const data = await request.json();

    const fullName = String(data.fullName || "").trim();
    const email = String(data.email || "").trim().toLowerCase();
    const password = String(data.password || "");

    if (fullName.length < 2 || fullName.length > 100) {
      return Response.json(
        { error: "Ad soyad 2-100 karakter arasında olmalı." },
        { status: 400 }
      );
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return Response.json(
        { error: "Geçerli bir e-posta adresi gir." },
        { status: 400 }
      );
    }

    if (password.length < 8 || password.length > 128) {
      return Response.json(
        { error: "Şifre 8-128 karakter arasında olmalı." },
        { status: 400 }
      );
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashPassword(password, salt);

    const passwordHash = [
      "pbkdf2_sha256",
      ITERATIONS,
      toBase64(salt),
      toBase64(hash)
    ].join("$");

    const userId = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO users (id, email, full_name, password_hash)
       VALUES (?, ?, ?, ?)`
    )
      .bind(userId, email, fullName, passwordHash)
      .run();

    return Response.json(
      {
        success: true,
        message: "Hesabın başarıyla oluşturuldu."
      },
      { status: 201 }
    );

  } catch (error) {
    if (
      error.message?.includes("UNIQUE constraint failed")
    ) {
      return Response.json(
        { error: "Bu e-posta adresi zaten kayıtlı." },
        { status: 409 }
      );
    }

    return Response.json(
  {
    error: "Sunucu hatası",
    detail: String(error?.message || error)
  },
  { status: 500 }
);
  }
}
