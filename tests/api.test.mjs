import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { passwordHash } from "../functions/_lib/password.js";
import { sha256 } from "../functions/_lib/session.js";
import { addDays, today } from "../functions/_lib/validate.js";
import { stableId } from "../functions/_lib/workspace.js";
import { localPages } from "./local.mjs";

const id = () => crypto.randomUUID();
const todayDate = today();
const yesterday = addDays(todayDate, -1);
const twoDaysAgo = addDays(todayDate, -2);
const password = "Fixture-OLVEX-2026";
const replacementPassword = "Reset-fixture-2026";
const resetToken = "r".repeat(43);
const legacyId = id();
let pages;
let thisBusiness;
let owner;
let teammate;
let other;
let product;
let secondProduct;
let customer;
let paidSale;

class Client {
  cookie = "";
  constructor(base) { this.base = base; }

  async call(path, { method = "GET", body, headers = {}, status = 200, cookie = true } = {}) {
    const response = await fetch(this.base + path, {
      method,
      headers: {
        ...(method === "POST" ? { Origin: this.base } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie && this.cookie ? { Cookie: this.cookie } : {}),
        ...headers
      },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) })
    });
    const data = await response.json().catch(() => null);
    assert.equal(response.status, status, `${method} ${path}: ${data?.error || response.statusText}`);
    const token = response.headers.get("Set-Cookie");
    if (token && (path === "/api/auth/login" || path === "/api/auth/logout")) this.cookie = token.split(";")[0];
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return { data, response };
  }

  post(path, body, status = 200, extra) {
    return this.call(path, { method: "POST", body, status, ...extra });
  }

  async read(business, section, query = "", status = 200) {
    return (await this.call(`/api/workspace/${business}/${section}${query}`, { status })).data;
  }

  async mutate(business, section, action, body = {}, status = 200) {
    return (await this.post(`/api/workspace/${business}/${section}`, { requestId: id(), ...body, action }, status)).data;
  }

  async login(email, pass = password, status = 200, remember = false) {
    return await this.post("/api/auth/login", { email, password: pass, remember }, status);
  }
}

async function account(name, address) {
  const client = new Client(pages.url);
  const { data: info } = await client.call("/api/public-info");
  assert.equal(info.registrationOpen, true);
  await client.post("/api/auth/register", {
    fullName: name, email: address, password, acceptedTerms: true, termsVersion: info.termsVersion
  }, 201);
  await client.login(address);
  return client;
}

async function stockFor(client, business, code) {
  return (await client.read(business, "products", "?archived=1")).rows.find((row) => row.sku === code)?.stock;
}

const sale = (reference, sku, quantity, extra = {}) => ({
  date: yesterday, reference, lines: [{ sku, quantity }], paid: true, ...extra
});
const saveProduct = (client, business, input) => client.mutate(business, "products", "save",
  { name: "Örnek ürün", price: 12550, cost: 5700, opening: 10, ...input });

before(async () => {
  const hash = await passwordHash(password);
  const tokenHash = await sha256(resetToken);
  const expiresAt = new Date(Date.now() + 600_000).toISOString();
  pages = await localPages({ seed: `
    INSERT INTO users(id,email,full_name,password_hash) VALUES ('${legacyId}','legacy@example.test','Eski Hesap','${hash}');
    INSERT INTO olvex_password_resets(token_hash,user_id,expires_at) VALUES ('${tokenHash}','${legacyId}','${expiresAt}');
  ` });
});

after(async () => { await pages?.close(); });

