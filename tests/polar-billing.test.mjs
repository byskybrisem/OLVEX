import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { onRequestPost as post, onRequestGet as get } from "../functions/api/workspace/[businessId]/[section].js";
import { onRequestPost as webhook } from "../functions/api/polar/webhook.js";
import { polarAccess } from "../functions/_lib/polar-billing.js";
import { randomToken, sha256 } from "../functions/_lib/session.js";

const DAY = 86400000;
const iso = value => new Date(value).toISOString();
const newId = () => crypto.randomUUID();

test("Polar checkout, kartlı deneme, imzalı olaylar ve işletme yetkileri izole D1 üzerinde", async t => {
  const dir = await mkdtemp(join(tmpdir(), "olvex-polar-"));
  const configPath = join(dir, "wrangler.json");
  await writeFile(configPath, JSON.stringify({ name: "olvex-polar", compatibility_date: "2025-10-01",
    d1_databases: [{ binding: "DB", database_name: "polar-test", database_id: newId() }] }));
  const runtime = await getPlatformProxy({ configPath, persist: false, remoteBindings: false });
  t.after(async () => {
    await runtime.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const { DB } = runtime.env;
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter(n => n.endsWith(".sql")).sort()) {
    await DB.batch(unstable_splitSqlQuery(await readFile(new URL(name, migrations), "utf8")).map(sql => DB.prepare(sql)));
  }

  const tokens = { owner: randomToken(), admin: randomToken() };
  await DB.batch([
    DB.prepare("INSERT INTO users(id,email) VALUES ('owner','owner@example.test'),('admin','admin@example.test')"),
    DB.prepare("INSERT INTO businesses(id,name,created_by) VALUES ('biz','Test','owner'),('alien','Diğer','admin'),('promo','Lansman','owner')"),
    DB.prepare(`INSERT INTO business_members(id,business_id,user_id,role)
      VALUES ('a','biz','owner','owner'),('b','biz','admin','admin'),('c','alien','admin','owner'),('d','promo','owner','owner')`),
    ...await Promise.all(Object.entries(tokens).map(async ([user, token]) =>
      DB.prepare("INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES (?,?,?,'2099-01-01T00:00:00Z')")
        .bind(user, user, await sha256(token))))
  ]);

  const origin = "https://polar-preview.example.test";
  const secret = "polar-fixture-secret";
  const env = { DB, OLVEX_ENVIRONMENT: "preview", OLVEX_POLAR: "sandbox", OLVEX_POLAR_ORIGIN: origin,
    POLAR_ACCESS_TOKEN: "fixture-token", POLAR_WEBHOOK_SECRET: secret,
    POLAR_STANDARD_PRODUCT_ID: newId(), POLAR_LAUNCH_PRODUCT_ID: newId(), POLAR_LAUNCH_DISCOUNT_ID: newId() };
  const call = async (body, expected, { businessId = "biz", user = "owner", section = "polar", csrf = origin } = {}) => {
    const request = new Request(`${origin}/api/workspace/${businessId}/${section}`, {
      method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined,
      headers: { Origin: csrf, "Content-Type": "application/json", Cookie: `olvex_session=${tokens[user]}` }
    });
    const response = await (body ? post : get)({ env, request, params: { businessId, section } });
    const data = await response.json();
    if (Array.isArray(expected)) assert.ok(expected.includes(response.status), JSON.stringify(data));
    else assert.equal(response.status, expected, JSON.stringify(data));
    return data;
  };

  const now = Date.now();
  let payload;
  let creationCount = 0;
  let portalBusiness = "biz";
  let checkoutId = newId();
  let subId = newId();
  let customerId = newId();
  let subscription;
  let orders = [];
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input?.url ?? input);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return realFetch(input, init);
    assert.equal(url.origin, "https://sandbox-api.polar.sh");
    assert.equal(init.headers.Authorization, "Bearer fixture-token");
    assert.equal(init.headers["Polar-Version"], "2026-10");
    const path = url.pathname;
    if (path === "/v1/checkouts/" && init.method === "POST") {
      creationCount++;
      payload = JSON.parse(init.body);
      const launch = Boolean(payload.discount_id);
      const trial = payload.allow_trial;
      return Response.json({ id: checkoutId, external_customer_id: payload.external_customer_id,
        status: "open", metadata: payload.metadata, tax_behavior: "inclusive", product_id: payload.products[0], discount_id: payload.discount_id, currency: "try",
        allow_trial: trial, allow_discount_codes: false, is_payment_setup_required: trial,
        active_trial_interval: trial ? "day" : null, active_trial_interval_count: trial ? 14 : null,
        total_amount: launch ? 70000 : trial ? 0 : 99900, discount: launch ? { type: "fixed", amounts: { try: 29900 }, duration: "repeating", duration_in_months: 3 } : null,
        product_price: { price_amount: 99900 }, product: { recurring_interval: "month", recurring_interval_count: 1 },
        expires_at: iso(now + DAY), url: "https://sandbox.polar.sh/checkout/fixture" });
    }
    if (path === "/v1/checkouts/" + checkoutId) return Response.json({
      id: checkoutId, metadata: payload.metadata, external_customer_id: payload.external_customer_id, product_id: payload.products[0],
      allow_trial: payload.allow_trial, is_payment_setup_required: payload.allow_trial,
      status: "succeeded", subscription_id: subId, customer_id: customerId
    });
    if (path === "/v1/subscriptions/" + subId) return Response.json(subscription);
    if (path === "/v1/orders/") {
      assert.equal(url.searchParams.get("subscription_id"), subId);
      return Response.json({ items: orders, pagination: { max_page: 1 } });
    }
    if (path === "/v1/customer-sessions/") {
      assert.equal(JSON.parse(init.body).external_customer_id, "biz");
      return Response.json({ customer_id: customerId, customer: { id: customerId, external_id: portalBusiness }, customer_portal_url: "https://sandbox.polar.sh/portal/fixture" });
    }
    throw new Error("Unexpected Polar request " + path);
  });

  async function send(type, data, { id = newId(), expected = 200, valid = true, stale = false } = {}) {
    const body = JSON.stringify({ type, data, api_version: "2026-10" });
    const timestamp = Math.floor(Date.now() / 1000) - (stale ? 360 : 0);
    const mac = createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64");
    const response = await webhook({ env, request: new Request(origin + "/api/polar/webhook", {
      method: "POST", body, headers: { "webhook-id": id, "webhook-timestamp": String(timestamp),
        "webhook-signature": "v1," + (valid ? mac : "aW52YWxpZA==") }
    }) });
    assert.equal(response.status, expected, await response.text());
  }

  const start = { action: "checkout", offer: "standard", product_id: newId(), price: 1, external_customer_id: "alien" };
  await call(start, 403, { user: "admin" });
  await call(start, 404, { businessId: "alien" });
  await call(start, 403, { csrf: "https://other.example.test" });
  await call({ ...start, offer: "launch" }, 409);
  const concurrent = await Promise.all([call(start, [200, 409]), call(start, [200, 409])]);
  assert.ok(concurrent.some(result => result.url));
  assert.equal(creationCount, 1);
  await call(start, 200);
  assert.equal(payload.external_customer_id, "biz");
  assert.equal(payload.products[0], env.POLAR_STANDARD_PRODUCT_ID);
  assert.equal(payload.trial_interval_count, 14);
  assert.equal((await call(null, 200, { section: "package" })).tier, "inactive");

  const account = () => ({ id: subId, customer_id: customerId, customer: { external_id: payload.external_customer_id },
    product_id: payload.products[0], currency: "try", checkout_id: checkoutId, metadata: payload.metadata,
    recurring_interval: "month", recurring_interval_count: 1 });
  subscription = { ...account(), status: "trialing", trial_start: iso(now), trial_end: iso(now + 14 * DAY) };
  await send("subscription.created", subscription, { valid: false, expected: 403 });
  await send("subscription.created", subscription, { stale: true, expected: 403 });
  await call({ action: "reconcile" }, 403, { user: "admin" });
  await call({ action: "reconcile" }, 404, { businessId: "alien" });
  const validProduct = subscription.product_id;
  subscription.product_id = newId();
  await call({ action: "reconcile" }, 502);
  subscription.product_id = validProduct;
  assert.equal((await call({ action: "reconcile" }, 200)).subscription.trialUntil, now + 14 * DAY);
  await send("subscription.created", subscription);
  const trial = await call(null, 200, { section: "package" });
  assert.equal(trial.paidUntil, null);
  assert.equal(trial.trialUntil, now + 14 * DAY);
  assert.equal(trial.tier, "profesyonel");
  portalBusiness = "alien";
  await call({ action: "portal" }, 502);
  portalBusiness = "biz";
  await call({ action: "portal" }, 200);

  subscription = { ...account(), status: "active", current_period_start: iso(now), current_period_end: iso(now + 31 * DAY) };
  await send("subscription.active", subscription);
  assert.equal((await call(null, 200, { section: "package" })).tier, "inactive");
  const order = { id: newId(), created_at: iso(now), billing_reason: "subscription_cycle", paid: true, status: "paid",
    product_id: subscription.product_id, customer_id: customerId, subscription_id: subId,
    total_amount: 99900, currency: "try", refunded_amount: 0, refunded_tax_amount: 0, applied_balance_amount: 0 };
  orders = [order];
  const delivery = newId();
  await send("order.paid", order, { id: delivery });
  await send("order.paid", order, { id: delivery });
  assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM olvex_polar_events WHERE delivery_id = ?").bind(delivery).first("n"), 1);
  assert.equal((await call(null, 200, { section: "package" })).paidUntil, now + 31 * DAY);

  subscription.cancel_at_period_end = true;
  await send("subscription.canceled", subscription);
  assert.equal((await call(null, 200)).subscription.state, "canceling");
  assert.equal((await call(null, 200)).subscription.paidUntil, now + 31 * DAY);
  subscription = { ...subscription, cancel_at_period_end: false, status: "past_due" };
  await send("subscription.past_due", subscription);
  assert.equal((await call(null, 200, { section: "package" })).paidUntil, now + 31 * DAY);
  subscription = { ...subscription, status: "active" };
  orders = [{ ...order, status: "refunded", refunded_amount: 99900 }];
  await send("order.refunded", orders[0]);
  assert.equal((await call(null, 200)).subscription.state, "refunded");
  assert.equal((await call(null, 200, { section: "package" })).paidUntil, null);
  subscription = { ...subscription, status: "canceled" };
  await send("subscription.revoked", subscription);
  assert.equal((await call(null, 200, { section: "package" })).tier, "inactive");
  checkoutId = newId();
  await call(start, 409);
  await call({ ...start, withoutTrial: true }, 200);
  assert.equal(payload.allow_trial, false);
  await send("checkout.updated", { id: checkoutId, status: "failed", product_id: payload.products[0],
    metadata: payload.metadata, external_customer_id: "biz" });
  assert.equal((await call(null, 200)).subscription.state, "failed");
  assert.equal((await call(null, 200, { section: "package" })).tier, "inactive");

  env.OLVEX_LAUNCH_OFFER = "on";
  env.OLVEX_LAUNCH_OFFER_STARTS_AT = iso(now - DAY).split(".")[0] + "Z";
  env.OLVEX_LAUNCH_OFFER_ENDS_AT = iso(now + DAY).split(".")[0] + "Z";
  checkoutId = newId();
  subId = newId();
  customerId = newId();
  await call({ action: "checkout", offer: "launch" }, 200, { businessId: "promo" });
  assert.equal(payload.products[0], env.POLAR_LAUNCH_PRODUCT_ID);
  assert.equal(payload.discount_id, env.POLAR_LAUNCH_DISCOUNT_ID);
  assert.equal(payload.allow_trial, false);
  assert.equal(payload.trial_interval, undefined);
  await send("checkout.expired", { id: checkoutId, status: "expired", product_id: payload.products[0],
    metadata: payload.metadata, external_customer_id: "promo" });
  assert.equal((await call(null, 200, { businessId: "promo" })).subscription.state, "expired");
  checkoutId = newId();
  await call({ action: "checkout", offer: "launch" }, 200, { businessId: "promo" });
  subscription = { ...account(), status: "active", current_period_start: iso(now - DAY), current_period_end: iso(now + 29 * DAY) };
  orders = [70000, 70000, 70000, 99900].map((total_amount, index) => ({
    ...order, id: newId(), product_id: subscription.product_id, customer_id: customerId, subscription_id: subId,
    total_amount, created_at: iso(now - (91 - index * 30) * DAY)
  }));
  const renewal = { id: newId() };
  await Promise.all([send("order.paid", orders[3], renewal), send("order.paid", orders[3], renewal)]);
  const paid = await call(null, 200, { businessId: "promo", section: "package" });
  assert.equal(paid.paidUntil, now + 29 * DAY);
  assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM olvex_polar_events WHERE delivery_id = ?").bind(renewal.id).first("n"), 1);
});

