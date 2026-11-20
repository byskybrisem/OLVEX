import assert from "node:assert/strict";
import { test } from "node:test";
import { randomToken, sha256 } from "../functions/_lib/session.js";
import { addDays, today } from "../functions/_lib/validate.js";
import { localPages } from "./local.mjs";

const uuid = () => crypto.randomUUID();
const lines = [{ sku: "A", quantity: 2, unit: 1250 }, { sku: "B", quantity: 1, unit: 375 }];
const grossPerSale = 2875;
const costPerSale = 900;
const opening = [[2000, 1000], [1200, 800]];

async function jsonRequest(url, { body, headers }) {
  const options = { headers: { ...headers } };
  if (body !== undefined) {
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  return { status: response.status, data: await response.json() };
}

function check(response, status, label) {
  assert.equal(response.status, status, `${label}: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function wave(send, events, replay = false) {
  // Start every request before awaiting a response. D1 serializes the resulting transactions.
  const responses = await Promise.all(events.map((event) => send(event)));
  const ids = responses.map((result, index) => {
    const event = events[index];
    const status = replay || event.body.action === "void" ? 200 : 201;
    const data = check(result, status, `${event.register.name}/${event.body.reference}`);
    assert.equal(data.repeated, replay);
    return data.id;
  });
  assert.equal(new Set(ids).size, events.length);
  return ids;
}

test("yerel D1 üzerinde 2 şube, 5 kasa, 1.000 eşzamanlı satış ve yeniden gönderim", { timeout: 480_000 }, async (t) => {
  const owner = uuid();
  const business = uuid();
  const other = uuid();
  const session = randomToken();
  const sessionHash = await sha256(session);
  const pages = await localPages({ professionalFixtures: true, seed: `
    INSERT INTO users (id, email) VALUES ('${owner}', 'pos-load@example.test');
    INSERT INTO businesses (id, name, created_by) VALUES
      ('${business}', 'Yük testi', '${owner}'), ('${other}', 'Ayrı işletme', '${owner}');
    INSERT INTO business_members (id, business_id, user_id, role) VALUES
      ('${uuid()}', '${business}', '${owner}', 'owner'), ('${uuid()}', '${other}', '${owner}', 'owner');
    INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
      VALUES ('${uuid()}', '${owner}', '${sessionHash}', '2099-01-01T00:00:00.000Z');
  ` });
  t.after(pages.close);

  async function workspace(section, body, tenant = business) {
    const response = await jsonRequest(`${pages.url}/api/workspace/${tenant}/${section}`, {
      body: body && { requestId: uuid(), ...body },
      headers: { Origin: pages.url, Cookie: `olvex_session=${session}` }
    });
    return check(response, 200, section);
  }
  const post = ({ register, body }) => jsonRequest(pages.url + "/api/pos", {
    body, headers: { Authorization: `Bearer olvex_pos_${register.secret}` }
  });

  const { rows: original } = await workspace("locations");
  assert.equal(original.length, 1);
  const second = await workspace("locations", { action: "create", name: "Sahil" });
  const branches = [original[0].id, second.id];
  assert.equal(new Set([business, ...branches]).size, 3);

  const registers = await Promise.all(Array.from({ length: 5 }, async (_, i) => {
    const register = { name: `Kasa ${i + 1}`, secret: randomToken(), branchId: branches[i < 3 ? 0 : 1] };
    const { id } = await workspace("pos", { action: "create", identityMode: "native", ...register });
    return { ...register, id };
  }));
  assert.equal(new Set(registers.map((register) => register.id)).size, 5);
  for (const [i, line] of lines.entries()) {
    const product = { action: "save", sku: line.sku, name: line.sku, price: line.unit, cost: [400, 100][i] };
    const { id } = await workspace("products", { ...product, opening: opening[0][i] });
    await workspace("stock", { action: "adjust", productId: id, branchId: second.id, delta: opening[1][i], note: "Açılış" });
    await workspace("products", { ...product, opening: 7 }, other);
  }

  const refundDate = today();
  const saleDate = addDays(refundDate, -7);
  // Receipt numbers recur independently at each register. All 1,000 baskets are identical.
  const sales = Array.from({ length: 1000 }, (_, i) => ({
    register: registers[i % 5], sequence: Math.floor(i / 5),
    body: { action: "sale", reference: `fis-${Math.floor(i / 5)}`, date: saleDate, paid: true, lines }
  }));
  const returns = sales.filter((event) => event.sequence < 20).map(({ register, body }) => ({
    register, body: { action: "return", saleReference: body.reference, reference: `iade-${body.reference}`,
      date: refundDate, lines: [{ sku: "A", quantity: 1 }] }
  }));
  const voids = sales.filter((event) => event.sequence >= 20 && event.sequence < 30).map(({ register, body }) => ({
    register, body: { action: "void", reference: body.reference, date: refundDate }
  }));

  const denied = async (event, overrides, status) => {
    const response = await post({ ...event, body: { ...event.body, ...overrides } });
    check(response, status, `${event.body.action} ${event.body.reference}`);
  };
  await denied(returns[0], {}, 409); // Original sale has not arrived yet.
  await denied(sales[0], { branchId: second.id }, 403);
  await denied(sales[0], { businessId: other }, 403);
  await denied(sales[0], { registerId: registers[1].id }, 403);

  async function verify(partialCount, voidCount) {
    const refund = partialCount * 1250 + voidCount * grossPerSale;
    const stock = [];
    for (const [index, branch] of branches.entries()) {
      const registerCount = index === 0 ? 3 : 2;
      const sold = registerCount * 200;
      const partial = registerCount * partialCount / 5;
      const cancelled = registerCount * voidCount / 5;
      const expected = [opening[index][0] - 2 * sold + partial + 2 * cancelled, opening[index][1] - sold + cancelled];
      const { rows } = await workspace(`products?branchId=${branch}`);
      stock.push(rows.map((row) => row.stock));
      assert.deepEqual(stock[index], expected, `Şube ${index + 1} stoğu`);
    }
    const totals = [stock[0][0] + stock[1][0], stock[0][1] + stock[1][1]];
    assert.deepEqual((await workspace("products")).rows.map((row) => row.stock), totals);
    assert.deepEqual((await workspace(`products?branchId=${second.id}`)).rows.map((row) => row.total_stock), totals);
    assert.deepEqual((await workspace("products", undefined, other)).rows.map((row) => row.stock), [7, 7]);
    const { totals: report } = await workspace(`reports?from=${saleDate}&to=${refundDate}`);
    const gross = sales.length * grossPerSale;
    assert.equal(report.saleCount, sales.length - voidCount);
    assert.equal(report.sales, gross - refund);
    assert.equal(report.cost, sales.length * costPerSale - partialCount * 400 - voidCount * costPerSale);
    assert.equal(report.revenue, gross);
    assert.equal(report.spending, refund);

    const [orders, items, moves, payments, foreignKeyErrors] = await pages.query(`
      SELECT source_key, COUNT(*) AS n FROM olvex_orders WHERE business_id='${business}' GROUP BY source_key;
      SELECT COUNT(*) AS n FROM olvex_order_items WHERE business_id='${business}';
      SELECT m.branch_id, p.sku, SUM(m.delta) AS balance, COUNT(*) AS n FROM olvex_stock_movements m
        JOIN olvex_products p ON m.business_id = p.business_id AND m.product_id = p.id
        WHERE m.business_id='${business}' GROUP BY m.branch_id, p.sku ORDER BY m.branch_id, p.sku;
      SELECT kind, amount_minor, COUNT(*) AS n FROM olvex_order_payments
        WHERE business_id='${business}' GROUP BY kind, amount_minor ORDER BY kind, amount_minor;
      PRAGMA foreign_key_check;
    `);
    assert.deepEqual(orders.map((row) => row.source_key).sort(), registers.map((register) => register.id).sort());
    assert.ok(orders.every((row) => row.n === 200));
    assert.equal(items[0].n, sales.length * 2);
    assert.equal(moves.length, 4);
    assert.equal(moves.reduce((sum, row) => sum + row.n, 0), 4 + sales.length * 2 + partialCount + 2 * voidCount);
    for (const [i, branch] of branches.entries()) {
      const atBranch = moves.filter((row) => row.branch_id === branch);
      assert.deepEqual(atBranch.map((row) => row.sku), ["A", "B"]);
      assert.deepEqual(atBranch.map((row) => row.balance), stock[i]);
    }
    const expectedPayments = [{ kind: "payment", amount_minor: grossPerSale, n: sales.length }];
    if (partialCount) expectedPayments.push({ kind: "refund", amount_minor: 1250, n: partialCount });
    if (voidCount) expectedPayments.push({ kind: "refund", amount_minor: grossPerSale, n: voidCount });
    assert.deepEqual(payments, expectedPayments);
    assert.deepEqual(foreignKeyErrors, []);
    return { stock, receipts: sales.length, gross, refund, net: gross - refund };
  }

  const ids = await wave(post, sales);
  const initial = await verify(0, 0);
  assert.deepEqual(await wave(post, sales, true), ids);
  await denied(sales[0], { lines: [{ sku: "A", quantity: 1, unit: 1250 }] }, 409);
  // The second line overdraws this branch even though the business has enough units.
  await denied(sales[3], { reference: "rollback", lines: [lines[0], { ...lines[1], quantity: 401 }] }, 409);
  assert.deepEqual(await verify(0, 0), initial);

  const reversals = [...returns, ...voids];
  const reversalIds = await wave(post, reversals);
  const final = await verify(100, 50);
  assert.deepEqual(await wave(post, reversals, true), reversalIds);
  await denied(returns[0], { lines: [{ sku: "A", quantity: 2 }] }, 409);
  await denied(returns[0], { reference: "excess", lines: [{ sku: "A", quantity: 2 }] }, 409);
  assert.deepEqual(await verify(100, 50), final);
  const { totals: onSaleDay, days: [saleDay] } = await workspace(`reports?from=${saleDate}&to=${saleDate}`);
  const { totals: onRefundDay, days: [refundDay] } = await workspace(`reports?from=${refundDate}&to=${refundDate}`);
  assert.equal(onSaleDay.sales, initial.gross);
  assert.equal(onRefundDay.sales, -final.refund);
  assert.equal(onRefundDay.spending, final.refund);
  assert.deepEqual([saleDay.receipts, saleDay.grossSales, saleDay.saleActivity], [sales.length, initial.gross, true]);
  assert.deepEqual([refundDay.receipts, refundDay.grossSales, refundDay.saleActivity], [0, 0, true]);
  t.diagnostic(`İlk kayıt ve tekrar: ${JSON.stringify(initial)}; iade/iptal ve tekrar: ${JSON.stringify(final)} (kuruş).`);
});