test("hesap, politika sürümü, oturum çerezi ve şifre sıfırlama", async () => {
  const newClient = new Client(pages.url);
  await newClient.call("/api/auth/me", { status: 401 });
  await newClient.call("/api/businesses", { status: 401 });
  const { data: info } = await newClient.call("/api/public-info");
  assert.equal(info.email, null);
  await newClient.post("/api/auth/register", {
    fullName: "Örnek", email: "preview@example.test", password, termsVersion: info.termsVersion
  }, 400);
  await newClient.post("/api/auth/register", {
    fullName: "Örnek", email: "preview@example.test", password, acceptedTerms: true, termsVersion: "eski"
  }, 400);
  await newClient.post("/api/auth/login", "{", 400);
  await newClient.post("/api/auth/login", { email: "legacy@example.test", password }, 403, { headers: { Origin: "https://example.test" } });

  const { response } = await newClient.login("LEGACY@example.test", password, 200, true);
  const cookie = response.headers.get("Set-Cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=2592000/);
  const { data: session } = await newClient.call("/api/auth/me");
  assert.equal(session.user.id, legacyId);

  await newClient.post("/api/auth/password-reset", { action: "request", email: "legacy@example.test" }, 503);
  await newClient.post("/api/auth/password-reset", { action: "reset", token: resetToken, password: replacementPassword });
  await newClient.call("/api/auth/me", { status: 401 });
  await newClient.post("/api/auth/password-reset", { action: "reset", token: resetToken, password: replacementPassword }, 400);
  await newClient.login("legacy@example.test", password, 401);
  await newClient.login("legacy@example.test", replacementPassword);
  await newClient.post("/api/auth/logout", {});
  await newClient.call("/api/auth/me", { status: 401 });
});

test("önceki ve yeni işletme akışı, kayıt eşsizliği ve işletme izolasyonu", async () => {
  owner = await account("İşletme Sahibi", "owner@example.test");
  teammate = await account("Ekip Üyesi", "teammate@example.test");
  other = await account("Başka İşletme", "other@example.test");
  const { data: info } = await owner.call("/api/public-info");
  await owner.post("/api/auth/register", {
    fullName: "Aynı Hesap", email: "OWNER@example.test", password, acceptedTerms: true, termsVersion: info.termsVersion
  }, 409);
  const empty = await owner.call("/api/businesses");
  assert.deepEqual(empty.data.businesses, []);
  const requestId = id();
  const { data } = await owner.post("/api/businesses", { name: "Merkez", requestId }, 201);
  thisBusiness = data.business.id;
  assert.equal(thisBusiness, requestId);
  await owner.post("/api/businesses", { name: "Merkez", requestId }, 201);
  await owner.post("/api/businesses", { name: "Farklı", requestId }, 409);
  const { data: branch } = await owner.post("/api/businesses", { name: "İkinci Şube" }, 201);
  assert.equal(branch.business.role, "owner");
  const { data: isolated } = await other.post("/api/businesses", { name: "Ayrı İşletme" }, 201);
  assert.notEqual(isolated.business.id, thisBusiness);
  await other.read(thisBusiness, "products", "", 404);
  await other.mutate(thisBusiness, "products", "save", { name: "Örnek", sku: "500", price: 1, cost: 1 }, 404);
  await owner.read(isolated.business.id, "overview", "", 404);
});

test("stok girişi, satış, satır hatasında atomik geri alma, tekrar ve eşzamanlı satış", async () => {
  product = await saveProduct(owner, thisBusiness, { sku: "ELMA", name: "Elma" });
  secondProduct = await saveProduct(owner, thisBusiness, { sku: "KİRAZ", name: "Kiraz", opening: 2 });
  await owner.mutate(thisBusiness, "products", "save", { name: "Aynı", sku: "elma", price: 1, cost: 1 }, 409);
  customer = await owner.mutate(thisBusiness, "customers", "save", { name: "Ada <Örnek>", email: "buyer@example.test" });
  paidSale = await owner.mutate(thisBusiness, "sales", "create", sale("ILK", "ELMA", 3, { customerId: customer.id }));
  const replay = await owner.mutate(thisBusiness, "sales", "create",
    sale("ILK", "elma", 3, { requestId: paidSale.id, customerId: customer.id }));
  assert.equal(replay.repeated, true);
  assert.equal(await stockFor(owner, thisBusiness, "ELMA"), 7);
  await owner.mutate(thisBusiness, "sales", "create", sale("ILK", "ELMA", 4, { requestId: paidSale.id, customerId: customer.id }), 409);
  await owner.mutate(thisBusiness, "sales", "create",
    sale("HATALI", "ELMA", 1, { lines: [{ sku: "ELMA", quantity: 2 }, { sku: "KİRAZ", quantity: 3 }] }), 409);
  assert.equal(await stockFor(owner, thisBusiness, "ELMA"), 7);
  assert.equal(await stockFor(owner, thisBusiness, "KİRAZ"), 2);
  assert.equal((await owner.read(thisBusiness, "sales")).rows.length, 1);
  await owner.mutate(thisBusiness, "sales", "create", sale("BILINMEYEN", "YOK", 1), 400);

  const url = `/api/workspace/${thisBusiness}/sales`;
  const responses = await Promise.all(["YARIS-A", "YARIS-B"].map((reference) => fetch(owner.base + url, {
    method: "POST",
    headers: { Origin: owner.base, Cookie: owner.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ ...sale(reference, "ELMA", 5, { paid: false }), action: "create", requestId: id() })
  })));
  assert.deepEqual(responses.map((item) => item.status).sort(), [200, 409]);
  await Promise.all(responses.map((item) => item.text()));
  assert.equal(await stockFor(owner, thisBusiness, "ELMA"), 2);
  const dashboard = await owner.read(thisBusiness, "overview");
  const waiting = await owner.read(thisBusiness, "sales", "?unpaid=1");
  assert.deepEqual(waiting.rows.map(row => row.total_minor), [62750]);
  const movements = await owner.read(thisBusiness, "stock", "?q=ELMA");
  assert.ok(movements.rows.length > 0);
  assert.ok(movements.rows.every(row => row.sku === "ELMA"));
  assert.equal(dashboard.receivables.length, 1);
  assert.equal(dashboard.receivables[0].total_minor, 62750);
  assert.equal(dashboard.unpaid.sale, dashboard.receivables[0].total_minor);
  const { rows } = await owner.read(thisBusiness, "customer-history", `?id=${customer.id}`);
  assert.equal(rows[0].total_minor, 37650);
});

