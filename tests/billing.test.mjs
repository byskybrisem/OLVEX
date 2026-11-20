import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { onRequestPost as callback } from "../functions/api/billing/callback.js";
import { onRequestPost as webhook } from "../functions/api/billing/webhook.js";
import { onRequestPost as hostedCheckout } from "../functions/api/billing/start.js";
import { onRequestGet, onRequestPost } from "../functions/api/workspace/[businessId]/[section].js";
import { entitlement, requirePaidSubscription } from "../functions/_lib/entitlements.js";
import { transact } from "../functions/_lib/workspace.js";
import { randomToken, sha256 } from "../functions/_lib/session.js";

for (const duringTrial of [true, false]) test(duringTrial ? "Doğrulanmış deneme, iptal ve müşteri sınırı" : "Deneme sonu, ilk tahsilat ve bildirim tekrarları", async (t) => {
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
    if (duringTrial && name === "0015_professional_trial.sql") {
      await DB.batch([
        DB.prepare("INSERT INTO users(id,email) VALUES ('legacy-owner','legacy@example.test')"),
        DB.prepare("INSERT INTO businesses(id,name,created_by) VALUES ('legacy','Esnaf','legacy-owner')"),
        DB.prepare(`INSERT INTO olvex_subscriptions
          (id,business_id,environment,plan,plan_ref,state,provider_ref,customer_ref,paid_until)
          VALUES ('old','legacy','live','esnaf-monthly','old-plan','active','old-sub','old-customer',4070908800000)`)
      ]);
    }
    await DB.batch(unstable_splitSqlQuery(await readFile(new URL(name, migrations), "utf8")).map(sql => DB.prepare(sql)));
  }
  if (duringTrial) {
    const legacy = await entitlement({ db: DB, env: {}, request: new Request("https://olvex.com.tr"), businessId: "legacy" });
    assert.equal(legacy.tier, "esnaf");
    assert.equal(legacy.paidUntil, 4070908800000);
    assert.equal(legacy.trialUntil, null);
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
    OLVEX_TRIAL_IDENTITY_SECRET: "isolated-fixture-trial-secret-32-bytes", IYZICO_MERCHANT_ID: "123", IYZICO_ESNAF_MONTHLY: "plan-em", IYZICO_ESNAF_YEARLY: "plan-ey",
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
  const packageTier = async (host = origin) => {
    const request = new Request(host + "/api/workspace/biz/package", {
      headers: { Cookie: "olvex_session=" + sessions.owner }
    });
    const response = await onRequestGet({ env, request, params: { businessId: "biz", section: "package" } });
    assert.equal(response.status, 200);
    return (await response.json()).tier;
  };
  const plan = duringTrial ? "profesyonel-monthly" : "profesyonel-yearly";
  const planRef = duringTrial ? "plan-pm" : "plan-py";
  const correctPrice = duringTrial ? "999.00" : "9590.40";
  const checkout = { action: "checkout", plan, requestId: crypto.randomUUID(), acceptedBillingTerms: true, price: 1,
    name: "Örnek", surname: "Üye", identityNumber: "00000000000", gsmNumber: "+905000000000",
    address: "Yalıtılmış test", city: "Denizli" };

  const sign = message => createHmac("sha256", env.IYZICO_SECRET_KEY).update(message).digest("hex");
  let initialized = 0;
  let cancellations = 0;
  let planDays = 14;
  let planPrice = "1.00";
  let conversationId;
  let formOk = false;
  let detailShape = "missing";
  let subscriptionStatus = "ACTIVE";
  const now = Date.now();
  const paidPeriod = { referenceCode: "order-a", orderStatus: "SUCCESS", currencyCode: "TRY", price: correctPrice,
    startPeriod: now - 10000, endPeriod: now + 86400000 };
  const trialStartDate = now - (duringTrial ? 1000 : 15 * 86400000);
  let dateOffset = 0;
  const trialEndDate = trialStartDate + 14 * 86400000;
  let orders = [{ ...paidPeriod, orderStatus: "WAITING", startPeriod: trialEndDate }];
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input?.url ?? input);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return realFetch(input, options);
    assert.equal(url.origin, "https://sandbox-api.iyzipay.com");
    const nonce = options.headers["x-iyzi-rnd"];
    const signed = sign(nonce + url.pathname + (options.body || ""));
    assert.equal(options.headers.Authorization, "IYZWSv2 " + btoa(`apiKey:fixture-key&randomKey:${nonce}&signature:${signed}`));
    switch (url.pathname) {
      case "/v2/subscription/pricing-plans/" + planRef:
        return Response.json({ status: "success", data: { referenceCode: planRef, status: "ACTIVE", planPaymentType: "RECURRING",
          price: planPrice, currencyCode: "TRY", paymentInterval: duringTrial ? "MONTHLY" : "YEARLY", paymentIntervalCount: 1, trialPeriodDays: planDays } });
      case "/v2/subscription/checkoutform/initialize": {
        initialized++;
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body.customer).sort(), ["billingAddress", "email", "gsmNumber", "identityNumber", "name", "surname"]);
        assert.ok(["owner@example.test", "outsider@example.test"].includes(body.customer.email));
        assert.equal(body.pricingPlanReferenceCode, planRef);
        assert.equal(body.callbackUrl, origin + "/api/billing/callback?id=" + body.conversationId);
        conversationId = body.conversationId;
        return Response.json({ status: "success", conversationId, token: body.customer.email === "outsider@example.test" ? "checkout-token-other" : "checkout-token", checkoutFormContent: "<script>window.iyzicoFixture = true;</script>" });
      }
      case "/v2/subscription/checkoutform/checkout-token":
        assert.equal(options.method, "GET");
        assert.equal(url.searchParams.get("conversationId"), conversationId);
        return Response.json(formOk ? { status: "success", conversationId,
          data: { referenceCode: "sub", customerReferenceCode: "customer", subscriptionStatus: "ACTIVE",
            pricingPlanReferenceCode: planRef } } : { status: "failure" });
      case "/v2/subscription/subscriptions/sub/cancel":
        cancellations++;
        subscriptionStatus = "CANCELED";
        return Response.json({ status: "success" });
      case "/v2/subscription/subscriptions/sub": {
        const subscription = { referenceCode: "sub", customerReferenceCode: "customer",
          pricingPlanReferenceCode: planRef, subscriptionStatus, trialDays: 14, trialStartDate: trialStartDate + dateOffset, trialEndDate: trialEndDate + dateOffset, orders };
        const unrelated = { ...subscription, referenceCode: "other-sub" };
        const items = detailShape === "missing" ? [unrelated] : [unrelated, subscription];
        if (detailShape === "duplicate") items.push(subscription);
        return Response.json({ status: "success", data: detailShape === "direct" ? subscription : { items } });
      }
      default: throw new Error("Unexpected iyzico path: " + url.pathname);
    }
  });

  assert.equal((await call(null, 200)).enabled, false);
  await call(checkout, 503);
  env.OLVEX_BILLING = "live";
  await call(checkout, 403);
  assert.equal(initialized, 0);
  env.OLVEX_BILLING = "sandbox";
  env.OLVEX_ENVIRONMENT = "preview";
  await call(checkout, 403, { user: "admin" });
  await call(checkout, 404, { user: "outsider" });
  await call({ ...checkout, acceptedBillingTerms: false }, 400);
  await call({ ...checkout, plan: "esnaf-monthly" }, 400);
  await call(checkout, 503);
  assert.equal(initialized, 0);
  planPrice = correctPrice;
  planDays = 0;
  await call(checkout, 503);
  planDays = 14;
  const initial = await Promise.all([call(checkout, 200), call(checkout, 200)]);
  assert.equal(initial.filter(row => row.checkoutFormContent).length, 1);
  assert.equal(initialized, 1);
  await call({ ...checkout, requestId: crypto.randomUUID() }, 409);
  assert.equal((await call(null, 200)).tier, "inactive");

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
  await confirm("checkout-token", 502);
  detailShape = "duplicate";
  await confirm("checkout-token", 502);
  assert.equal((await call(null, 200)).tier, "inactive");
  detailShape = "list";
  dateOffset = 20 * 86400000;
  await confirm("checkout-token", 502);
  dateOffset = 0;
  subscriptionStatus = "PENDING";
  await confirm("checkout-token", 303);
  assert.equal((await call(null, 200)).subscription.trialStartedAt, null);
  subscriptionStatus = "ACTIVE";
  await confirm("checkout-token", 303);
  await confirm("checkout-token", 303);
  const subscription = (await call(null, 200)).subscription;
  assert.equal(subscription.trial, duringTrial);
  assert.equal(subscription.trialStartedAt, trialStartDate);
  assert.equal(subscription.trialUntil, trialEndDate);
  const trialTier = duringTrial ? "profesyonel" : "inactive";
  assert.equal(await packageTier(), trialTier);
  assert.equal(await packageTier("https://olvex.com.tr"), "inactive");
  // A preview that already ran 0015 may have only the verified end on file.
  await DB.prepare("UPDATE olvex_subscriptions SET trial_started_at = NULL WHERE id = ?").bind(checkout.requestId).run();
  assert.equal(await packageTier(), "inactive");
  dateOffset = -1000;
  await confirm("checkout-token", 502);
  dateOffset = 0;
  await confirm("checkout-token", 303);
  assert.equal((await call(null, 200)).subscription.trialStartedAt, trialStartDate);

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
  if (!duringTrial) {
    detailShape = "direct";
    subscriptionStatus = "UNPAID";
    orders = [{ ...paidPeriod, referenceCode: "order-next", orderStatus: "FAILED" }];
    await notify("failure", 403, { valid: false });
    assert.equal((await call(null, 200)).tier, "inactive");
    await notify("failure", 200);
    assert.equal(await packageTier(), "inactive");
    assert.equal((await call(null, 200)).subscription.state, "unpaid");
    assert.equal((await call(null, 200)).tier, "inactive");

    subscriptionStatus = "ACTIVE";
    orders = [{ ...paidPeriod, referenceCode: "order-next", endPeriod: paidPeriod.endPeriod + 86400000 }];
    await notify("success", 200);
    const revision = () => DB.prepare("SELECT revision FROM olvex_subscriptions WHERE id = ?").bind(checkout.requestId).first("revision");
    const afterRenewal = await revision();
    await notify("success", 200);
    await notify("failure", 200);
    assert.equal(await revision(), afterRenewal);
    assert.equal(await packageTier(), "profesyonel");
    assert.equal((await call(null, 200)).subscription.paidUntil, orders[0].endPeriod);
  }

  const queuedWrite = { db: DB, env, request: new Request(origin), businessId: "biz", actorId: "owner", roles: ["owner"] };
  queuedWrite.packageGuard = await requirePaidSubscription(queuedWrite);
  const cancel = { action: "cancel", id: checkout.requestId };
  await call(cancel, 404, { user: "outsider", businessId: "other" });
  assert.equal((await call(cancel, 200)).state, "canceled");
  await call(cancel, 200);
  assert.equal(cancellations, 1);
  assert.equal((await call(null, 200)).tier, trialTier);
  if (!duringTrial) {
    await assert.rejects(transact(queuedWrite, "business-rename", { requestId: crypto.randomUUID() }, [
      DB.prepare("UPDATE businesses SET name = 'Değişmemeli' WHERE id = 'biz'")
    ]), { status: 403 });
    assert.equal(await DB.prepare("SELECT name FROM businesses WHERE id = 'biz'").first("name"), "Örnek");
  }
  await call({ ...checkout, requestId: crypto.randomUUID() }, 409);

  // Hosted checkout must render the iyzico bootstrap safely, not collect card data locally.
  await DB.batch([
    DB.prepare("INSERT INTO businesses(id,name,created_by) VALUES ('another','Ek işletme','owner')"),
    DB.prepare("INSERT INTO business_members(id,business_id,user_id,role) VALUES ('extra','another','owner','owner')")
  ]);
  await call({ ...checkout, requestId: crypto.randomUUID(), identityNumber: "22222222222" }, 409, { businessId: "another" });
  await call({ ...checkout, requestId: crypto.randomUUID() }, 409, { user: "outsider", businessId: "other" });
  const fields = { ...checkout, identityNumber: "11111111111", businessId: "other", requestId: crypto.randomUUID() };
  const form = new URLSearchParams(Object.entries(fields).map(([key,value])=>[key,String(value)]));
  const postForm = (originUrl, cookie, headers = {}) => hostedCheckout({ env,
    request: new Request(originUrl + "/api/billing/start", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded",
        Cookie: "olvex_session=" + cookie, ...headers }, body: form
    })
  });
  const noOrigin = await postForm(origin, sessions.outsider);
  assert.equal(noOrigin.status, 403);
  const wrongHost = await postForm("https://olvex.com.tr", sessions.outsider,
    { Origin: "https://olvex.com.tr" });
  assert.equal(wrongHost.status, 403);
  const forbidden = await postForm(origin, sessions.admin, { Origin: origin });
  assert.equal(forbidden.status, 404);
  const hosted = await postForm(origin, sessions.outsider, { Origin: origin });
  assert.equal(hosted.status, 200);
  assert.match(hosted.headers.get("Content-Security-Policy"), /script-src.*nonce-/);
  assert.equal(hosted.headers.get("Cache-Control"), "no-store");
  const content = await hosted.text();
  assert.match(content, /<script nonce="[a-f0-9]+">window\.iyzicoFixture/);
  assert.doesNotMatch(content, /fixture-secret|fixture-key/);

  // When live billing is switched on, unpaid businesses cannot create new records.
  env.OLVEX_BILLING = "live";
  const blocked = await onRequestPost({ env,
    request: new Request(origin + "/api/workspace/biz/products", {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json",
        Cookie: "olvex_session=" + sessions.owner },
      body: JSON.stringify({ action: "save", requestId: crypto.randomUUID() })
    }), params: { businessId: "biz", section: "products" }
  });
  assert.equal(blocked.status, 403);
});
