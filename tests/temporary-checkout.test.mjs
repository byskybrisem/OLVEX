import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequestGet } from "../functions/api/qa/one-time-checkout.js";
import { randomToken } from "../functions/_lib/session.js";

const origin = "https://olvex.com.tr";
const adminId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const cookie = "olvex_session=" + randomToken();

const dbFor = id => ({
  prepare() {
    return {
      bind() { return { async first() { return id ? { id, email: "test@example.test" } : null; } }; }
    };
  }
});

async function invoke(id, configured = adminId, signedIn = true) {
  return onRequestGet({
    env: { DB: dbFor(id), OLVEX_SUPER_ADMIN_USER_ID: configured },
    request: new Request(origin + "/api/qa/one-time-checkout", {
      headers: signedIn ? { Cookie: cookie } : {}
    })
  });
}

test("geçici canlı ödeme yönlendirmesine sadece yönetici oturumu erişebilir", async () => {
  const guest = await invoke(adminId, adminId, false);
  assert.equal(guest.status, 401);
  assert.equal(guest.headers.get("Location"), null);

  const absentAdminConfig = await invoke(adminId, undefined);
  assert.equal(absentAdminConfig.status, 404);
  assert.equal(absentAdminConfig.headers.get("Location"), null);

  const stranger = await invoke(otherId);
  assert.equal(stranger.status, 404);
  assert.equal(stranger.headers.get("Location"), null);

  const admin = await invoke(adminId);
  assert.equal(admin.status, 302);
  const target = new URL(admin.headers.get("Location"));
  assert.equal(target.origin, "https://buy.polar.sh");
  assert.match(target.pathname, /^\/polar_cl_/);
  assert.equal(admin.headers.get("Cache-Control"), "no-store");
});

test("30 TL test CTA yalnızca özel bağlantıyla görünür, normal fiyat ve abonelik korunur", async () => {
  const page = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../assets/landing.js", import.meta.url), "utf8");
  const testPage = await readFile(new URL("../odeme-testi.html", import.meta.url), "utf8");
  assert.match(page, /id="private-payment-test" hidden/);
  assert.match(js, /get\("odeme_testi"\) === "30"/);
  assert.match(page, /id="monthly-price">999 TL/);
  assert.match(page, /id="pricing-cta"/);
  assert.match(testPage, /30 TL/);
  assert.match(testPage, /Tek seferlik|tek seferlik/);
  assert.match(testPage, /href="\/api\/qa\/one-time-checkout"/);
});
