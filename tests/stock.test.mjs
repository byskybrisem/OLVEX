import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { parseSalesCsv } from "../assets/csv.js";

const baseline = readFileSync(new URL("../migrations/0001_auth.sql", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../migrations/0002_workspace.sql", import.meta.url), "utf8");

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
    db.exec(workspace);
    const old = db.prepare(`SELECT b.name, m.role, u.password_hash, s.token_hash FROM businesses b
      JOIN business_members m ON b.id = m.business_id JOIN users u ON u.id = m.user_id
      JOIN user_sessions s ON u.id = s.user_id`).get();
    assert.deepEqual({ ...old }, { name: "Eski İşletme", role: "owner", password_hash: "legacy-hash", token_hash: "token" });
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("10.000 stok işleminde bakiye, işletme sınırı ve hareket kaydı tutarlılığı", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(baseline);
    db.exec(workspace);
    db.exec(`INSERT INTO users(id,email) VALUES ('u','seed@example.test');
      INSERT INTO businesses(id,name,created_by) VALUES ('ana','Merkez','u'),('yan','Yan Şube','u');
      INSERT INTO olvex_products (business_id,id,sku,name,price_minor,cost_minor) VALUES
        ('ana','p1','P-1','Ürün 1',12550,7250),('ana','p2','P-2','Ürün 2',2599,1200),('yan','p1','P-1','Başka şube',9900,1000);`);
    const movement = db.prepare(`INSERT INTO olvex_stock_movements
      (business_id,id,product_id,kind,delta,created_by) VALUES ('ana',?,?,?,?,'u')`);
    const order = db.prepare(`INSERT INTO olvex_orders (business_id,id,kind,source,occurred_on,created_by)
      VALUES ('ana',?,?,'manual','2026-11-17','u')`);
    const item = db.prepare(`INSERT INTO olvex_order_items
      (business_id,id,order_id,product_id,product_sku,product_name,quantity,unit_minor,cost_minor)
      VALUES ('ana',?,?,?,?,'Ürün',?,12550,7250)`);
    const reversal = db.prepare(`UPDATE olvex_orders SET status = 'void', voided_by = 'u', voided_on = '2026-11-17'
      WHERE business_id = 'ana' AND id = ? AND status = 'posted'`);
    const lookup = db.prepare("SELECT stock FROM olvex_products WHERE business_id = ? AND id = ?");
    const history = db.prepare("SELECT COALESCE(SUM(delta), 0) AS balance FROM olvex_stock_movements WHERE business_id = 'ana' AND product_id = ?");
    const balance = [20, 15];
    const orders = [];
    movement.run("opening1", "p1", "opening", balance[0]);
    movement.run("opening2", "p2", "opening", balance[1]);

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
        apply = () => movement.run(`m${step}`, code, "adjustment", expected[index] - balance[index]);
      } else {
        const sale = kind > 3;
        const sign = sale ? -1 : 1;
        expected[index] += amount * sign;
        expected[other] += subsequent * sign;
        apply = () => {
          order.run(`o${step}`, sale ? "sale" : "purchase");
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
