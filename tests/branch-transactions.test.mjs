import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { passwordHash } from "../functions/_lib/password.js";
import { randomToken } from "../functions/_lib/session.js";
import { addDays, today } from "../functions/_lib/validate.js";
import { localPages } from "./local.mjs";

const uuid = () => crypto.randomUUID();
const business = uuid();
const otherBusiness = uuid();
const day = today();
const people = Object.fromEntries(["owner", "admin", "member", "outsider"].map(role => [role, { id: uuid(), role }]));
const secret = randomToken();
let pages, center, coast, outside;

async function http(path, body, headers) {
  const response = await fetch(pages.url + path, {
    method: body ? "POST" : "GET",
    headers: { Origin: pages.url, "Content-Type": "application/json", ...headers },
    ...(body && { body: JSON.stringify(body) })
  });
  return { status: response.status, data: await response.json(), headers: response.headers };
}

function api(person, section, body, tenant = business) {
  return http(`/api/workspace/${tenant}/${section}`, body && { requestId: uuid(), ...body }, { Cookie: person.cookie });
}

function ok(result, status = 200) {
  assert.equal(result.status, status, JSON.stringify(result.data));
  return result.data;
}

async function product(sku, centralStock, coastalStock = 0) {
  const { id } = ok(await api(people.owner, "products", {
    action: "save", name: sku, sku, price: 500, cost: 300, opening: centralStock, branchId: center
  }));
  if (coastalStock) ok(await api(people.owner, "stock", {
    action: "adjust", productId: id, branchId: coast, delta: coastalStock, note: "Sahil açılışı"
  }));
  return id;
}

async function balances(productId) {
  const scopes = [center, coast, null];
  return Promise.all(scopes.map(async branch => {
    const result = ok(await api(people.owner, branch ? "products?branchId=" + branch : "products"));
    return result.rows.find(row => row.id === productId).stock;
  }));
}

function manual(sku, quantity, branchId = coast) {
  return { action: "create", requestId: uuid(), date: day, branchId, lines: [{ sku, quantity }], paid: true };
}

function transfer(productId, quantity) {
  return { action: "create", requestId: uuid(), sourceBranchId: center, destinationBranchId: coast,
    productId, quantity, note: "Sahil için sevkiyat", date: addDays(day, -1) };
}

function receipt(sku, quantity) {
  return { action: "sale", reference: uuid(), date: day, lines: [{ sku, quantity, unit: 500 }], paid: true };
}
const posHeaders = { Authorization: "Bearer olvex_pos_" + secret };

before(async () => {
  const password = "OLVEX-yerel-entegrasyon";
  const hash = await passwordHash(password);
  const users = Object.values(people).map(({ id, role }) =>
    `('${id}','${role}@branches.test','${role}','${hash}')`);
  const members = Object.values(people).map(({ id, role }) =>
    `('${uuid()}','${role === "outsider" ? otherBusiness : business}','${id}','${role === "outsider" ? "owner" : role}')`);
  pages = await localPages({ seed: `
    INSERT INTO users(id,email,full_name,password_hash) VALUES ${users.join(",")};
    INSERT INTO businesses(id,name,created_by) VALUES
      ('${business}','Merkez işletme','${people.owner.id}'),('${otherBusiness}','Ayrı işletme','${people.outsider.id}');
    INSERT INTO business_members(id,business_id,user_id,role) VALUES ${members.join(",")};` });
  for (const person of Object.values(people)) {
    const session = await http("/api/auth/login", { email: person.role + "@branches.test", password });
    ok(session);
    person.cookie = session.headers.get("Set-Cookie").split(";")[0];
  }
  center = ok(await api(people.owner, "locations")).rows[0].id;
  coast = ok(await api(people.owner, "locations", { action: "create", name: "Sahil" })).id;
  outside = ok(await api(people.outsider, "locations", undefined, otherBusiness)).rows[0].id;
  ok(await api(people.admin, "pos", { action: "create", branchId: coast, name: "Sahil kasası", secret, identityMode: "native" }));
});
after(async () => { await pages?.close(); });