test("Lansman yalnızca üç ödenmiş döneme indirim uygular ve doğrulanmamış dönem erişimi açılmaz", () => {
  const now = Date.now();
  const row = { offer: "launch", product_id: "product", created_at: now - 120 * DAY };
  const sub = { id: "subscription", customer_id: "customer", status: "active", current_period_start: iso(now - DAY),
    current_period_end: iso(now + 29 * DAY) };
  const orders = [70000, 70000, 70000, 99900].map((total_amount, index) => ({
    id: String(index), created_at: iso(now - (91 - index * 30) * DAY),
    billing_reason: index ? "subscription_cycle" : "subscription_create", currency: "try", paid: true, status: "paid",
    total_amount, subscription_id: sub.id, customer_id: sub.customer_id, product_id: row.product_id,
    applied_balance_amount: 0, refunded_amount: 0, refunded_tax_amount: 0
  }));
  const failed = { ...orders[0], id: "failed", paid: false, status: "pending" };
  assert.equal(polarAccess(row, sub, [...orders, failed], now).paidUntil, now + 29 * DAY);
  assert.equal(polarAccess(row, { ...sub, ends_at: iso(now + DAY) }, orders, now).paidUntil, now + DAY);
  assert.equal(polarAccess(row, sub, orders, now + 30 * DAY).paidUntil, null);
  const historicalRefund = { ...orders[0], status: "refunded", paid: false, refunded_amount: 70000 };
  assert.equal(polarAccess(row, sub, [historicalRefund, ...orders.slice(1)], now).paidUntil, now + 29 * DAY);
  assert.equal(polarAccess(row, sub, [...orders.slice(0, -1), { ...orders[3], total_amount: 70000 }], now).paidUntil, null);
  assert.equal(polarAccess(row, sub, orders.slice(0, -1), now).paidUntil, null);
  assert.equal(polarAccess(row, { ...sub, status: "trialing", trial_start: iso(now - DAY),
    trial_end: iso(now + 13 * DAY) }, [], now).trialUntil, null);
});
