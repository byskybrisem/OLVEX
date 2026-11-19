import { clientIp, handle, HttpError, json, readJson, sameOrigin } from "../../_lib/http.js";
import { randomToken, sessionCookie, sha256 } from "../../_lib/session.js";
import { verifyPassword } from "../../_lib/password.js";
import { clearRateLimit, isRateLimited } from "./rate-limit.js";

export const onRequestPost = handle(async ({ request, env, waitUntil }) => {
  sameOrigin(request);
  const data = await readJson(request, 4096);
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const password = data.password;
  const rejected = "E-posta veya şifre hatalı.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      typeof password !== "string" || !password.length || password.length > 128) {
    throw new HttpError(401, rejected);
  }

  const key = `login:${clientIp(request)}:${email}`;
  if (await isRateLimited(env.DB, `login-ip:${clientIp(request)}`, 50, 900) ||
      await isRateLimited(env.DB, key, 5, 900)) {
    throw new HttpError(429, "Çok fazla giriş denemesi. Biraz sonra tekrar deneyin.", { "Retry-After": "900" });
  }

  const user = await env.DB.prepare("SELECT id, password_hash FROM users WHERE email = ? COLLATE NOCASE")
    .bind(email).first();
  if (!await verifyPassword(password, user?.password_hash)) throw new HttpError(401, rejected);

  const remember = data.remember === true;
  const duration = (remember ? 30 : 1) * 86400;
  const token = randomToken();
  const now = new Date();
  const expires = new Date(+now + duration * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
    SELECT ?, id, ?, ? FROM users WHERE id = ? AND password_hash = ?`)
    .bind(crypto.randomUUID(), await sha256(token), expires, user.id, user.password_hash)
    .run().then((result) => {
      if (result.meta.changes !== 1) throw new HttpError(401, rejected);
    });

  waitUntil(Promise.all([
    clearRateLimit(env.DB, key),
    env.DB.prepare(`DELETE FROM user_sessions WHERE id IN (
      SELECT id FROM user_sessions WHERE expires_at <= ? LIMIT 250
    )`).bind(now.toISOString()).run(),
    env.DB.prepare(`DELETE FROM auth_rate_limits WHERE key_hash IN (
      SELECT key_hash FROM auth_rate_limits WHERE updated_at < ? LIMIT 250
    )`).bind(Math.floor(+now / 1000) - 7 * 86400).run()
  ]).catch(() => console.warn("OLVEX oturum temizliği ertelendi.")));

  // Return only a boolean about the authenticated user; never expose the
  // configured administrator ID or trust roles supplied by the browser.
  const adminId = env.OLVEX_SUPER_ADMIN_USER_ID?.trim().toLowerCase();
  const isPlatformAdmin = Boolean(adminId && user.id.toLowerCase() === adminId);
  return json({ success: true, isPlatformAdmin }, 200, { "Set-Cookie": sessionCookie(token, remember ? duration : undefined) });
});
