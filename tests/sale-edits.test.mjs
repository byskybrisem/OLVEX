import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { localPages } from "./local.mjs";
import { passwordHash } from "../functions/_lib/password.js";
import { today } from "../functions/_lib/validate.js";

const id = () => crypto.randomUUID();
const business = id();
const second = id();
const cookies = {};
let server;
const day = today();

before(async () => {
  const password = "Edited-sale-2026";
  const hash = await passwordHash(password);
  const people = ["owner", "member", "other"].map(role => ({role, id: id()}));
  const seed = people.map(user => `INSERT INTO users(id,email,full_name,password_hash) VALUES
    ('${user.id}','${user.role}@example.test','${user.role}','${hash}');`).join("\n") +
    `INSERT INTO businesses(id,name,created_by) VALUES ('${business}','Mağaza','${people[0].id}'),
      ('${second}','Şube','${people[2].id}');` +
    people.map(user => `INSERT INTO business_members(id,business_id,user_id,role) VALUES
      ('${id()}','${user.role === "other" ? second : business}','${user.id}','${user.role === "member" ? "member" : "owner"}');`).join("\n");
  server = await localPages({ seed });
  for (const user of people) {
    const res = await fetch(server.url + "/api/auth/login", { method: "POST",
      headers: {"Content-Type": "application/json", Origin: server.url},
      body: JSON.stringify({email: user.role + "@example.test", password}) });
    assert.equal(res.status, 200);
    cookies[user.role] = res.headers.get("set-cookie").split(";")[0];
  }
});
after(() => server?.close());

async function api(section, body, {status = 200, role = "owner", tenant = business} = {}) {
  const res = await fetch(server.url + "/api/workspace/" + tenant + "/" + section, {
    method: body ? "POST" : "GET",
    headers: { Origin: server.url, "Content-Type": "application/json", Cookie: cookies[role] },
    ...(body ? {body: JSON.stringify({requestId: id(), ...body})} : {})
  });
  const reply = await res.json();
  assert.equal(res.status, status, JSON.stringify(reply));
  return reply;
}

async function fixture(code, paid = false) {
  await api("products", {action:"save", sku:code, name:code, price:1500, cost:800, opening:10});
  const {id: saleId} = await api("sales", {action:"create", date:day, paid, lines:[{sku:code, quantity:2}]});
  const current = async () => (await api("sales?q=" + code)).rows.find(row => row.id === saleId);
  const stock = async () => (await api("products?q=" + code)).rows[0].stock;
  const row = await current();
  const [line] = JSON.parse(row.items_json);
  const edit = {action:"edit", id:saleId, revision:0, reason:"Fiş düzeltmesi", reference:"", note:"", lines:[]};
  return {saleId, current, line, stock, edit};
}

test("açık satışı düzeltme, tarihçe, maliyet ve iptal stoğu aynı işlemde tutarlı", async () => {
  const {saleId, current, line, stock, edit} = await fixture("FIYAT");
  const report = async () => (await api("reports?from=" + day + "&to=" + day)).totals;
  const before = await report();
  const body = {...edit, requestId:id(), reference:"D-1", note:"Düzeltildi", lines:[{id:line.id, quantity:4, unit:1600}]};
  await api("sales", body);
  assert.equal((await api("sales", body)).repeated, true);
  await api("sales", {...body, note:"Başka"}, {status:409});
  const row = await current();
  assert.equal(row.total_minor, 6400);
  assert.equal(row.revision, 1);
  assert.equal(await stock(), 6);
  const after = await report();
  assert.equal(after.sales - before.sales, 3400);
  assert.equal(after.cost - before.cost, 1600);
  assert.equal(after.revenue, before.revenue);
  const [audit] = (await api("sale-edits?id=" + saleId)).rows;
  assert.equal(audit.reason, body.reason);
  assert.equal(audit.actor, "owner");
  assert.equal(audit.old_note, "");
  assert.equal(audit.new_note, body.note);
  assert.deepEqual(JSON.parse(audit.line_changes), [{sku:"FIYAT",oldQuantity:2,newQuantity:4,oldUnit:1500,newUnit:1600}]);
  await api("sales", {action:"settle", id:saleId, date:day, revision:0}, {status:409});
  await api("sales", {action:"settle", id:saleId, date:day, revision:1});
  assert.equal((await report()).revenue - before.revenue, 6400);
  await api("sales", {action:"void", id:saleId, date:day, revision:0}, {status:409});
  await api("sales", {action:"void", id:saleId, date:day, revision:1});
  assert.equal(await stock(), 10);
  assert.equal((await report()).spending - before.spending, 6400);
  await api("sales", {...edit, revision:1, note:"İptal"}, {status:409});
});

