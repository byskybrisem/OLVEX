import assert from "node:assert/strict";
import test from "node:test";
import { publicInfo } from "../functions/_lib/public-info.js";
import { onRequestPost as register } from "../functions/api/auth/register.js";

const contact = { OLVEX_OPERATOR_NAME: "Örnek işletme", OLVEX_SERVICE_ADDRESS: "Yerel test adresi",
  OLVEX_CONTACT_EMAIL: "destek@example.test" };
const url = "https://olvex.com.tr/api/auth/register";
const info = (env, target = url) => publicInfo(env, new Request(target));

test("kayıt yalnızca doğru ortam, yayın anahtarı ve yayımlanabilir iletişim bilgileriyle açılır", () => {
  const preview = { OLVEX_SIGNUPS: "preview", OLVEX_ENVIRONMENT: "preview" };
  for (const host of ["olvex.com.tr", "www.olvex.com.tr", "olvex.pages.dev", "main.olvex.pages.dev"]) {
    assert.equal(info(preview, "https://" + host).registrationOpen, false);
  }
  assert.equal(info(preview, "https://test.olvex.pages.dev").registrationOpen, true);
  assert.equal(info({ OLVEX_SIGNUPS: "preview" }, "http://localhost:8080").registrationOpen, true);
  assert.equal(info({ OLVEX_SIGNUPS: "preview" }, "https://test.olvex.pages.dev").registrationOpen, false);
  assert.equal(info(contact).registrationOpen, false);
  assert.equal(info({ OLVEX_SIGNUPS: "open", ...contact }).registrationOpen, true);
  for (const field of Object.keys(contact)) {
    assert.equal(info({ ...contact, [field]: "", OLVEX_SIGNUPS: "open" }).registrationOpen, false);
  }
});

test("kapalı kayıt isteği veritabanına yazmadan reddedilir", async () => {
  const request = new Request(url, { method: "POST", headers: { Origin: new URL(url).origin } });
  const result = await register({ request, env: { DB: {}, ...contact, OLVEX_SIGNUPS: "closed" } });
  assert.equal(result.status, 403);
});

test("e-posta kurtarma durumu güvenli bağlantı yapılandırmasıyla tutarlıdır", () => {
  const mail = { RESEND_API_KEY: "local-test", OLVEX_FROM_EMAIL: "account@example.test" };
  assert.equal(info({}).passwordResetEnabled, false);
  assert.equal(info(mail).passwordResetEnabled, true);
  assert.equal(info({ ...mail, OLVEX_PUBLIC_ORIGIN: "http://example.test" }).passwordResetEnabled, false);
});
