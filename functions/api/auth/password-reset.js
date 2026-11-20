import { clientIp, handle, HttpError, json, readJson, sameOrigin } from "../../_lib/http.js";
import { newPassword, passwordHash } from "../../_lib/password.js";
import { randomToken, sha256, TOKEN_PATTERN } from "../../_lib/session.js";
import { email, choice } from "../../_lib/validate.js";
import { isRateLimited } from "./rate-limit.js";
import { accountLinkMessage, accountMailReady, sendAccountMail } from "../../_lib/account-mail.js";
import { recoveryOrigin } from "../../_lib/recovery.js";

async function sendReset(env, user, origin) {
  const token = randomToken();
  const hash = await sha256(token);
  const now = new Date();
  const [, issued] = await env.DB.batch([
    env.DB.prepare("DELETE FROM olvex_password_resets WHERE expires_at <= ?").bind(now.toISOString()),
    env.DB.prepare(`INSERT INTO olvex_password_resets (token_hash, user_id, expires_at)
      SELECT ?, id, ? FROM users WHERE id = ? AND password_hash IS ?`)
      .bind(hash, new Date(+now + 30 * 60 * 1000).toISOString(), user.id, user.password_hash)
  ]);

  if (!issued.meta.changes) return;
  const url = new URL("/forgot-password.html", origin);
  url.hash = token;
  const mail = accountLinkMessage({
    heading: "OLVEX şifre sıfırlama",
    instructions: "Bağlantıyı açarak hesabınız için yeni bir şifre belirleyin.",
    label: "Yeni şifre belirle",
    url: url.href
  });
  try {
    await sendAccountMail(env, user.email, mail.subject, mail.text, "password_reset", mail.html);
  } catch {
    await env.DB.prepare("DELETE FROM olvex_password_resets WHERE token_hash = ?").bind(hash).run();
  }
}

export const onRequestPost = handle(async (context) => {
  const { request, env } = context;
  sameOrigin(request);
  const db = env.DB;
  const data = await readJson(request, 4096);
  const action = choice(data.action, ["request", "reset"], "İşlem");
  if (await isRateLimited(db, `password-${action}:${clientIp(request)}`, 10, 1800)) {
    if (action === "request") console.info("OLVEX_ACCOUNT_MAIL", { flow: "password_reset", outcome: "ip_rate_limit" });
    throw new HttpError(429, "Biraz sonra tekrar deneyin.", { "Retry-After": "1800" });
  }

  if (action === "request") {
    const origin = recoveryOrigin(env);
    if (!accountMailReady(env) || !origin) {
      console.error("OLVEX_ACCOUNT_MAIL", { flow: "password_reset", outcome: "configuration_unavailable" });
      throw new HttpError(503, "Şifre sıfırlama e-postası şu anda kullanılamıyor.");
    }
    const address = email(data.email);
    if (await isRateLimited(db, `password-address:${address}`, 3, 1800)) {
      console.info("OLVEX_ACCOUNT_MAIL", { flow: "password_reset", outcome: "address_rate_limit" });
    } else {
      context.waitUntil((async () => {
        const user = await db.prepare("SELECT id, email, password_hash FROM users WHERE email = ? COLLATE NOCASE").bind(address).first();
        if (user) await sendReset(env, user, origin);
        else console.info("OLVEX_ACCOUNT_MAIL", { flow: "password_reset", outcome: "no_matching_account" });
      })().catch(() => console.error("OLVEX_ACCOUNT_MAIL", { flow: "password_reset", outcome: "storage_error" })));
    }
    return json({ success: true });
  }

  if (typeof data.token !== "string" || !TOKEN_PATTERN.test(data.token)) {
    throw new HttpError(400, "Bağlantı geçersiz veya süresi dolmuş.");
  }
  const password = newPassword(data.password);
  const hash = await sha256(data.token);
  const now = new Date().toISOString();
  const target = "SELECT user_id FROM olvex_password_resets WHERE token_hash = ? AND expires_at > ?";
  if (!await db.prepare(target).bind(hash, now).first()) {
    throw new HttpError(400, "Bağlantı geçersiz veya süresi dolmuş.");
  }
  const nextHash = await passwordHash(password);
  const currentTime = new Date().toISOString();
  const [result] = await db.batch([
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = (${target})`).bind(nextHash, hash, currentTime),
    db.prepare(`DELETE FROM user_sessions WHERE user_id = (${target})`).bind(hash, currentTime),
    db.prepare(`DELETE FROM olvex_password_resets WHERE user_id = (${target})`).bind(hash, currentTime)
  ]);
  if (result.meta.changes !== 1) throw new HttpError(400, "Bağlantı geçersiz veya süresi dolmuş.");
  return json({ success: true });
});
