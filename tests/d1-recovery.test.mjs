import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const wrangler = new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url).pathname;
const migrations = new URL("../migrations", import.meta.url).pathname;

test("Yerel D1 yedeği, boş hedefe geri yükleme ve kesim sonrası yazımların korunması", { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "olvex-d1-drill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stores = Object.fromEntries(await Promise.all(["source", "restored"].map(async store => {
    const directory = join(root, store);
    await mkdir(directory);
    const config = join(directory, "drill.json");
    await writeFile(config, JSON.stringify({
      name: "olvex-recovery-drill", compatibility_date: "2025-10-01",
      d1_databases: [{ binding: "DB", database_name: "olvex-recovery-drill", database_id: randomUUID(), migrations_dir: migrations }]
    }));
    return [store, { directory, config }];
  })));
  const command = (store, action, ...args) => run(process.execPath, [
    wrangler, "d1", ...action, "DB", "--local", "--config", stores[store].config, ...args
  ], { cwd: stores[store].directory, env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" }, timeout: 60_000 });
  const execute = async (store, sql) => {
    const { stdout } = await command(store, ["execute"], "--command", sql, "--json");
    return JSON.parse(stdout).map(entry => entry.results);
  };
  const manifest = (store) => execute(store, [
    "SELECT id, email FROM users ORDER BY id",
    "SELECT id, name FROM businesses ORDER BY id",
    "SELECT business_id, user_id, role FROM business_members ORDER BY business_id, user_id",
    "SELECT business_id, sku, stock FROM olvex_products ORDER BY business_id, sku",
    "SELECT business_id, product_id, stock FROM olvex_branch_stock ORDER BY business_id, product_id",
    "SELECT business_id, order_id, kind, amount_minor FROM olvex_order_payments ORDER BY business_id, order_id, kind",
    "SELECT name FROM d1_migrations ORDER BY id",
    "PRAGMA foreign_key_check"
  ].join(";"));
  await command("source", ["migrations", "apply"]);
  await execute("source", [
    "INSERT INTO users (id,email) VALUES ('u','drill@example.test')",
    "INSERT INTO businesses (id,name,created_by) VALUES ('b','Kesim kaydı','u')",
    "INSERT INTO business_members (id,business_id,user_id,role) VALUES ('m','b','u','owner')",
    "INSERT INTO olvex_products (business_id,id,sku,name,price_minor,cost_minor) VALUES ('b','p','TEST','Örnek',1000,500)",
    "INSERT INTO olvex_stock_movements (business_id,id,product_id,kind,delta,created_by,branch_id) SELECT 'b','open','p','opening',5,'u',id FROM olvex_branches WHERE business_id='b'",
    "INSERT INTO olvex_orders (business_id,id,kind,source,reference,occurred_on,paid_on,created_by,branch_id) SELECT 'b','order','sale','manual','receipt','2026-01-01','2026-01-01','u',id FROM olvex_branches WHERE business_id='b'",
    "INSERT INTO olvex_order_items (business_id,id,order_id,product_id,product_sku,product_name,quantity,unit_minor,cost_minor) VALUES ('b','line','order','p','TEST','Örnek',2,1000,500)"
  ].join(";"));
  const before = await manifest("source");
  assert.deepEqual(before[3], [{ business_id: "b", sku: "TEST", stock: 3 }]);
  assert.equal(before[4][0].stock, 3);
  assert.equal(before[5][0].amount_minor, 2000);
  assert.deepEqual(before.at(-1), []);

  const dump = join(root, "pre.sql");
  await command("source", ["export"], "--output", dump);
  const digest = data => createHash("sha256").update(data).digest("hex");
  const checkpoint = digest(await readFile(dump));
  await execute("source", "UPDATE businesses SET name = 'Kesim sonrası' WHERE id = 'b'");
  assert.equal(digest(await readFile(dump)), checkpoint);
  const prepared = join(root, "restore.sql");
  const prepare = new URL("../scripts/prepare-d1-restore.mjs", import.meta.url).pathname;
  await run(process.execPath, [prepare, dump, prepared], { timeout: 30_000 });
  await command("restored", ["execute"], "--file", prepared);
  assert.deepEqual(await manifest("restored"), before);
  await command("restored", ["migrations", "apply"]);
  assert.deepEqual(await manifest("restored"), before);
  assert.equal((await manifest("source"))[1][0].name, "Kesim sonrası");
});
