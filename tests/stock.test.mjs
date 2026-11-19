import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { localPages } from "./local.mjs";
import { parseSalesCsv } from "../assets/csv.js";

const baseline = readFileSync(new URL("../migrations/0001_auth.sql", import.meta.url), "utf8");
const migrationDir = new URL("../migrations/", import.meta.url);
const workspaceFiles = readdirSync(migrationDir).filter(name => name.endsWith(".sql") && name > "0001_auth.sql").sort();
const workspaceMigrations = workspaceFiles.map(name => readFileSync(new URL(name, migrationDir), "utf8"));

test("mevcut D1 kullanıcıları, işletme üyelikleri ve oturumları korunur", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(baseline.split("CREATE TABLE IF NOT EXISTS olvex_terms_acceptances")[0]);
    db.exec(`INSERT INTO users(id,email,full_name,password_hash) VALUES
      ('eski','eski@example.test','Eski Kullanıcı','legacy-hash');
      INSERT INTO businesses(id,name,created_by) VALUES ('merkez','Eski İşletme','eski');
      INSERT INTO business_members(id,business_id,user_id,role) VALUES ('m','merkez','eski','owner');
      INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES ('s','eski','token','2099-01-01T00:00:00.000Z');`);
    db.exec(baseline);
    for (const migration of workspaceMigrations) db.exec(migration);
    const old = db.prepare(`SELECT b.name, m.role, u.password_hash, s.token_hash FROM businesses b
      JOIN business_members m ON b.id = m.business_id JOIN users u ON u.id = m.user_id
      JOIN user_sessions s ON u.id = s.user_id`).get();
    assert.deepEqual({ ...old }, { name: "Eski İşletme", role: "owner", password_hash: "legacy-hash", token_hash: "token" });
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("şube geçişinde eski POS satışları, iptalleri, ödemeleri ve tekrar gönderimleri korunur", async (t) => {
  const register = "6dfea2ae-06bf-4932-86a5-ea7287016358";
  const sale = "5243e66c-5b0e-4598-87ca-951699299ada";
  const cancelled = "a7dff71c-367b-494e-8f7e-bb070e7c41e6";
  const voidId = "e2b0f906-2151-41f7-8b25-86a733530630";
  // Fixed IDs and fingerprints use the pre-branch API's canonical request format.
  const pages = await localPages({ legacyWorkspaceSeed: `
    INSERT INTO users(id,email) VALUES ('u','eski@example.test');
    INSERT INTO businesses(id,name,created_by) VALUES ('merkez','Merkez','u');
    INSERT INTO business_members(id,business_id,user_id,role) VALUES ('m','merkez','u','owner');
    INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES
      ('s','u','dd01ccb4e2d05989774904314986a43df0154b1dc1e48f52d85e19bcfd74ab0d','2099-01-01T00:00:00.000Z');
    INSERT INTO olvex_pos_connections(business_id,id,name,created_by,token_hash) VALUES
      ('merkez','${register}','Kasa A','u','cc0b1c2c66f3bb9fd1a081c626ba1bef62f6f96441a43be15268523776ac26a1');
    INSERT INTO olvex_products(business_id,id,sku,name,price_minor,cost_minor)
      VALUES ('merkez','p','KAHVE','Kahve',1250,500);
    INSERT INTO olvex_stock_movements(business_id,id,product_id,kind,delta,created_by)
      VALUES ('merkez','opening','p','opening',20,'u');
    INSERT INTO olvex_orders(business_id,id,kind,source,source_key,reference,occurred_on,paid_on,created_by) VALUES
      ('merkez','${sale}','sale','pos','${register}','FIS-41','2026-01-10','2026-01-10','u'),
      ('merkez','${cancelled}','sale','pos','${register}','FIS-42','2026-01-10','2026-01-10','u');
    INSERT INTO olvex_order_items(business_id,id,order_id,product_id,product_sku,product_name,quantity,unit_minor,cost_minor) VALUES
      ('merkez','l1','${sale}','p','KAHVE','Kahve',2,1250,500),
      ('merkez','l2','${cancelled}','p','KAHVE','Kahve',3,1250,500);
    UPDATE olvex_orders SET status='void',voided_by='u',voided_on='2026-01-11' WHERE id='${cancelled}';
    INSERT INTO olvex_operations(business_id,actor_id,action,request_id,fingerprint) VALUES
      ('merkez','u','sale-create','${sale}','7aa587fab20410b197501f2688d6756473d3937b65888f50ad24039ec496f4ce'),
      ('merkez','u','sale-create','${cancelled}','fbb5e808822740f7afb36fd7ef8b996a344dbadbad768330c5c6e75517357b11'),
      ('merkez','u','sale-void','${voidId}','7a79919e9a3ba23f9518c371c719506a90d1f9d699115a74558a89533bdbe9d4');
  ` });
  t.after(pages.close);
  const headers = { Cookie: `olvex_session=${"y".repeat(43)}` };
  const session = await fetch(pages.url + "/api/auth/me", { headers });
  assert.equal((await session.json()).user.id, "u");
  const post = async (path, payload, credentials, status) => {
    const res = await fetch(pages.url + path, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: pages.url, ...credentials },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    assert.equal(res.status, status, JSON.stringify(result));
    return result;
  };
  const token = { Authorization: `Bearer olvex_pos_${"x".repeat(43)}` };
  const receipt = { action: "sale", reference: "FIS-41", date: "2026-01-10", paid: true,
    lines: [{ sku: "KAHVE", quantity: 2, unit: 1250 }] };
  await post("/api/pos", receipt, token, 409);
  await post("/api/workspace/merkez/pos", {
    action: "identity", requestId: crypto.randomUUID(), id: register, identityMode: "native"
  }, headers, 200);
  assert.deepEqual(await post("/api/pos", receipt, token, 200), { success: true, id: sale, repeated: true });
  await post("/api/pos", { ...receipt, lines: [{ sku: "KAHVE", quantity: 5, unit: 1250 }] }, token, 409);
  assert.deepEqual(await post("/api/pos", { action: "void", reference: "FIS-42", date: "2026-01-11" }, token, 200),
    { success: true, id: voidId, repeated: true });

  const [stocks, orders, history, payments, events, violations] = await pages.query(`
    SELECT s.stock AS branch, p.stock AS total FROM olvex_branch_stock s
      JOIN olvex_products p ON (p.business_id, p.id) = (s.business_id, s.product_id)
      JOIN olvex_branches b ON b.id = s.branch_id WHERE b.is_default = 1 AND b.business_id = 'merkez';
    SELECT o.id,o.reference,o.status FROM olvex_orders o JOIN olvex_pos_connections c
      ON (o.business_id, o.branch_id, o.source_key) = (c.business_id, c.branch_id, c.id)
      WHERE c.id = '${register}' ORDER BY o.reference;
    SELECT m.id,m.delta FROM olvex_stock_movements m JOIN olvex_branches b ON m.branch_id=b.id
      WHERE b.business_id='merkez' AND b.is_default=1 ORDER BY m.id;
    SELECT order_id,kind,amount_minor,occurred_on FROM olvex_order_payments ORDER BY occurred_on,order_id;
    SELECT occurred_on,SUM(quantity*unit_minor) AS sales FROM olvex_order_events GROUP BY occurred_on ORDER BY occurred_on;
    PRAGMA foreign_key_check;`);
  assert.deepEqual(stocks, [{ branch: 18, total: 18 }]);
  assert.deepEqual(orders, [{ id: sale, reference: "FIS-41", status: "posted" }, { id: cancelled, reference: "FIS-42", status: "void" }]);
  assert.deepEqual(history, [{ id: "l1", delta: -2 }, { id: "l2", delta: -3 }, { id: "opening", delta: 20 }, { id: "void:l2", delta: 3 }]);
  assert.deepEqual(payments, [
    { order_id: sale, kind: "payment", amount_minor: 2500, occurred_on: "2026-01-10" },
    { order_id: cancelled, kind: "payment", amount_minor: 3750, occurred_on: "2026-01-10" },
    { order_id: cancelled, kind: "refund", amount_minor: 3750, occurred_on: "2026-01-11" }
  ]);
  assert.deepEqual(events, [{ occurred_on: "2026-01-10", sales: 6250 }, { occurred_on: "2026-01-11", sales: -3750 }]);
  assert.deepEqual(violations, []);
});

test("10.000 stok işleminde bakiye, işletme sınırı ve hareket kaydı tutarlılığı", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(baseline);
    for (const migration of workspaceMigrations) db.exec(migration);
    db.exec(`INSERT INTO users(id,email) VALUES ('u','seed@example.test');
      INSERT INTO businesses(id,name,created_by) VALUES ('ana','Merkez','u'),('yan','Yan Şube','u');
      INSERT INTO olvex_products (business_id,id,sku,name,price_minor,cost_minor) VALUES
        ('ana','p1','P-1','Ürün 1',12550,7250),('ana','p2','P-2','Ürün 2',2599,1200),('yan','p1','P-1','Başka şube',9900,1000);`);
    const mainBranch = db.prepare("SELECT id FROM olvex_branches WHERE business_id = 'ana' AND is_default = 1").get().id;
    const movement = db.prepare(`INSERT INTO olvex_stock_movements
      (branch_id,business_id,id,product_id,kind,delta,created_by) VALUES (?,'ana',?,?,?,?,'u')`);
    const order = db.prepare(`INSERT INTO olvex_orders (branch_id,business_id,id,kind,source,occurred_on,created_by)
      VALUES (?,'ana',?,?,'manual','2026-11-17','u')`);
    const item = db.prepare(`INSERT INTO olvex_order_items
      (business_id,id,order_id,product_id,product_sku,product_name,quantity,unit_minor,cost_minor)
      VALUES ('ana',?,?,?,?,'Ürün',?,12550,7250)`);
    const reversal = db.prepare(`UPDATE olvex_orders SET status = 'void', voided_by = 'u', voided_on = '2026-11-17'
      WHERE business_id = 'ana' AND id = ? AND status = 'posted'`);
    const lookup = db.prepare("SELECT stock FROM olvex_products WHERE business_id = ? AND id = ?");
    const branchLookup = db.prepare("SELECT stock FROM olvex_branch_stock WHERE business_id = 'ana' AND branch_id = ? AND product_id = ?");
    const history = db.prepare("SELECT COALESCE(SUM(delta), 0) AS balance FROM olvex_stock_movements WHERE business_id = 'ana' AND product_id = ?");
    const balance = [20, 15];
    const orders = [];
    movement.run(mainBranch, "opening1", "p1", "opening", balance[0]);
    movement.run(mainBranch, "opening2", "p2", "opening", balance[1]);

    let rng = 0x5db947d3;
    const random = (limit) => {
      rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
      return Math.floor((rng / 2 ** 32) * limit);
    };
    let rejected = 0;
    let reversed = 0;
    for (let step = 0; step < 10_000; step++) {
      const kind = random(6);
      const index = random(2);
      const amount = random(23) + 1;
      const other = index === 0 ? 1 : 0;
      const subsequent = random(5) === 0 ? random(17) + 1 : 0;
      const code = `p${index + 1}`;
      const pending = orders.length && kind === 0 ? orders[random(orders.length)] : null;
      let apply;
      let expected = [...balance];
      if (pending) {
        expected = pending.void ? expected : balance.map((value, productIndex) => value - pending.delta[productIndex]);
        apply = () => reversal.run(pending.id);
      } else if (kind <= 2) {
        expected[index] += kind === 1 ? amount : -amount;
        apply = () => movement.run(mainBranch, `m${step}`, code, "adjustment", expected[index] - balance[index]);
      } else {
        const sale = kind > 3;
        const sign = sale ? -1 : 1;
        expected[index] += amount * sign;
        expected[other] += subsequent * sign;
        apply = () => {
          order.run(mainBranch, `o${step}`, sale ? "sale" : "purchase");
          item.run(`l${step}a`, `o${step}`, code, code, amount);
          if (subsequent) item.run(`l${step}b`, `o${step}`, `p${other + 1}`, `p${other + 1}`, subsequent);
        };
      }

      db.exec("BEGIN");
      if (expected.some((value) => value < 0)) {
        assert.throws(apply, /olvex_insufficient_stock/, `Adım ${step}`);
        db.exec("ROLLBACK");
        rejected++;
      } else {
        apply();
        db.exec("COMMIT");
        if (pending && !pending.void) {
          pending.void = true;
          reversed++;
        } else if (kind >= 3) {
          orders.push({ id: `o${step}`, void: false, delta: expected.map((value, i) => value - balance[i]) });
        }
        balance.splice(0, 2, ...expected);
      }
      assert.equal(lookup.get("ana", "p1").stock, balance[0], `Adım ${step}, ürün 1`);
      assert.equal(lookup.get("ana", "p2").stock, balance[1], `Adım ${step}, ürün 2`);
      assert.equal(lookup.get("yan", "p1").stock, 0, `Adım ${step}, veri ayrımı`);
      if (step % 100 === 0) {
        assert.equal(branchLookup.get(mainBranch, "p1").stock, balance[0]);
        assert.equal(branchLookup.get(mainBranch, "p2").stock, balance[1]);
        assert.equal(history.get("p1").balance, balance[0]);
        assert.equal(history.get("p2").balance, balance[1]);
      }
    }
    assert.ok(rejected > 50 && reversed > 300, `Red ${rejected}, iade ${reversed}`);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("CSV tarih, Türkçe ondalık fiyat, tırnaklar ve fiş tekrarları", () => {
  const result = parseSalesCsv("\ufeffreferans;tarih;sku;adet;birim_fiyat\r\n\"Fiş;1\";2026-01-01;elma;2;12,50\r\n\"Fiş;1\";2026-01-01;kiraz;1;1,05\r\n");
  assert.deepEqual(result, [{
    reference: "Fiş;1", date: "2026-01-01", lines: [{ sku: "ELMA", quantity: 2, unit: 1250 }, { sku: "KIRAZ", quantity: 1, unit: 105 }]
  }]);
  const header = "referans,tarih,sku,adet,birim_fiyat\n";
  assert.equal(parseSalesCsv(header + 'F1,2026-01-01,T1,1,"100,50"')[0].lines[0].unit, 10050);
  assert.throws(() => parseSalesCsv(header + "F1,2026-02-31,T1,1,50"), /Tarih geçersiz/);
  assert.throws(() => parseSalesCsv(header + "F1,2026-01-01,T1,1,50\nF1,2026-01-01,t1,2,51"), /tekrar ediyor/);
  assert.throws(() => parseSalesCsv(header + "F1,2026-01-01,T1,1,50,10"), /Beş sütun/);
});

test("şubeler arası transfer iki hareket üretir ve işletme bakiyesini korur", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(baseline);
    for (const migration of workspaceMigrations) db.exec(migration);
    db.exec(`INSERT INTO users(id,email) VALUES ('u','transfer@example.test');
      INSERT INTO businesses(id,name,created_by) VALUES ('b','Birinci','u'),('c','İkinci','u');
      INSERT INTO olvex_branches(business_id,id,name) VALUES ('b','sahil','Sahil');
      INSERT INTO olvex_products(business_id,id,sku,name,price_minor,cost_minor) VALUES ('b','p','SKU','Ürün',100,70);
      INSERT INTO olvex_stock_movements(business_id,branch_id,id,product_id,kind,delta,created_by)
      SELECT 'b',id,'opening','p','opening',12,'u' FROM olvex_branches WHERE business_id='b' AND is_default=1;`);
    const branch = business => db.prepare("SELECT id FROM olvex_branches WHERE business_id=? AND is_default=1").get(business).id;
    const transfer = db.prepare(`INSERT INTO olvex_stock_transfers
      (business_id,id,source_branch_id,destination_branch_id,product_id,quantity,created_by) VALUES ('b',? ,?,?,'p',?,'u')`);
    const from = branch("b");
    transfer.run("t1", from, "sahil", 5);
    assert.throws(() => transfer.run("t1", from, "sahil", 5), /UNIQUE constraint/);
    assert.throws(() => transfer.run("t2", from, "sahil", 8), /olvex_insufficient_stock/);
    assert.throws(() => transfer.run("t3", from, branch("c"), 1), /olvex_invalid_branch|FOREIGN KEY/);
    const balance = db.prepare("SELECT stock FROM olvex_branch_stock WHERE business_id='b' AND branch_id=? AND product_id='p'");
    assert.equal(balance.get(from).stock, 7);
    assert.equal(balance.get("sahil").stock, 5);
    assert.equal(db.prepare("SELECT stock FROM olvex_products WHERE business_id='b' AND id='p'").get().stock, 12);
    assert.deepEqual(db.prepare("SELECT delta FROM olvex_stock_movements WHERE transfer_id IS NOT NULL ORDER BY delta").all()
      .map(row => row.delta), [-5, 5]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM olvex_stock_transfers").get().n, 1);
  } finally {
    db.close();
  }
});

test("transfer geçmişi geçişi eski tarihi, iki stok hareketini ve bakiyeleri korur", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(baseline);
    const upgrade = workspaceFiles.indexOf("0008_transfer_history.sql");
    assert.ok(upgrade >= 0);
    for (const migration of workspaceMigrations.slice(0, upgrade)) db.exec(migration);
    db.exec(`INSERT INTO users(id,email) VALUES ('u','transfer@example.test');
      INSERT INTO businesses(id,name,created_by) VALUES ('b','Birinci','u'),('c','İkinci','u');
      INSERT INTO olvex_branches(business_id,id,name) VALUES ('b','sahil','Sahil');
      INSERT INTO olvex_products(business_id,id,sku,name,price_minor,cost_minor) VALUES ('b','p','SKU','Ürün',100,70);
      INSERT INTO olvex_stock_movements(business_id,branch_id,id,product_id,kind,delta,created_by)
      SELECT 'b',id,'opening','p','opening',12,'u' FROM olvex_branches WHERE business_id='b' AND is_default=1;`);
    const branch = business => db.prepare("SELECT id FROM olvex_branches WHERE business_id=? AND is_default=1").get(business).id;
    const transfer = db.prepare(`INSERT INTO olvex_stock_transfers
      (business_id,id,source_branch_id,destination_branch_id,product_id,quantity,created_by) VALUES ('b',? ,?,?,'p',?,'u')`);
    const from = branch("b");
    transfer.run("t1", from, "sahil", 5);
    const original = db.prepare("SELECT * FROM olvex_stock_transfers WHERE id='t1'").get();
    for (const migration of workspaceMigrations.slice(upgrade)) db.exec(migration);
    const { occurred_on, note, ...preserved } = db.prepare("SELECT * FROM olvex_stock_transfers WHERE id='t1'").get();
    assert.deepEqual(preserved, { ...original });
    assert.equal(occurred_on, null);
    assert.equal(note, "");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.throws(() => transfer.run("t1", from, "sahil", 5), /UNIQUE constraint/);
    assert.throws(() => transfer.run("t2", from, "sahil", 8), /olvex_insufficient_stock/);
    assert.throws(() => transfer.run("t3", from, branch("c"), 1), /olvex_invalid_branch|FOREIGN KEY/);
    const balance = db.prepare("SELECT stock FROM olvex_branch_stock WHERE business_id='b' AND branch_id=? AND product_id='p'");
    assert.equal(balance.get(from).stock, 7);
    assert.equal(balance.get("sahil").stock, 5);
    assert.equal(db.prepare("SELECT stock FROM olvex_products WHERE business_id='b' AND id='p'").get().stock, 12);
    assert.deepEqual(db.prepare("SELECT delta FROM olvex_stock_movements WHERE transfer_id IS NOT NULL ORDER BY delta").all()
      .map(row => row.delta), [-5, 5]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM olvex_stock_transfers").get().n, 1);
  } finally {
    db.close();
  }
});
