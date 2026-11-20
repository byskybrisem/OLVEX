import { accountLinkMessage, sendAccountMail } from "./account-mail.js";
import { HttpError } from "./http.js";
import { recoveryOrigin } from "./recovery.js";
import { randomToken, sha256, TOKEN_PATTERN } from "./session.js";
import { newPassword, passwordHash } from "./password.js";
import { text } from "./validate.js";
import { TERMS_VERSION } from "./public-info.js";

export async function sendSignupLink(env, address, joining) {
  const token = randomToken();
  const key = await sha256(token);
  const now = Date.now();
  const link = new URL("/register.html", recoveryOrigin(env));
  if (joining) link.searchParams.set("next", "join");
  link.hash = token;
  const [, issued] = await env.DB.batch([
    env.DB.prepare("DELETE FROM olvex_signup_links WHERE expires_at <= ?").bind(new Date(now).toISOString()),
    env.DB.prepare(`INSERT INTO olvex_signup_links(token_hash,email,expires_at)
      SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ? COLLATE NOCASE)`)
      .bind(key, address, new Date(now + 30 * 60 * 1000).toISOString(), address)
  ]);
  if (!issued.meta.changes) return;
  const mail = accountLinkMessage({
    heading: "OLVEX hesap kaydını doğrulayın",
    instructions: "Kaydı tamamlamak için bağlantıyı açın ve hesabınızın şifresini belirleyin.",
    label: "Hesabı doğrula",
    url: link.href
  });
  try {
    await sendAccountMail(env, address, mail.subject, mail.text, "signup", mail.html);
  } catch {
    await env.DB.prepare("DELETE FROM olvex_signup_links WHERE token_hash = ?").bind(key).run();
  }
}

export function signupDetails(data) {
  if (data.termsVersion !== TERMS_VERSION || data.acceptedTerms !== true) {
    throw new HttpError(400, "Güncel kullanım şartlarını okuyup kabul edin.");
  }
  const name = text(data.fullName, "Ad soyad", { min: 2, max: 100 });
  const password = newPassword(data.password);
  return { name, password };
}

export async function createSignup(db, { name, password }, address, token) {
  const id = crypto.randomUUID();
  const consent = db.prepare(`INSERT INTO olvex_terms_acceptances(user_id, version)
    SELECT id, ? FROM users WHERE id = ?`).bind(TERMS_VERSION, id);
  if (token === undefined) {
    await db.batch([
      db.prepare(`INSERT INTO users(id,email,full_name,password_hash) VALUES (?,?,?,?)
        ON CONFLICT(email COLLATE NOCASE) DO NOTHING`).bind(id, address, name, await passwordHash(password)),
      consent
    ]);
    return;
  }
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw new HttpError(400, "Doğrulama bağlantısı geçersiz.");
  const key = await sha256(token);
  const expiresError = "Doğrulama bağlantısı kullanılmış veya süresi dolmuş. Yeni bağlantı isteyin.";
  if (!await db.prepare("SELECT 1 FROM olvex_signup_links WHERE token_hash = ? AND expires_at > ?")
    .bind(key, new Date().toISOString()).first()) throw new HttpError(400, expiresError);
  const hash = await passwordHash(password);
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`INSERT INTO users(id,email,full_name,password_hash)
      SELECT ?, email, ?, ? FROM olvex_signup_links WHERE token_hash = ? AND expires_at > ?
      ON CONFLICT(email COLLATE NOCASE) DO NOTHING`).bind(id, name, hash, key, now),
    consent,
    db.prepare("DELETE FROM olvex_signup_links WHERE token_hash = ? AND expires_at > ?").bind(key, now)
  ]);
  if (results[2].meta.changes !== 1) throw new HttpError(400, expiresError);
}
