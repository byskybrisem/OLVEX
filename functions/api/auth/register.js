import { clientIp, handle, HttpError, json, readJson, sameOrigin } from "../../_lib/http.js";
import { newPassword, passwordHash } from "../../_lib/password.js";
import { publicInfo, TERMS_VERSION } from "../../_lib/public-info.js";
import { email, text } from "../../_lib/validate.js";
import { isRateLimited } from "./rate-limit.js";

export const onRequestPost = handle(async ({ request, env }) => {
  sameOrigin(request);
  if (!publicInfo(env, request).registrationOpen) throw new HttpError(403, "Yeni hesap kaydı şu anda kapalı.");
  const data = await readJson(request, 4096);
  if (data.termsVersion !== TERMS_VERSION || data.acceptedTerms !== true) {
    throw new HttpError(400, "Güncel kullanım şartlarını okuyup kabul edin.");
  }
  const name = text(data.fullName, "Ad soyad", { min: 2, max: 100 });
  const address = email(data.email);
  const password = newPassword(data.password);
  if (await isRateLimited(env.DB, `register:${clientIp(request)}`, 5, 3600)) {
    throw new HttpError(429, "Çok fazla kayıt denemesi. Biraz sonra tekrar deneyin.", { "Retry-After": "3600" });
  }
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users (id, email, full_name, password_hash) VALUES (?, ?, ?, ?)
      ON CONFLICT(email COLLATE NOCASE) DO NOTHING`)
      .bind(id, address, name, await passwordHash(password)),
    env.DB.prepare(`INSERT INTO olvex_terms_acceptances (user_id, version)
      SELECT id, ? FROM users WHERE id = ?`).bind(TERMS_VERSION, id)
  ]);
  return json({ success: true }, 202);
});
