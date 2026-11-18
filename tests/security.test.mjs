import assert from "node:assert/strict";
import { test } from "node:test";
import { recoveryOrigin } from "../functions/_lib/recovery.js";
import { onRequestPost as requestReset } from "../functions/api/auth/password-reset.js";
import { onRequest as health } from "../functions/api/health.js";

test("kurtarma bağlantısı için yapılandırılmış HTTPS kökeni gerekir", async () => {
  assert.equal(recoveryOrigin({}), "https://olvex.com.tr");
  assert.equal(recoveryOrigin({ OLVEX_PUBLIC_ORIGIN: "https://panel.example.test/" }), "https://panel.example.test");
  for (const value of ["", "panel.example.test", "http://panel.example.test", "https://user@panel.example.test",
    "https://panel.example.test/demo", "https://panel.example.test/?q=1", "https://panel.example.test/#start"]) {
    assert.equal(recoveryOrigin({ OLVEX_PUBLIC_ORIGIN: value }), null);
  }
  // Only the normal request rate counter may be consulted in this configuration.
  const counter = { bind() { return this; }, async first() { return { attempts: 1 }; } };
  const db = { prepare(sql) { assert.match(sql, /INSERT INTO auth_rate_limits/); return counter; } };
  const origin = "https://panel.example.test";
  const response = await requestReset({
    request: new Request(origin + "/api/auth/password-reset", {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "request", email: "sample@example.test" })
    }),
    env: { DB: db, OLVEX_PUBLIC_ORIGIN: "http://panel.example.test", OLVEX_FROM_EMAIL: "notice@example.test", RESEND_API_KEY: "fixture" },
    waitUntil() { assert.fail("Mail should stay disabled"); }
  });
  assert.equal(response.status, 503);
});

test("sağlık denetimi erişilebilirlik durumunu önbelleksiz ve güvenli JSON olarak döndürür", async () => {
  const ready = { prepare() { return { async first() { return { ok: 1 }; } }; } };
  for (const [env, status] of [[{ DB: ready }, 200], [{}, 503]]) {
    const response = await health({ env });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(response.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  }
});
