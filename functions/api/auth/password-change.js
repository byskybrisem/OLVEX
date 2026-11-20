import { clientIp, handle, HttpError, json, readJson, sameOrigin } from "../../_lib/http.js";
import { newPassword, passwordHash, verifyPassword } from "../../_lib/password.js";
import { requireUser, sessionCookie, sessionHash } from "../../_lib/session.js";
import { isRateLimited } from "./rate-limit.js";

// Password changes require the user's existing password, not just an active session.
export const onRequestPost = handle(async ({ request, env }) => {
  sameOrigin(request);
  const user = await requireUser(request, env.DB);
  const data = await readJson(request, 4096);

  const currentPassword = data.currentPassword;
  if (typeof currentPassword !== "string" || currentPassword.length === 0 || currentPassword.length > 128) {
    throw new HttpError(400, "Mevcut şifrenizi girin.");
  }
  const nextPassword = newPassword(data.newPassword);
  if (await isRateLimited(env.DB, "password-change:" + user.id + ":" + clientIp(request), 6, 1800) ||
      await isRateLimited(env.DB, "password-change-account:" + user.id, 12, 1800)) {
    throw new HttpError(429, "Çok fazla şifre değiştirme denemesi. Biraz sonra tekrar deneyin.",
      { "Retry-After": "1800" });
  }

  const record = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first();
  if (!await verifyPassword(currentPassword, record?.password_hash)) {
    throw new HttpError(400, "Mevcut şifre hatalı.");
  }
  if (await verifyPassword(nextPassword, record.password_hash)) {
    throw new HttpError(400, "Yeni şifreniz mevcut şifrenizden farklı olmalı.");
  }

  const tokenHash = await sessionHash(request);
  if (!tokenHash) throw new HttpError(401, "Oturumunuz sona erdi. Tekrar giriş yapın.");

  const newHash = await passwordHash(nextPassword);
  const now = new Date().toISOString();
  const [changed] = await env.DB.batch([
    env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?
      AND EXISTS (SELECT 1 FROM user_sessions
        WHERE user_id = ? AND token_hash = ? AND expires_at > ?)`)
      .bind(newHash, user.id, record.password_hash, user.id, tokenHash, now),
    env.DB.prepare(`DELETE FROM user_sessions WHERE user_id = ?
      AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)`)
      .bind(user.id, user.id, newHash),
    env.DB.prepare(`DELETE FROM olvex_password_resets WHERE user_id = ?
      AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)`)
      .bind(user.id, user.id, newHash)
  ]);
  if (changed.meta.changes !== 1) {
    throw new HttpError(409, "Hesap durumu değişti. Tekrar giriş yapıp deneyin.");
  }
  return json({ success: true, reloginRequired: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
});