test("alış, iptal, stok üst/alt sınırı ve tahsilat tarihine göre finans", async () => {
  const buy = await owner.mutate(thisBusiness, "purchases", "create", sale("TED-1", "ELMA", 3, {
    supplier: "Örnek Tedarikçi", paid: false, lines: [{ sku: "ELMA", quantity: 3, unit: 7000 }]
  }));
  assert.equal(await stockFor(owner, thisBusiness, "ELMA"), 5);
  await owner.mutate(thisBusiness, "purchases", "settle", { id: buy.id, date: twoDaysAgo }, 409);
  await owner.mutate(thisBusiness, "purchases", "settle", { id: buy.id, date: todayDate });
  const key = id();
  await owner.mutate(thisBusiness, "sales", "void", { id: paidSale.id, requestId: key, date: todayDate });
  const repeated = await owner.mutate(thisBusiness, "sales", "void", { id: paidSale.id, requestId: key, date: todayDate });
  assert.equal(repeated.repeated, true);
  assert.equal(await stockFor(owner, thisBusiness, "ELMA"), 8);
  await owner.mutate(thisBusiness, "stock", "adjust",
    { productId: secondProduct.id, delta: -3, note: "Sayım" }, 409);
  await owner.mutate(thisBusiness, "stock", "adjust",
    { productId: secondProduct.id, delta: 10000000, note: "Sayım" }, 409);
  await owner.mutate(thisBusiness, "finance", "create", { kind: "income", amount: 4499, description: "Diğer gelir", date: todayDate });
  const { totals: beforeRefund } = await owner.read(thisBusiness, "overview", `?from=${yesterday}&to=${yesterday}`);
  assert.equal(beforeRefund.revenue, 37650);
  const { totals: refundDay } = await owner.read(thisBusiness, "reports", `?from=${todayDate}&to=${todayDate}`);
  assert.equal(refundDay.revenue, 4499);
  assert.equal(refundDay.spending, 37650 + 21000);
  const purchase = await owner.mutate(thisBusiness, "purchases", "create", sale("TED-2", "KİRAZ", 1,
    { supplier: "Örnek", paid: false }));
  await owner.mutate(thisBusiness, "sales", "create", sale("SON", "KİRAZ", 3, { paid: false }));
  await owner.mutate(thisBusiness, "purchases", "void", { id: purchase.id }, 409);
  assert.equal(await stockFor(owner, thisBusiness, "KİRAZ"), 0);
});