test("manuel satış, satın alma ve iptal özgün şubeyi kullanır", async () => {
  const cola = await product("KOLA", 100, 50);
  const sale = manual("KOLA", 3);
  const saved = ok(await api(people.member, "sales", sale));
  assert.deepEqual(await balances(cola), [100, 47, 147]);
  assert.equal(ok(await api(people.member, "sales", sale)).repeated, true);
  ok(await api(people.admin, "sales", { action: "void", id: saved.id, date: day }));
  assert.deepEqual(await balances(cola), [100, 50, 150]);
  const buy = { ...manual("KOLA", 7), supplier: "Tedarikçi" };
  const purchase = ok(await api(people.admin, "purchases", buy));
  assert.deepEqual(await balances(cola), [100, 57, 157]);
  ok(await api(people.owner, "purchases", { action: "void", id: purchase.id, date: day }));
  assert.deepEqual(await balances(cola), [100, 50, 150]);
  ok(await api(people.member, "sales", { ...sale, branchId: outside }), 404);
  ok(await api(people.member, "purchases", buy), 403);
  for (const [section, order] of [["sales", sale], ["purchases", buy]]) {
    const { branchId, ...unscoped } = order;
    ok(await api(people.owner, section, { ...unscoped, requestId: uuid() }), 409);
  }
  assert.deepEqual(await balances(cola), [100, 50, 150]);
});

test("tek şubede kaydedilmiş eski biçimli satış yeni şube açıldıktan sonra güvenle yinelenir", async () => {
  const legacy = (section, body) => api(people.outsider, section, body, otherBusiness);
  ok(await legacy("products", { action: "save", sku: "ESKI", name: "Eski ürün", price: 500, cost: 300, opening: 10 }));
  const order = { action: "create", requestId: uuid(), date: day, lines: [{ sku: "ESKI", quantity: 2 }], paid: true };
  const saved = ok(await legacy("sales", order));
  ok(await legacy("locations", { action: "create", name: "Yeni şube" }));
  const replay = ok(await legacy("sales", order));
  assert.equal(replay.id, saved.id);
  assert.equal(replay.repeated, true);
  ok(await legacy("sales", { ...order, requestId: uuid() }), 409);
  assert.equal(ok(await legacy("products")).rows[0].stock, 8);
});

test("transferin iki hareketi, tarihi, açıklaması ve aktörü korunur", async () => {
  const id = await product("SEVK", 100, 20);
  const movement = transfer(id, 30);
  const responses = await Promise.all([api(people.admin, "transfers", movement), api(people.admin, "transfers", movement)]);
  const [saved, duplicate] = responses.map(response => ok(response));
  assert.deepEqual([saved.repeated, duplicate.repeated].sort(), [false, true]);
  assert.equal(saved.id, duplicate.id);
  assert.deepEqual(await balances(id), [70, 50, 120]);
  ok(await api(people.admin, "transfers", { ...movement, quantity: 31 }), 409);

  const history = ok(await api(people.member, "transfers")).rows.filter(row => row.id === saved.id);
  assert.equal(history.length, 1);
  const [row] = history;
  assert.deepEqual([row.source_branch_id, row.destination_branch_id, row.product_id, row.quantity,
    row.sku, row.note, row.occurred_on, row.created_by, row.actor_name],
  [center, coast, id, 30, "SEVK", movement.note, movement.date, people.admin.id, "admin"]);
  assert.equal(row.destination_name, "Sahil");
  const [legs] = await pages.query(`SELECT branch_id, delta FROM olvex_stock_movements
    WHERE business_id='${business}' AND transfer_id='${saved.id}' ORDER BY delta`);
  assert.deepEqual(legs, [{ branch_id: center, delta: -30 }, { branch_id: coast, delta: 30 }]);

  ok(await api(people.owner, "transfers", { ...transfer(id, 1), destinationBranchId: center }), 400);
  ok(await api(people.owner, "transfers", transfer(id, 71)), 409);
  ok(await api(people.owner, "transfers", { ...transfer(id, 1), destinationBranchId: outside }), 404);
  const foreignProduct = ok(await api(people.outsider, "products", {
    action: "save", sku: "SEVK", name: "Sevk ürünü", price: 500, cost: 300, opening: 20, branchId: outside
  }, otherBusiness));
  ok(await api(people.owner, "transfers", transfer(foreignProduct.id, 1)), 400);
  ok(await api(people.member, "transfers", transfer(id, 1)), 403);
  ok(await api(people.outsider, "transfers", transfer(id, 1)), 404);
  assert.deepEqual(ok(await api(people.outsider, "transfers", undefined, otherBusiness)).rows, []);
  assert.equal(ok(await api(people.outsider, "products?q=SEVK", undefined, otherBusiness)).rows[0].stock, 20);
  assert.deepEqual(await balances(id), [70, 50, 120]);
});

