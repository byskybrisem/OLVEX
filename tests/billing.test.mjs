import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { onRequestPost as callback } from "../functions/api/billing/callback.js";
import { onRequestPost as webhook } from "../functions/api/billing/webhook.js";
import { onRequestGet, onRequestPost } from "../functions/api/workspace/[businessId]/[section].js";
import { randomToken, sha256 } from "../functions/_lib/session.js";

test("iyzico checkout, yenileme, iptal ve işletme sınırı yerel D1 üzerinde", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "olvex-billing-"));
  const configPath = join(dir, "wrangler.json");
  await writeFile(configPath, JSON.stringify({ name: "olvex-billing-test", compatibility_date: "2025-10-01",
    d1_databases: [{ binding: "DB", database_name: "billing-test", database_id: crypto.randomUUID() }] }));
  const runtime = await getPlatformProxy({ configPath, persist: false, remoteBindings: false });
  t.after(async () => {
    await runtime.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const { DB } = runtime.env;
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort()) {
    await DB.batch(unstable_splitSqlQuery(await readFile(new URL(name, migrations), "utf8")).map(sql => DB.prepare(sql)));
  }
  const sessions = { owner: randomToken(), admin: randomToken(), outsider: randomToken() };
  await DB.batch([
    DB.prepare("INSERT INTO users(id,email) VALUES ('owner','owner@example.test'),('admin','admin@example.test'),('outsider','outsider@example.test')"),
    DB.prepare("INSERT INTO businesses(id,name,created_by) VALUES ('biz','Örnek','owner'),('other','Ayrı','outsider')"),
    DB.prepare(`INSERT INTO business_members(id,business_id,user_id,role)
      VALUES ('m1','biz','owner','owner'),('m2','biz','admin','admin'),('m3','other','outsider','owner')`),
    ...await Promise.all(Object.entries(sessions).map(async ([user, token]) =>
      DB.prepare("INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES (?,?,?,'2099-01-01T00:00:00Z')")
        .bind(user, user, await sha256(token))))
  ]);

  const origin = "https://billing.example.test";
  const env = { DB, OLVEX_BILLING_ORIGIN: origin, IYZICO_API_KEY: "fixture-key", IYZICO_SECRET_KEY: "fixture-secret",
    IYZICO_MERCHANT_ID: "123", IYZICO_ESNAF_MONTHLY: "plan-em", IYZICO_ESNAF_YEARLY: "plan-ey",
    IYZICO_PROFESYONEL_MONTHLY: "plan-pm", IYZICO_PROFESYONEL_YEARLY: "plan-py" };
  const call = async (body, status, { user = "owner", businessId = "biz" } = {}) => {
    const request = new Request(`${origin}/api/workspace/${businessId}/billing`, {
      method: body ? "POST" : "GET",
      headers: { Origin: origin, "Content-Type": "application/json", Cookie: `olvex_session=${sessions[user]}` },
      body: body ? JSON.stringify(body) : undefined
    });
    const response = await (body ? onRequestPost : onRequestGet)({ env, request, params: { businessId, section: "billing" } });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  const checkout = { action: "checkout", plan: "esnaf-yearly", requestId: crypto.randomUUID(), price: 1,
    name: "Örnek", surname: "Üye", identityNumber: "00000000000", gsmNumber: "+905000000000",
    address: "Yalıtılmış test", city: "Denizli" };

  const sign = message => createHmac("sha256", env.IYZICO_SECRET_KEY).update(message).digest("hex");
  let initialized = 0;
  let cancellations = 0;
  let planPrice = "1.00";
  let conversationId;
  let formOk = false;
  let subscriptionStatus = "ACTIVE";
  const now = Date.now();
  const paidPeriod = { referenceCode: "order-a", orderStatus: "SUCCESS", currencyCode: "TRY", price: "4790.40",
    startPeriod: now - 10000, endPeriod: now + 86400000 };
  let orders = [paidPeriod];
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input?.url ?? input);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return realFetch(input, options);
    assert.equal(url.origin, "https://sandbox-api.iyzipay.com");
    const nonce = options.headers["x-iyzi-rnd"];
    const signed = sign(nonce + url.pathname + (options.body || ""));
    assert.equal(options.headers.Authorization, "IYZWSv2 " + btoa(`apiKey:fixture-key&randomKey:${nonce}&signature:${signed}`));
    switch (url.pathname) {
      case "/v2/subscription/pricing-plans/plan-ey":
        return Response.json({ status: "success", data: { referenceCode: "plan-ey", status: "ACTIVE", planPaymentType: "RECURRING",
          price: planPrice, currencyCode: "TRY", paymentInterval: "YEARLY", paymentIntervalCount: 1, trialPeriodDays: 0 } });
      case "/v2/subscription/checkoutform/initialize": {
        initialized++;
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body.customer).sort(), ["billingAddress", "email", "gsmNumber", "identityNumber", "name", "surname"]);
        assert.equal(body.customer.email, "owner@example.test");
        assert.equal(body.pricingPlanReferenceCode, "plan-ey");
        assert.equal(body.callbackUrl, origin + "/api/billing/callback?id=" + body.conversationId);
        conversationId = body.conversationId;
        return Response.json({ status: "success", conversationId, token: "checkout-token", checkoutFormContent: "<div>fixture</div>" });
      }
      case "/v2/subscription/checkoutform/checkout-token":
        assert.equal(options.method, "GET");
        assert.equal(url.searchParams.get("conversationId"), conversationId);
        return Response.json(formOk ? { status: "success", conversationId,
          data: { referenceCode: "sub", customerReferenceCode: "customer", subscriptionStatus: "ACTIVE",
            pricingPlanReferenceCode: "plan-ey" } } : { status: "failure" });
      case "/v2/subscription/subscriptions/sub/cancel":
        cancellations++;
        subscriptionStatus = "CANCELED";
        return Response.json({ status: "success" });
      case "/v2/subscription/subscriptions/sub":
        return Response.json({ status: "success", data: { referenceCode: "sub", customerReferenceCode: "customer",
          pricingPlanReferenceCode: "plan-ey", subscriptionStatus, orders } });
      default: throw new Error("Unexpected iyzico path: " + url.pathname);
    }
  });

  assert.equal((await call(null, 200)).enabled, false);
  await call(checkout, 503);
  env.OLVEX_BILLING = "sandbox";
  await call(checkout, 403, { user: "admin" });
  await call(checkout, 404, { user: "outsider" });
  await call(checkout, 503);
  assert.equal(initialized, 0);
  planPrice = "4790.40";
  const initial = await Promise.all([call(checkout, 200), call(checkout, 200)]);
  assert.equal(initial.filter(row => row.checkoutFormContent).length, 1);
  assert.equal(initialized, 1);
  await call({ ...checkout, requestId: crypto.randomUUID() }, 409);
  assert.equal((await call(null, 200)).tier, "free");

  const confirm = async (token, status) => {
    const response = await callback({ env, request: new Request(origin + "/api/billing/callback?id=" + checkout.requestId, {
      method: "POST", body: new URLSearchParams({ token })
    }) });
    assert.equal(response.status, status);
  };
  await confirm("wrong", 404);
  await confirm("checkout-token", 422);
  assert.equal((await call(null, 200)).subscription.state, "checkout");
  formOk = true;
  await confirm("checkout-token", 303);
  await confirm("checkout-token", 303);
  assert.equal((await call(null, 200)).tier, "esnaf");

  const notify = async (type, status, { valid = true, order = "order-next" } = {}) => {
    const event = { iyziEventType: "subscription.order." + type, subscriptionReferenceCode: "sub",
      customerReferenceCode: "customer", orderReferenceCode: order };
    const sig = sign("123" + env.IYZICO_SECRET_KEY + event.iyziEventType + "sub" + order + "customer");
    const response = await webhook({ env, request: new Request(origin + "/api/billing/webhook", {
      method: "POST", headers: { "Content-Type": "application/json", "X-IYZ-SIGNATURE-V3": valid ? sig : "0".repeat(64) },
      body: JSON.stringify(event)
    }) });
    assert.equal(response.status, status);
  };
  subscriptionStatus = "UNPAID";
  orders = [{ ...paidPeriod, referenceCode: "order-next", orderStatus: "FAILED" }];
  await notify("failure", 403, { valid: false });
  assert.equal((await call(null, 200)).tier, "esnaf");
  await notify("failure", 200);
  assert.equal((await call(null, 200)).subscription.state, "unpaid");
  assert.equal((await call(null, 200)).tier, "free");

  subscriptionStatus = "ACTIVE";
  orders = [{ ...paidPeriod, referenceCode: "order-next", endPeriod: paidPeriod.endPeriod + 86400000 }];
  await notify("success", 200);
  const revision = () => DB.prepare("SELECT revision FROM olvex_subscriptions WHERE id = ?").bind(checkout.requestId).first("revision");
  const afterRenewal = await revision();
  await notify("success", 200);
  await notify("failure", 200);
  assert.equal(await revision(), afterRenewal);
  assert.equal((await call(null, 200)).subscription.paidUntil, orders[0].endPeriod);

  const cancel = { action: "cancel", id: checkout.requestId };
  await call(cancel, 404, { user: "outsider", businessId: "other" });
  assert.equal((await call(cancel, 200)).state, "canceled");
  await call(cancel, 200);
  assert.equal(cancellations, 1);
  assert.equal((await call(null, 200)).tier, "free");
});