test("kasa anahtarı, satış/CSV tekrarları, iade ve anahtar iptali", async () => {
  const secret = "p".repeat(43);
  const created = await owner.mutate(thisBusiness, "pos", "create", { name: "Deneme POS", identityMode: "native", secret });
  const { rows } = await owner.read(thisBusiness, "pos");
  assert.equal(rows[0].id, created.id);
  assert.equal(Object.hasOwn(rows[0], "token_hash"), false);
  const extra = { headers: { Authorization: `Bearer olvex_pos_${secret}` }, cookie: false };
  const posSale = { action: "sale", reference: "POS-1", date: todayDate, paid: true, lines: [{ sku: "ELMA", quantity: 1, unit: 10599 }] };
  await owner.post("/api/pos", posSale, 401, { cookie: false });
  const result = await owner.post("/api/pos", posSale, 201, extra);
  const duplicate = await owner.post("/api/pos", posSale, 200, extra);
  assert.equal(result.data.id, duplicate.data.id);
  assert.equal(duplicate.data.repeated, true);
  assert.equal(await stockFor(owner, thisBusiness, "ELMA"), 7);
  await owner.post("/api/pos", { ...posSale, lines: [{ sku: "ELMA", quantity: 2, unit: 10599 }] }, 409, extra);
  const reversal = { action: "void", reference: "POS-1", date: todayDate };
  await owner.post("/api/pos", reversal, 200, extra);
  await owner.post("/api/pos", reversal, 200, extra);
  await owner.post("/api/pos", { ...reversal, date: yesterday }, 409, extra);
  assert.equal(await stockFor(owner, thisBusiness, "ELMA"), 8);
  await owner.mutate(thisBusiness, "sales", "import", { ...posSale, reference: "CSV-1", action: undefined }, 400);
  const csv = { ...posSale, registerId: created.id, reference: "CSV-1" };
  const imported = await owner.mutate(thisBusiness, "sales", "import", { ...csv, action: undefined });
  const second = await owner.mutate(thisBusiness, "sales", "import", { ...csv, action: undefined });
  assert.equal(imported.id, second.id);
  assert.equal((await owner.post("/api/pos", csv, 200, extra)).data.id, imported.id);
  assert.equal(second.repeated, true);
  await owner.mutate(thisBusiness, "pos", "revoke", { id: created.id });
  await owner.post("/api/pos", posSale, 401, extra);

  const renewal = { id: created.id, requestId: id(), secret: "s".repeat(43) };
  await owner.mutate(thisBusiness, "pos", "rotate", { id: created.id, secret }, 409);
  await owner.mutate(thisBusiness, "pos", "rotate", renewal);
  assert.equal((await owner.mutate(thisBusiness, "pos", "rotate", renewal)).repeated, true);
  const renewed = { headers: { Authorization: `Bearer olvex_pos_${renewal.secret}` }, cookie: false };
  assert.equal((await owner.post("/api/pos", posSale, 200, renewed)).data.id, result.data.id);
  await owner.post("/api/pos", posSale, 401, extra);
  await owner.mutate(thisBusiness, "pos", "create", { name: "Eski anahtar", secret }, 409);
  await owner.mutate(thisBusiness, "pos", "rotate", { id: created.id, secret }, 409);
  assert.equal(await stockFor(owner, thisBusiness, "ELMA"), 7);
});

