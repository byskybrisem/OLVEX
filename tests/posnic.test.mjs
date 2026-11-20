import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig, origin } from "../integrations/posnic/config.mjs";
import { openConnector, runLoop } from "../integrations/posnic/connector.mjs";
import { returnBlocks, salePayload } from "../integrations/posnic/mapping.mjs";
import { webhookServer } from "../integrations/posnic/webhook.mjs";
import { randomToken, sha256 } from "../functions/_lib/session.js";
import { localPages } from "./local.mjs";

const id = (value) => value.toString(16).padStart(24, "0");
const license = id(900);
const sourceBranch = id(901);
const otherBranch = id(902);
const till = id(903);
const secondTill = id(904);
const opened = id(905);
const laterSession = id(906);
const secondSession = id(907);
const item = id(908);
const webhookSecret = randomBytes(24).toString("hex");
const posnicToken = `posnic_${randomBytes(24).toString("hex")}`;
const at = (day) => `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
});

function sale(value, patch = {}) {
  return {
    _id: id(value), branch_id: sourceBranch, license, cashregister_id: opened, sales_id: "FIS-1",
    date: at(2), updated_date: at(2), sale_process: "Add", payment_status: "Paid", sales_total: 15,
    items: [{ item_id: item, item_sku: "P", item_unit: "qty", item_quantity: 3, total_amount: 15 }],
    items_return: [], ...patch,
  };
}

async function listen(t, server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function fakePosnic(t) {
  const sales = new Map();
  const sessions = new Map([[opened, till], [laterSession, till], [secondSession, secondTill]]);
  const changes = [];
  const calls = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const reply = (status, body) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    calls.push([url.pathname, Object.fromEntries(url.searchParams)]);
    if (req.headers.authorization !== `Bearer ${posnicToken}` || req.headers["x-branch-id"] !== sourceBranch) return reply(401, {});
    if (url.pathname === "/api/v1/sales") {
      const cursor = Buffer.from(url.searchParams.get("cursor") ?? "", "base64url").toString();
      const limit = Number(url.searchParams.get("limit"));
      const key = (row) => `${row.updated_date}|${row._id}`;
      const all = [...sales.values()].sort((a, b) => key(a).localeCompare(key(b))).filter(row => key(row) > cursor);
      const data = all.slice(0, limit);
      const next_cursor = all.length > limit ? Buffer.from(key(data.at(-1))).toString("base64url") : null;
      return reply(200, { data, meta: { count: data.length, next_cursor } });
    }
    if (url.pathname.startsWith("/api/v1/sales/")) {
      const data = sales.get(url.pathname.split("/").at(-1));
      return data ? reply(200, { data }) : reply(404, { error: { code: "not_found" } });
    }
    if (url.pathname === "/api/registers/getCashRegister") {
      const _id = url.searchParams.get("id");
      const register_id = sessions.get(_id);
      return register_id ? reply(200, { type: "success", status: true, data: { _id, register_id } }) : reply(404, {});
    }
    if (url.pathname === "/api/sales/getDataChanges") {
      const from = url.searchParams.get("from") ?? "";
      return reply(200, { type: "success", status: true, data: changes.filter(row => row._id > from).slice(0, 100) });
    }
    return reply(404, {});
  });
  return { url: listen(t, server), sales, changes, calls };
}

test("sahte imza, değişen ham gövde, yanlış olay ve büyük yük webhook taraması başlatmaz", async t => {
  let wakes = 0;
  const url = await listen(t, webhookServer(webhookSecret, () => wakes++));
  const raw = JSON.stringify({ event: "change", entity: "sales", at: at(3), shop: "test" });
  const signature = (body) => "sha256=" + createHmac("sha256", webhookSecret).update(body).digest("hex");
  async function post(body, header = signature(body), delivery = id(22), event = "change") {
    return fetch(url + "/posnic/webhook", { method: "POST", body, headers: {
      "X-Posnic-Signature": header, "X-Posnic-Delivery": delivery, "X-Posnic-Event": event,
    } });
  }
  assert.equal((await post(raw, "sha256=" + "0".repeat(64))).status, 401);
  assert.equal((await post(raw + " ", signature(raw))).status, 401);
  assert.equal((await post(raw, undefined, "invalid")).status, 401);
  assert.equal((await post(raw, undefined, undefined, "items")).status, 401);
  assert.equal((await post(raw.replace("sales", "items"))).status, 400);
  assert.equal((await post(" ".repeat(4097))).status, 413);
  assert.equal(wakes, 0);
  assert.equal((await post(raw)).status, 204);
  assert.equal((await post(raw)).status, 204);
  assert.equal((await post(raw, undefined, id(23))).status, 204);
  assert.equal(wakes, 1);
  assert.throws(() => origin("http://192.168.1.5:3000"), /HTTPS/);
  assert.throws(() => origin("https://user:secret@example.test"), /origin/);
});

test("çalışan bağlayıcı bağlantı hatasını bekleyerek yeniden dener ve webhook ile uyanır", { timeout: 8000 }, async t => {
  const stop = new AbortController();
  t.after(() => stop.abort());
  let calls = 0;
  const errors = [];
  let recovered;
  const recovery = new Promise(resolve => { recovered = resolve; });
  const loop = runLoop({
    async sync() {
      calls++;
      if (calls === 1) throw new Error("Geçici bağlantı kesintisi");
      if (calls === 2) recovered();
      if (calls === 3) stop.abort();
    },
  }, stop.signal, error => errors.push(error));
  const url = await listen(t, webhookServer(webhookSecret, loop.requestSync));
  const running = loop.run();
  await recovery;
  const raw = JSON.stringify({ event: "change", entity: "sales", at: at(3), shop: "test" });
  const signature = "sha256=" + createHmac("sha256", webhookSecret).update(raw).digest("hex");
  const result = await fetch(url + "/posnic/webhook", { method: "POST", body: raw, headers: {
    "X-Posnic-Signature": signature, "X-Posnic-Delivery": id(43), "X-Posnic-Event": "change",
  } });
  assert.equal(result.status, 204);
  await running;
  assert.equal(calls, 3);
  assert.deepEqual(errors, ["Geçici bağlantı kesintisi"]);
});

test("satış tutarı, para birimi ve iade geçmişi kayıpsız eşleşmediğinde dönüşüm durur", () => {
  const unsupported = [
    [sale(1, { sales_total: 14 }), /satış toplamı/],
    [sale(1, { payment_status: "Partialy Paid" }), /ödeme durumu/],
    [sale(1, { items: [{ item_sku: "P", item_quantity: 0.5, total_amount: 15 }] }), /miktarı tam sayı/],
    [sale(1, { items: [{ item_sku: "P", item_quantity: 3, total_amount: 15,
      pricing: { currency: { currencyCode: "INR", currencyDigits: 2 } } }] }), /TRY/],
    [sale(1, { items_return: [{ returnArray: { returnObjId: id(33), returnDate: at(3), returnValue: [] } }] }),
      /iade öncesine ait/],
  ];
  for (const [entry, pattern] of unsupported) {
    assert.throws(() => salePayload(entry, returnBlocks(entry), formatter), pattern);
  }
});

test("Posnic HTTP → yerel bağlayıcı → Pages/D1: satış, iade, iptal ve kayıp onay uzlaştırması", async t => {
  const state = await mkdtemp(join(tmpdir(), "olvex-posnic-"));
  t.after(() => rm(state, { recursive: true, force: true }));
  const business = randomUUID(), branch = randomUUID(), owner = randomUUID();
  const register = randomUUID(), secondRegister = randomUUID();
  const token = randomToken(), secondToken = randomToken();
  const pages = await localPages({ professionalFixtures: true, seed: `
    INSERT INTO users(id,email) VALUES ('${owner}','posnic@example.test');
    INSERT INTO businesses(id,name,created_by) VALUES ('${business}','Posnic örnek işletme','${owner}');
    INSERT INTO olvex_branches(id,name,business_id) VALUES ('${branch}','Test şubesi','${business}');
    INSERT INTO olvex_pos_connections(id,business_id,branch_id,name,created_by,token_hash,identity_mode) VALUES
      ('${register}','${business}','${branch}','Kasa 1','${owner}','${await sha256(token)}','native'),
      ('${secondRegister}','${business}','${branch}','Kasa 2','${owner}','${await sha256(secondToken)}','native');
    INSERT INTO olvex_products(business_id,id,sku,name,price_minor,cost_minor) VALUES ('${business}','p','P','Ürün',500,250);
    INSERT INTO olvex_stock_movements(business_id,branch_id,id,product_id,kind,delta,created_by)
      VALUES ('${business}','${branch}','opening','p','opening',30,'${owner}');
  ` });
  t.after(pages.close);
  let loseAck = true;
  let proxyError;
  const proxy = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const result = await fetch(pages.url + req.url, {
        method: req.method, headers: { Authorization: req.headers.authorization, "Content-Type": "application/json" },
        body: Buffer.concat(chunks),
      });
      const body = await result.text();
      if (loseAck) {
        loseAck = false;
        assert.equal(result.status, 201);
        req.socket.destroy();
        return;
      }
      res.writeHead(result.status, { "Content-Type": "application/json" }).end(body);
    } catch (error) {
      proxyError = error;
      res.destroy();
    }
  });
  const posnic = fakePosnic(t);
  const file = join(state, "config.json");
  await writeFile(file, JSON.stringify({
    posnicOrigin: await posnic.url, olvexOrigin: await listen(t, proxy), posnicLicenseId: license,
    posnicBranchId: sourceBranch, olvexBusinessId: business, olvexBranchId: branch, startOn: "2026-09-01",
    timeZone: "Europe/Istanbul", currency: "TRY", statePath: join(state, "state.sqlite"), webhookPort: 9021,
    registers: [
      { posnicRegisterId: till, olvexRegisterId: register, tokenEnv: "OLVEX_POS_TOKEN_FIRST" },
      { posnicRegisterId: secondTill, olvexRegisterId: secondRegister, tokenEnv: "OLVEX_POS_TOKEN_SECOND" },
    ],
  }));
  const config = await loadConfig(file, {
    POSNIC_API_TOKEN: posnicToken, POSNIC_WEBHOOK_SECRET: webhookSecret,
    OLVEX_POS_TOKEN_FIRST: `olvex_pos_${token}`, OLVEX_POS_TOKEN_SECOND: `olvex_pos_${secondToken}`,
  });
  let connector = openConnector(config);
  t.after(() => connector.close());
  assert.throws(() => openConnector(config), /lock/i);

  async function totals(orders, returns, stock, payment, refund) {
    const [rows] = await pages.query(`SELECT
      (SELECT COUNT(*) FROM olvex_orders) AS orders,
      (SELECT COUNT(*) FROM olvex_returns) AS returns,
      (SELECT SUM(delta) FROM olvex_stock_movements WHERE branch_id = '${branch}') AS stock,
      (SELECT COALESCE(SUM(amount_minor),0) FROM olvex_order_payments WHERE kind='payment') AS payment,
      (SELECT COALESCE(SUM(amount_minor),0) FROM olvex_order_payments WHERE kind='refund') AS refund`);
    assert.deepEqual(rows, [{ orders, returns, stock, payment, refund }]);
  }

  for (let row = 1; row < 102; row++) {
    const outside = sale(row, { branch_id: otherBranch });
    posnic.sales.set(outside._id, outside);
  }
  const first = sale(102);
  const second = sale(103, { cashregister_id: secondSession });
  for (const receipt of [first, second]) posnic.sales.set(receipt._id, receipt);
  await assert.rejects(connector.sync(), /bağlantısı kurulamadı/);
  assert.equal(proxyError, undefined);
  await totals(1, 0, 27, 1500, 0);
  connector.close();
  connector = openConnector(config);
  await connector.sync();
  assert.ok(posnic.calls.some(([path, query]) => path === "/api/v1/sales" && query.cursor));
  await totals(2, 0, 24, 3000, 0);

  const partial = {
    returnObjId: id(801), returnDate: at(3), cashregister_id: secondSession,
    returnValue: [{ item_id: item, item_sku: "P", item_unit: "qty", item_quantity: 1 }], itemsTotalAmount: 5,
  };
  posnic.sales.set(first._id, {
    ...first, sale_process: "PartialReturn", updated_date: at(3),
    items: [{ ...first.items[0], item_quantity: 2, total_amount: 10 }],
    items_return: [{ returnArray: partial }],
  });
  const signalServer = webhookServer(webhookSecret, () => wakes++);
  let wakes = 0;
  const webhookUrl = await listen(t, signalServer);
  const signal = JSON.stringify({ event: "change", entity: "sales", at: at(3), shop: "test" });
  const signature = "sha256=" + createHmac("sha256", webhookSecret).update(signal).digest("hex");
  for (let i = 0; i < 2; i++) {
    assert.equal((await fetch(webhookUrl + "/posnic/webhook", { method: "POST", body: signal, headers: {
      "X-Posnic-Signature": signature, "X-Posnic-Delivery": id(808), "X-Posnic-Event": "change",
    } })).status, 204);
    if (wakes > i) await connector.sync();
  }
  assert.equal(wakes, 1);
  await totals(2, 1, 25, 3000, 500);

  // Hard deletes found during polling require both a same-branch log and the
  // v1 not_found response. Neither a missing sale nor a logged attempt alone suffices.
  const log = (key, saleId, branchId, day) => ({
    _id: id(key), operation: "delete", module: "sales",
    license, branch_id: branchId, docId: saleId, time: at(day),
  });
  posnic.changes.push(log(810, first._id, sourceBranch, 5), log(811, second._id, otherBranch, 5));
  posnic.sales.delete(second._id);
  await connector.sync();
  await totals(2, 1, 25, 3000, 500);
  posnic.changes.push(log(812, second._id, sourceBranch, 5));
  await connector.sync();
  await totals(2, 1, 28, 3000, 2000);

  // A historical FullReturn, absent from the incremental cursor, is rebuilt
  // from its source snapshot. A new session maps back to the same physical till.
  const historic = sale(800, {
    cashregister_id: laterSession, updated_date: at(2), sale_process: "FullReturn", items: [],
    items_return: [{ returnArray: { ...partial, returnObjId: id(804), itemsTotalAmount: 15,
      returnValue: [{ ...partial.returnValue[0], item_quantity: 3 }] } }],
    business_item_origin: {
      schemaVersion: 1, saleId: id(800), branchId: sourceBranch, businessId: license, invoiceDate: at(2),
      salesTotal: "15", lines: [{ itemId: item, unit: "qty", quantity: "3", grossAmount: "15" }],
    },
  });
  posnic.sales.set(historic._id, historic);
  await connector.sync();
  await totals(2, 1, 28, 3000, 2000);
  connector.reconcile();
  await connector.sync();
  await connector.sync();
  await totals(3, 2, 28, 4500, 3500);

  const [records] = await pages.query(`SELECT source_key, reference, status FROM olvex_orders ORDER BY reference`);
  assert.deepEqual(records, [
    { source_key: register, reference: `posnic:${first._id}`, status: "posted" },
    { source_key: secondRegister, reference: `posnic:${second._id}`, status: "void" },
    { source_key: register, reference: `posnic:${historic._id}`, status: "posted" },
  ]);
  const [refundOwner] = await pages.query(`SELECT r.register_id, o.reference FROM olvex_returns r
    JOIN olvex_orders o ON r.order_id = o.id AND r.business_id = o.business_id
    WHERE r.reference = 'posnic:${partial.returnObjId}'`);
  assert.deepEqual(refundOwner, [{ register_id: register, reference: `posnic:${first._id}` }]);

  // A retained cancellation reverses only the remainder of the original sale.
  posnic.sales.set(first._id, { ...posnic.sales.get(first._id), status: "cancelled", updated_date: at(6) });
  await connector.sync();
  connector.reconcile();
  await connector.sync();
  await totals(3, 2, 30, 4500, 4500);
});