test("aynı şubedeki manuel ve kasalı satış birlikte işlenir", async () => {
  const id = await product("ORTAK", 30, 10);
  const manualSale = manual("ORTAK", 2);
  const posSale = receipt("ORTAK", 3);
  const postBoth = () => Promise.all([api(people.member, "sales", manualSale), http("/api/pos", posSale, posHeaders)]);
  const [first, second] = await postBoth();
  assert.notEqual(ok(first).id, ok(second, 201).id);
  assert.deepEqual(await balances(id), [30, 5, 35]);
  for (const result of await postBoth()) assert.equal(ok(result).repeated, true);
  assert.deepEqual(await balances(id), [30, 5, 35]);
});

test("aynı stok için yarışan satış ve transferden yalnızca yeterli stoklu işlem tamamlanır", async () => {
  const id = await product("YARIS", 10, 2);
  const [sale, move] = await Promise.all([
    api(people.member, "sales", manual("YARIS", 8, center)),
    api(people.admin, "transfers", transfer(id, 8))
  ]);
  assert.deepEqual([sale.status, move.status].sort(), [200, 409]);
  const sold = sale.status === 200;
  assert.deepEqual(await balances(id), sold ? [2, 2, 4] : [2, 10, 12]);
  const history = ok(await api(people.admin, "transfers")).rows.filter(row => row.product_id === id);
  assert.equal(history.length, sold ? 0 : 1);
  const orders = ok(await api(people.admin, "sales?q=YARIS")).rows;
  assert.equal(orders.length, sold ? 1 : 0);
});

test("eşzamanlı iki farklı transfer stok aşımını ve çift hareketi önler", async () => {
  const id = await product("CIKIS", 10);
  const requests = [transfer(id, 8), transfer(id, 8)];
  const results = await Promise.all(requests.map(body => api(people.owner, "transfers", body)));
  assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
  const winner = results.findIndex(row => row.status === 200);
  assert.equal(ok(await api(people.owner, "transfers", requests[winner])).repeated, true);
  const history = ok(await api(people.admin, "transfers")).rows.filter(row => row.product_id === id);
  assert.equal(history.length, 1);
  assert.deepEqual(await balances(id), [2, 8, 10]);
});

test("başarılı POS yanıtı ağda kaybolduğunda tekrar stok ve tahsilatı korur", async () => {
  const id = await product("AG", 7, 10);
  const sale = receipt("AG", 2);
  // Drop the downstream connection only after the local Pages endpoint has committed and responded.
  const committed = Promise.withResolvers();
  const proxy = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const reply = await fetch(pages.url + "/api/pos", {
        method: "POST", headers: { Authorization: req.headers.authorization, "Content-Type": "application/json" },
        body: Buffer.concat(chunks)
      });
      committed.resolve({ status: reply.status, data: await reply.json() });
    } catch (error) {
      committed.reject(error);
    } finally {
      res.destroy();
    }
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  try {
    await assert.rejects(fetch(`http://127.0.0.1:${proxy.address().port}/api/pos`, {
      method: "POST", headers: { ...posHeaders, "Content-Type": "application/json" }, body: JSON.stringify(sale)
    }), /fetch failed/);
    const recorded = ok(await committed.promise, 201);
    const retried = ok(await http("/api/pos", sale, posHeaders));
    assert.equal(retried.id, recorded.id);
    assert.equal(retried.repeated, true);
    assert.deepEqual(await balances(id), [7, 8, 15]);
    const [payments, moves] = await pages.query(`
      SELECT kind, amount_minor FROM olvex_order_payments WHERE order_id='${recorded.id}';
      SELECT branch_id, delta FROM olvex_stock_movements WHERE order_id='${recorded.id}';
    `);
    assert.deepEqual(payments, [{ kind: "payment", amount_minor: 1000 }]);
    assert.deepEqual(moves, [{ branch_id: coast, delta: -2 }]);
  } finally {
    await new Promise(resolve => proxy.close(resolve));
  }
});