test("uzlaştırma onayını, kalıcı kaynak konumunu ve kasa sınırını doğrular", async () => {
  const secret = "j".repeat(43);
  const register = await owner.mutate(thisBusiness, "pos", "create", { name: "Arşiv kasası", secret });
  const otherRegister = await owner.mutate(thisBusiness, "pos", "create", { name: "Diğer kasa", secret: "k".repeat(43) });
  const auth = (key) => ({ headers: { Authorization: `Bearer olvex_pos_${key}` }, cookie: false });
  const send = (body, status, key = secret) => owner.post("/api/pos", body, status, auth(key));
  const evidence = "JOURNAL-2026-0008/42";
  const receipt = {
    action: "sale", evidence, date: yesterday, paid: true, lines: [{ sku: "ELMA", quantity: 2, unit: 330 }]
  };
  const stock = await stockFor(owner, thisBusiness, "ELMA");
  const mapping = { registerId: register.id, eventKind: "sale", evidence, reference: "ARCHIVE-42", requestId: id() };
  await send({ ...receipt, reference: "random" }, 409);
  await send({ ...receipt, registerId: otherRegister.id }, 403);
  await owner.mutate(thisBusiness, "pos", "reconcile", mapping);
  const approvedAgain = await owner.mutate(thisBusiness, "pos", "reconcile", mapping);
  assert.equal(approvedAgain.repeated, true);
  await owner.mutate(thisBusiness, "pos", "reconcile", { ...mapping, requestId: id(), reference: "ARCHIVE-43" }, 409);
  await owner.mutate(thisBusiness, "pos", "reconcile", { ...mapping, requestId: id(), evidence: "JOURNAL-2026-0008/43" }, 409);
  await send({ ...receipt, reference: "forged" }, 409);
  await send(receipt, 409, "k".repeat(43));
  assert.equal(await stockFor(owner, thisBusiness, "ELMA"), stock);
  const { data: posted } = await send(receipt, 201);
  assert.equal((await send(receipt, 200)).data.id, posted.id);
  const refund = { action: "return", evidence: "JOURNAL-2026-0008/44", saleEvidence: evidence,
    date: todayDate, lines: [{ sku: "ELMA", quantity: 1 }] };
  await send(refund, 409);
  await owner.mutate(thisBusiness, "pos", "reconcile", {
    registerId: register.id, eventKind: "return", evidence: refund.evidence, reference: "ARCHIVE-44"
  });
  await send(refund, 201);
  assert.equal((await send(refund, 200)).data.repeated, true);
  assert.equal(await stockFor(owner, thisBusiness, "ELMA"), stock - 1);
  await send({ action: "void", evidence, date: todayDate }, 200);
  assert.equal(await stockFor(owner, thisBusiness, "ELMA"), stock);
});

test("davet, roller ve hassas maliyet alanlarının üyeye dönmemesi", async () => {
  const secret = "i".repeat(43);
  await owner.mutate(thisBusiness, "settings", "invite", { email: "teammate@example.test", role: "member", secret });
  await other.post("/api/join", { token: secret }, 400);
  const { data: membership } = await teammate.post("/api/join", { token: secret });
  assert.equal(membership.businessId, thisBusiness);
  await teammate.post("/api/join", { token: secret });
  const memberView = await teammate.read(thisBusiness, "products");
  assert.equal(Object.hasOwn(memberView.rows[0], "cost_minor"), false);
  const memberSales = await teammate.read(thisBusiness, "sales");
  assert.equal(Object.hasOwn(JSON.parse(memberSales.rows[0].items_json)[0], "cost"), false);
  assert.equal(Object.hasOwn((await teammate.read(thisBusiness, "overview")).totals, "cost"), false);
  await teammate.read(thisBusiness, "finance", "", 403);
  const dashboard = await teammate.read(thisBusiness, "overview", "?detail=dashboard");
  assert.equal(dashboard.receivables, undefined);
  assert.deepEqual(Object.keys(dashboard.previous).sort(), ["saleCount", "sales"]);
  assert.ok(dashboard.leaders.length);
  assert.deepEqual(Object.keys(dashboard.leaders[0]).sort(), ["name", "quantity", "sales"]);
  await teammate.read(thisBusiness, "settings", "", 403);
  await teammate.mutate(thisBusiness, "products", "archive", { id: product.id }, 403);
  const { data: memberSession } = await teammate.call("/api/auth/me");
  await owner.mutate(thisBusiness, "settings", "member", { userId: memberSession.user.id, role: "admin" });
  await teammate.read(thisBusiness, "finance");
  await teammate.mutate(thisBusiness, "settings", "rename", { name: "Yetkisiz" }, 403);
  await owner.mutate(thisBusiness, "settings", "member", { userId: memberSession.user.id, role: "remove" });
  await teammate.read(thisBusiness, "finance", "", 404);
  await teammate.post("/api/join", { token: secret }, 400);
});

