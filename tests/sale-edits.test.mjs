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
  server = await localPages({ professionalFixtures: true, seed });
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
  await api("sales", {action:"void", id:saleId, date:day, revision:1, expectedPaidOn:null}, {status:409});
  await api("sales", {action:"void", id:saleId, date:day, revision:1, expectedPaidOn:day});
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
  const {id: registerId} = await api("pos", {action:"create", identityMode:"native", name:"Düzeltme kasası", secret:"k".repeat(43)});
  const imported = await api("sales", {action:"import", registerId, date:day, paid:false, reference:"CSV-COR", lines:[{sku:"TAHSIL",quantity:1,unit:1500}]});
  await api("sales", {...correction, id:imported.id}, {status:409});
});

test("manuel satış düzeltmesi, tahsilat ve iptal yalnızca satışın şubesindeki stoku kullanır", async () => {
  const {id: branchId} = await api("locations", {action:"create", name:"Kadıköy"});
  const {id: productId} = await api("products", {action:"save", sku:"SUBE", name:"Şube ürünü", price:1200, cost:500, opening:10});
  await api("stock", {action:"adjust", productId, branchId, delta:4, note:"Teslimat"});
  const {id: orderId} = await api("sales", {action:"create", branchId, date:day, lines:[{sku:"SUBE", quantity:2}]});
  const order = async () => (await api("sales?q=SUBE")).rows.find(row => row.id === orderId);
  const row = await order();
  assert.equal(row.branch_name, "Kadıköy");
  const [item] = JSON.parse(row.items_json);
  const change = quantity => ({action:"edit", id:orderId, revision:row.revision, note:"", reference:"", reason:"Sayım",
    lines:[{id:item.id, quantity, unit:item.unit}]});
  const balances = async () => {
    const {rows:[stock]} = await api("products?q=SUBE&branchId=" + branchId);
    return [stock.stock, stock.total_stock];
  };
  await api("sales", change(5), {status:409});
  assert.deepEqual(await balances(), [2,12]);
  assert.equal((await order()).revision, 0);
  await api("sales", change(3));
  assert.deepEqual(await balances(), [1,11]);
  await api("sales", {action:"settle", id:orderId, date:day, revision:1});
  const cancel = {action:"void", requestId:id(), id:orderId, date:day, expectedPaidOn:day, revision:1};
  await api("sales", cancel);
  assert.equal((await api("sales", cancel)).repeated, true);
  assert.deepEqual(await balances(), [4,14]);
});

test("kasadan iade, ekrandaki önceki tahsilat ve iptal onaylarını geçersiz kılar", async () => {
  const {id: branchId} = await api("locations", {action:"create", name:"İade şubesi"});
  const secret = "z".repeat(43);
  const {id: registerId} = await api("pos", {action:"create", branchId, identityMode:"native", name:"İade", secret});
  await api("products", {action:"save", branchId, sku:"IADE", name:"İade ürünü", price:1200, cost:500, opening:5});
  const {id: orderId} = await api("sales", {action:"import", registerId, date:day, reference:"PR6-1",
    lines:[{sku:"IADE", quantity:5, unit:1200}]});
  for (const revision of [0,1]) {
    const refund = {action:"return", saleReference:"PR6-1", reference:"R-" + revision, date:day, lines:[{sku:"IADE", quantity:1}]};
    const send = () => fetch(server.url + "/api/pos", {method:"POST", headers:{"Content-Type":"application/json",
      Authorization:"Bearer olvex_pos_" + secret}, body:JSON.stringify(refund)});
    assert.equal((await send()).status, 201);
    assert.equal((await (await send()).json()).repeated, true);
    const {rows:[row]} = await api("sales?q=PR6-1");
    assert.equal(row.revision, revision + 1);
    assert.equal(row.total_minor, (4 - revision) * 1200);
    assert.equal(row.can_link_csv, 0);
    const action = revision ? "void" : "settle";
    await api("sales", {action, id:orderId, revision, date:day}, {status:409});
    await api("sales", {action, id:orderId, revision:revision+1, date:day});
  }
  const {rows:[product]} = await api("products?q=IADE&branchId=" + branchId);
  assert.equal(product.stock, 5);
});

test("0007 mevcut manuel satış, alış ve eski iptal hareketlerini korur", () => {
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
    for (const file of ["0003_branch_inventory.sql", "0004_returns_and_payments.sql", "0005_pos_identity.sql", "0006_legacy_csv_registers.sql"]) migrate(file);
    const before = movements();
    migrate("0007_sale_edits.sql");
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
