import { clientIp, handle, HttpError, json, readJson, sameOrigin } from "../../_lib/http.js";
import { publicInfo } from "../../_lib/public-info.js";
import { createSignup, sendSignupLink, signupDetails } from "../../_lib/signup.js";
import { email } from "../../_lib/validate.js";
import { isRateLimited } from "./rate-limit.js";

export const onRequestPost = handle(async ({ request, env }) => {
  sameOrigin(request);
  const info = publicInfo(env, request);
  if (!info.registrationOpen) throw new HttpError(403, "Yeni hesap kaydı şu anda kapalı.");
  const data = await readJson(request, 4096);
  if (data.action !== undefined && data.action !== "confirm") throw new HttpError(400, "Kayıt işlemi geçersiz.");
  const confirm = data.action === "confirm";
  const details = confirm || !info.emailVerificationRequired ? signupDetails(data) : null;
  const address = confirm ? null : email(data.email);
  const counter = confirm ? "signup-confirm" : "register";
  if (await isRateLimited(env.DB, `${counter}:${clientIp(request)}`, confirm ? 15 : 5, 3600)) {
    if (!confirm && info.emailVerificationRequired) console.info("OLVEX_ACCOUNT_MAIL", { flow: "signup", outcome: "ip_rate_limit" });
    throw new HttpError(429, "Çok fazla kayıt denemesi. Biraz sonra tekrar deneyin.", { "Retry-After": "3600" });
  }
  if (confirm) {
    if (!info.emailVerificationRequired || !data.token) throw new HttpError(400, "Doğrulama bağlantısı geçersiz.");
    await createSignup(env.DB, details, null, data.token);
  } else {
    if (info.emailVerificationRequired) {
      if (await isRateLimited(env.DB, `signup-mail:${address}`, 3, 1800)) {
        console.info("OLVEX_ACCOUNT_MAIL", { flow: "signup", outcome: "address_rate_limit" });
        throw new HttpError(429, "Doğrulama bağlantısı istemek için lütfen daha sonra tekrar deneyin.", { "Retry-After": "1800" });
      }
      await sendSignupLink(env, address, data.joining === true);
      return json({ verificationRequested: true }, 202);
    }
    await createSignup(env.DB, details, address);
  }
  return json({ success: true }, 202);
});