test("fatura vadeleri, vardiya çakışması ve ay sonu tekrar kuralı", async () => {
  const invoice = { direction: "outgoing", number: "D-1", counterparty: "Örnek", issuedOn: yesterday, dueOn: todayDate, amount: 15499, status: "open" };
  await owner.mutate(thisBusiness, "invoices", "save", { ...invoice, dueOn: twoDaysAgo }, 400);
  const saved = await owner.mutate(thisBusiness, "invoices", "save", invoice);
  await owner.mutate(thisBusiness, "invoices", "save", invoice, 409);
  await owner.mutate(thisBusiness, "invoices", "save", { ...invoice, id: saved.id, status: "paid" });
  assert.equal((await owner.read(thisBusiness, "invoices")).rows[0].status, "paid");

  const employee = await owner.mutate(thisBusiness, "employees", "save", { name: "Nöbetçi", title: "Satış" });
  const shift = { employeeId: employee.id, date: yesterday, start: "22:00", end: "06:00" };
  await owner.mutate(thisBusiness, "shifts", "create", shift);
  await owner.mutate(thisBusiness, "shifts", "create", { ...shift, date: todayDate, start: "05:30", end: "09:00" }, 409);
  await owner.mutate(thisBusiness, "shifts", "create", { ...shift, date: todayDate, start: "06:00", end: "14:00" });

  const task = await owner.mutate(thisBusiness, "tasks", "save", { title: "Ay sonu", date: "2026-01-31", repeat: "monthly" });
  const next = await owner.mutate(thisBusiness, "tasks", "complete", { id: task.id });
  const replay = await owner.mutate(thisBusiness, "tasks", "complete", { requestId: next.id, id: task.id });
  assert.equal(replay.repeated, true);
  const { rows } = await owner.read(thisBusiness, "tasks", "?from=2026-02-28&to=2026-02-28&exact=1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, next.id);
  await owner.mutate(thisBusiness, "tasks", "complete", { id: next.id });
  const march = await owner.read(thisBusiness, "task-days", "?from=2026-03-01&to=2026-03-31");
  assert.deepEqual(march.rows, [{ day: "2026-03-31", count: 1 }]);
});

test("ücretsiz AI, onay öncesi işlem yok, tek sefer uygulama ve reddetme", async () => {
  const before = await owner.read(thisBusiness, "finance");
  const first = await owner.mutate(thisBusiness, "ai", "ask", { messages: [{ role: "user", content: "gider 125,50 elektrik" }] });
  assert.equal(first.proposal.amount, 12550);
  const draft = await owner.read(thisBusiness, "ai");
  assert.equal(draft.mode, "mock");
  assert.equal(draft.proposals[0].id, first.proposal.id);
  const waiting = await owner.read(thisBusiness, "finance");
  assert.deepEqual(waiting.rows, before.rows);
  const applied = await owner.mutate(thisBusiness, "ai", "apply", { id: first.proposal.id });
  const repeated = await owner.mutate(thisBusiness, "ai", "apply", { id: first.proposal.id, requestId: applied.id });
  assert.equal(repeated.repeated, true);
  await owner.mutate(thisBusiness, "ai", "apply", { id: first.proposal.id }, 409);
  const actual = await owner.read(thisBusiness, "finance");
  assert.equal(actual.rows.filter((row) => row.description === "elektrik").length, 1);
  const remaining = await stockFor(owner, thisBusiness, "ELMA");
  const stockIdea = await owner.mutate(thisBusiness, "ai", "ask", { messages: [{ role: "user", content: "stok ELMA -1 sayım" }] });
  await owner.mutate(thisBusiness, "ai", "discard", { id: stockIdea.proposal.id });
  assert.equal(await stockFor(owner, thisBusiness, "ELMA"), remaining);
  assert.deepEqual((await owner.read(thisBusiness, "ai")).proposals, []);
});

test("AI taslağı hazırlayan yöneticide görünür ve yetki değişince onaylanamaz", async () => {
  const secret = "j".repeat(43);
  await owner.mutate(thisBusiness, "settings", "invite", { email: "teammate@example.test", role: "admin", secret });
  await teammate.post("/api/join", { token: secret });
  const { data: session } = await teammate.call("/api/auth/me");
  const before = await owner.read(thisBusiness, "finance");
  const { proposal } = await teammate.mutate(thisBusiness, "ai", "ask", {
    messages: [{ role: "user", content: "gider 25,50 kırtasiye" }]
  });
  assert.ok((await teammate.read(thisBusiness, "ai")).proposals.some(row => row.id === proposal.id));
  assert.ok(!(await owner.read(thisBusiness, "ai")).proposals.some(row => row.id === proposal.id));
  await owner.mutate(thisBusiness, "settings", "member", { userId: session.user.id, role: "member" });
  await teammate.mutate(thisBusiness, "ai", "apply", { id: proposal.id }, 403);
  assert.deepEqual((await owner.read(thisBusiness, "finance")).rows, before.rows);
});

test("giriş deneme sınırı ve yayın dosyalarının izin listesi", async () => {
  const client = new Client(pages.url);
  for (let attempt = 0; attempt < 5; attempt++) await client.login("absent@example.test", password, 401);
  await client.login("absent@example.test", password, 429);
  const responses = await Promise.all(["/terms.html", "/privacy.html", "/contact.html", "/forgot-password.html", "/join.html",
    "/migrations/0002_workspace.sql", "/functions/_lib/password.js", "/tests/api.test.mjs"].map((link) => fetch(client.base + link)));
  for (const [index, response] of responses.entries()) {
    if (index < 5) assert.equal(response.status, 200);
    else {
      const body = await response.text();
      assert.ok(!body.includes("CREATE TABLE") && !body.includes("function verifyPassword") && !body.includes("class Client"));
    }
  }
});

test("eşzamanlı kısmi iadeler, net tahsilat ve kalan satışın iptali", async () => {
  const { data } = await owner.post("/api/businesses", { name: "İade işlemleri" }, 201);
  const business = data.business.id;
  await saveProduct(owner, business, { sku: "A", opening: 10 });
  const secret = "h".repeat(43);
  await owner.mutate(business, "pos", "create", { name: "İade kasası", identityMode: "native", secret });
  const headers = { Authorization: `Bearer olvex_pos_${secret}` };
  const send = (body, status) => owner.post("/api/pos", body, status, { headers, cookie: false });
  const { data: original } = await send({ action: "sale", reference: "F-1", date: twoDaysAgo,
    paid: false, lines: [{ sku: "A", quantity: 10, unit: 123 }] }, 201);

  const returns = ["I-1", "I-2"].map((reference) => ({ action: "return", saleReference: "F-1",
    reference, date: yesterday, lines: [{ sku: "A", quantity: 6 }] }));
  const raced = await Promise.all(returns.map(async (body) => {
    const result = await fetch(pages.url + "/api/pos", { method: "POST",
      headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await result.text();
    return result.status;
  }));
  assert.deepEqual(raced.toSorted(), [201, 409]);
  assert.equal((await send(returns[raced.indexOf(201)], 200)).data.repeated, true);
  assert.equal(await stockFor(owner, business, "A"), 6);
  let report = (await owner.read(business, "reports")).totals;
  assert.equal(report.sales, 492);
  assert.equal(report.revenue, 0);
  assert.equal(report.spending, 0);
  await owner.mutate(business, "sales", "settle", { id: original.id, date: twoDaysAgo }, 409);
  await owner.mutate(business, "sales", "settle", { id: original.id, date: todayDate });

  const refund = { action: "return", saleReference: "F-1", reference: "I-3", date: todayDate,
    lines: [{ sku: "A", quantity: 1 }] };
  await send({ ...refund, lines: [...refund.lines, { sku: "Z", quantity: 1 }] }, 409);
  assert.equal(await stockFor(owner, business, "A"), 6);
  await send(refund, 201);
  assert.equal(await stockFor(owner, business, "A"), 7);
  await owner.mutate(business, "sales", "void", { id: original.id, date: todayDate });
  await send(refund, 200);
  assert.equal(await stockFor(owner, business, "A"), 10);
  report = (await owner.read(business, "reports")).totals;
  assert.deepEqual(report, { sales: 0, saleCount: 0, cost: 0, purchases: 0, revenue: 492, spending: 492 });
});

test("kasa bilgisi eksik eski CSV fişi doğrulanınca asıl satış ve ödemesi korunur", async () => {
  const { data: created } = await owner.post("/api/businesses", { name: "CSV Arşivi" }, 201);
  const business = created.business.id;
  const actor = (await owner.call("/api/auth/me")).data.user.id;
  const branch = (await owner.read(business, "locations")).rows[0].id;
  const product = await saveProduct(owner, business, { sku: "P", opening: 10 });
  const reference = "2019/43";
  const original = await stableId(JSON.stringify([business, "csv", "sale", reference]));
  const items = [{ sku: "P", quantity: 2, unit: 150 }];
  const fingerprint = await sha256(JSON.stringify({
    requestId: original, source: "csv", reference, occurredOn: yesterday, customerId: null,
    supplier: "", note: "", paidOn: yesterday, items
  }));
  await pages.query(`
    INSERT INTO olvex_operations(business_id, request_id, actor_id, action, fingerprint)
      VALUES ('${business}','${original}','${actor}','sale-create','${fingerprint}');
    INSERT INTO olvex_orders(business_id,id,kind,source,reference,occurred_on,paid_on,created_by,branch_id)
      VALUES ('${business}','${original}','sale','csv','2019/43','${yesterday}','${yesterday}','${actor}','${branch}');
    INSERT INTO olvex_order_items(business_id,id,order_id,product_id,product_sku,product_name,quantity,unit_minor,cost_minor)
      VALUES ('${business}','${id()}','${original}','${product.id}','P','Ürün',2,150,100);
  `);
  const cashRegister = (secret, name) => owner.mutate(business, "pos", "create", { identityMode: "native", name, secret });
  const first = await cashRegister("M".repeat(43), "İlk kasa");
  const second = await cashRegister("N".repeat(43), "İkinci kasa");
  const post = (key, body, status) => owner.post("/api/pos", body, status, {
    headers: { Authorization: `Bearer olvex_pos_${key.repeat(43)}` }, cookie: false
  });
  const receipt = { action: "sale", date: yesterday, reference, paid: true, lines: items };
  const reversed = { action: "return", date: todayDate, reference: "RET/43", saleReference: reference, lines: [{ sku: "P", quantity: 1 }] };
  const evidence = "Değişmez günlük 2019-03/43";
  await post("M", receipt, 409);
  await post("N", receipt, 409);
  await post("M", reversed, 409);
  await owner.mutate(business, "pos", "link-csv", { registerId: second.id, reference, decision: "distinct", evidence });
  await post("N", receipt, 201);
  await post("M", receipt, 409);
  await owner.mutate(business, "pos", "link-csv", { registerId: first.id, reference, decision: "same", evidence });
  const replay = await post("M", receipt, 200);
  assert.equal(replay.data.id, original);
  assert.equal(replay.data.repeated, true);
  assert.equal((await owner.mutate(business, "sales", "import", {
    registerId: first.id, reference, paid: true, date: yesterday, lines: items
  })).id, original);
  await post("M", { ...receipt, lines: [{ sku: "P", quantity: 1, unit: 300 }] }, 409);
  assert.equal(await stockFor(owner, business, "P"), 6);
  await post("M", reversed, 201);
  await post("M", reversed, 200);
  await post("M", { action: "void", reference, date: todayDate }, 200);
  await post("M", { action: "void", reference, date: todayDate }, 200);
  assert.equal(await stockFor(owner, business, "P"), 8);
  const [payments] = await pages.query(`SELECT kind,amount_minor FROM olvex_order_payments
    WHERE business_id='${business}' AND order_id='${original}' ORDER BY kind`);
  assert.deepEqual(payments, [{ kind: "payment", amount_minor: 300 },
    { kind: "refund", amount_minor: 150 }, { kind: "refund", amount_minor: 150 }]);
});