test("negatif stok, yanlış satır ve çakışan düzeltmelerde tutarlılık", async () => {
  const {saleId, current, line, stock, edit} = await fixture("SAYIM");
  const change = (quantity, lineId = line.id) => ({...edit, lines:[{id:lineId, quantity, unit:1500}]});
  await api("sales", change(22), {status:409});
  await api("sales", change(1, id()), {status:409});
  assert.equal((await api("sale-edits?id=" + saleId)).rows.length, 0);
  assert.equal((await current()).revision, 0);
  assert.equal(await stock(), 8);
  const send = quantity => fetch(server.url + "/api/workspace/" + business + "/sales", {method:"POST",
    headers: {Origin:server.url, "Content-Type":"application/json", Cookie:cookies.owner},
    body:JSON.stringify({...change(quantity), requestId:id()})});
  const attempts = await Promise.all([send(3), send(1)]);
  assert.deepEqual(attempts.map(res => res.status).sort(), [200,409]);
  const row = await current();
  assert.equal(row.revision, 1);
  assert.equal(await stock(), 10 - JSON.parse(row.items_json)[0].quantity);
  assert.equal((await api("sale-edits?id=" + saleId)).rows.length, 1);
});

test("tahsil edilmiş manuel satışın notu düzenlenebilir, parasal ve harici satış korunur", async () => {
  const {current, line, stock, edit} = await fixture("TAHSIL", true);
  const correction = {...edit, note:"Teslim edildi"};
  await api("sales", correction, {role:"member", status:403});
  await api("sale-edits?id=" + edit.id, null, {role:"member", status:403});
  await api("sales", correction, {role:"other", status:404});
  await api("sales", correction, {role:"other", tenant:second, status:409});
  assert.deepEqual((await api("sale-edits?id=" + edit.id, null, {role:"other", tenant:second})).rows, []);
  await api("sales", {...correction, lines:[{id:line.id, quantity:1, unit:2000}]}, {status:409});
  await api("sales", correction);
  assert.equal((await current()).total_minor, 3000);
  assert.equal((await current()).note, correction.note);
  assert.equal(await stock(), 8);
  const imported = await api("sales", {action:"import", date:day, paid:false, reference:"CSV-COR", lines:[{sku:"TAHSIL",quantity:1,unit:1500}]});
  await api("sales", {...correction, id:imported.id}, {status:409});
});

test("0003 mevcut manuel satış, alış ve eski iptal hareketlerini korur", () => {
  const db = new DatabaseSync(":memory:");
  const migrate = file => db.exec(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
  try {
    db.exec("PRAGMA foreign_keys = ON");
    migrate("0001_auth.sql");
    migrate("0002_workspace.sql");
    db.exec(`INSERT INTO users(id,email) VALUES ('u','seed@example.test');
      INSERT INTO businesses(id,name,created_by) VALUES ('b','Örnek','u');
      INSERT INTO olvex_products(business_id,id,sku,name,price_minor,cost_minor)
        VALUES ('b','p','A1','Eski ürün',1500,500);
      INSERT INTO olvex_stock_movements(business_id,id,product_id,kind,delta,created_by)
        VALUES ('b','opening','p','opening',10,'u');`);
    const addOrder = (key, kind, quantity) => {
      db.prepare(`INSERT INTO olvex_orders(business_id,id,kind,source,occurred_on,created_by)
        VALUES ('b',?,?,'manual','2026-01-01','u')`).run(key, kind);
      db.prepare(`INSERT INTO olvex_order_items(business_id,id,order_id,product_id,product_sku,product_name,quantity,unit_minor,cost_minor)
        VALUES ('b',?,?,'p','A1','Eski ürün',?,1500,500)`).run(key + "-line", key, quantity);
    };
    const voidOrder = key => db.prepare("UPDATE olvex_orders SET status='void', voided_by='u', voided_on='2026-01-02' WHERE id=?").run(key);
    addOrder("sale", "sale", 2);
    addOrder("buy", "purchase", 5);
    addOrder("old", "sale", 1);
    voidOrder("old");
    const movements = () => db.prepare("SELECT * FROM olvex_stock_movements ORDER BY id").all();
    const stock = () => db.prepare("SELECT stock FROM olvex_products").get().stock;
    const before = movements();
    migrate("0003_sale_edits.sql");
    assert.deepEqual(movements(), before);
    assert.equal(stock(), 13);
    assert.ok(db.prepare("SELECT revision FROM olvex_orders").all().every(row => row.revision === 0));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM olvex_sale_edits").get().n, 0);
    voidOrder("sale");
    voidOrder("buy");
    assert.equal(stock(), 10);
    assert.equal(movements().length, before.length + 2);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});
