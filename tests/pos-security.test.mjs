import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomToken, sha256 } from "../functions/_lib/session.js";
import { today } from "../functions/_lib/validate.js";
import { localPages } from "./local.mjs";

const business = crypto.randomUUID();
const branch = crypto.randomUUID();
const owner = crypto.randomUUID();
const register = crypto.randomUUID();
const secret = randomToken();
const session = randomToken();
let pages;

before(async () => {
  pages = await localPages({ professionalFixtures: true, bindings: { OLVEX_POS_REQUESTS_PER_MINUTE: "2" }, seed: `
    INSERT INTO users(id,email) VALUES ('${owner}','security@example.test');
    INSERT INTO businesses(id,name,created_by) VALUES ('${business}','Test işletmesi','${owner}');
    INSERT INTO business_members(id,business_id,user_id,role) VALUES ('m','${business}','${owner}','owner');
    INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES
      ('s','${owner}','${await sha256(session)}','2099-01-01T00:00:00.000Z');
    INSERT INTO olvex_branches(id,name,business_id) VALUES ('${branch}','Sahil','${business}');
    INSERT INTO olvex_pos_connections(id,business_id,branch_id,name,created_by,token_hash,identity_mode) VALUES
      ('${register}','${business}','${branch}','Test kasası','${owner}','${await sha256(secret)}','native');
    INSERT INTO olvex_products(business_id,id,sku,name,price_minor,cost_minor) VALUES ('${business}','p','P','Ürün',150,75);
    INSERT INTO olvex_stock_movements(business_id,branch_id,id,product_id,kind,delta,created_by)
      VALUES ('${business}','${branch}','opening','p','opening',9,'${owner}');
  ` });
});
after(async () => { await pages?.close(); });

async function send(path, body, headers = {}) {
  return fetch(pages.url + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

test("oturumlu işlemlerde rol, işletme, Origin ve alan türleri sunucuda doğrulanır", async () => {
  const path = `/api/workspace/${business}/sales`;
  const headers = { Cookie: `olvex_session=${session}`, Origin: pages.url };
  const sale = { action: "create", requestId: crypto.randomUUID(), branchId: branch,
    date: today(), paid: true, lines: [{ sku: "P", quantity: 1 }] };
  assert.equal((await send(path, sale, { Origin: pages.url })).status, 401);
  assert.equal((await send(path, sale, { ...headers, Origin: "https://other.example" })).status, 403);
  assert.equal((await send(path, { ...sale, businessId: crypto.randomUUID() }, headers)).status, 403);
  assert.equal((await send(path, { ...sale, paid: "true" }, headers)).status, 400);
  assert.equal((await send(path, { ...sale, action: ["create"] }, headers)).status, 400);
  const valid = await send(path, sale, headers);
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).repeated, false);
});

test("kasa hız sınırından sonra aynı fiş yeniden gönderilebilir ve anahtarlar yanıt gövdesine girmez", async () => {
  const headers = { Authorization: `Bearer olvex_pos_${secret}` };
  const receipt = { action: "sale", reference: "FIS-1", date: today(), paid: true,
    lines: [{ sku: "P", quantity: 1, unit: 150 }] };
  const first = await send("/api/pos", receipt, headers);
  assert.equal(first.status, 201);
  const { id } = await first.json();
  const replay = await send("/api/pos", receipt, headers);
  assert.equal((await replay.json()).id, id);
  const deferred = await send("/api/pos", receipt, headers);
  assert.equal(deferred.status, 429);
  assert.equal(deferred.headers.get("Retry-After"), "60");
  const key = await sha256(`pos-register:${business}:${register}`);
  await pages.query(`UPDATE auth_rate_limits SET window_started_at = window_started_at - 61 WHERE key_hash = '${key}'`);
  const accepted = await send("/api/pos", receipt, headers);
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { success: true, id, repeated: true });
  const list = await fetch(pages.url + `/api/workspace/${business}/pos`, { headers: { Cookie: `olvex_session=${session}` } });
  assert.equal(list.status, 200);
  assert.equal(list.headers.get("cache-control"), "no-store");
  const serialized = await list.text();
  for (const value of [secret, await sha256(secret), session, "token_hash"]) assert.ok(!serialized.includes(value));
  const [records] = await pages.query(`SELECT (SELECT COUNT(*) FROM olvex_orders WHERE id='${id}') AS orders,
    (SELECT COUNT(*) FROM olvex_stock_movements WHERE order_id='${id}') AS movements,
    (SELECT COUNT(*) FROM olvex_order_payments WHERE order_id='${id}') AS payments`);
  assert.deepEqual(records, [{ orders: 1, movements: 1, payments: 1 }]);
});

test("başarısız kasa kimlik doğrulamalarına ortak deneme sınırı uygulanır", async () => {
  // Fill only our local fixture's window. A valid register remains subject to an active IP block.
  const failure = await send("/api/pos", {}, {});
  assert.equal(failure.status, 401);
  const registerKey = await sha256(`pos-register:${business}:${register}`);
  await pages.query(`UPDATE auth_rate_limits SET attempts=20, window_started_at=unixepoch() WHERE key_hash <> '${registerKey}'`);
  const blocked = await send("/api/pos", {}, { Authorization: `Bearer olvex_pos_${secret}` });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("Retry-After"), "60");
});
