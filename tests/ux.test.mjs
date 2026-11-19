import test from "node:test";
import assert from "node:assert/strict";
import { periods, offsetDay } from "../assets/ui.js";
import { renderers } from "../assets/views.js";

const initialState = {
  manager: true, from: "2026-11-12", to: "2026-11-18",
  q: "", archived: false, page: 1, chat: [],
  business: { id: "test-business", role: "owner", name: "Atölye" }
};

function overview(days) {
  return renderers.overview({
    totals: { sales: 0, cost: 0, revenue: 0, spending: 0, saleCount: 0 },
    lowStock: [], latest: [], days
  }, initialState);
}

function ai(facts, mode = "off") {
  return renderers.ai({ facts, mode, proposals: [] }, initialState);
}

const emptyFacts = {
  from: "2026-11-12",
  to: "2026-11-18",
  totals: { sales: 0, cost: 0, revenue: 0, spending: 0 },
  previousSales: 0,
  lowStock: [],
  lowStockCount: 0,
  unpaid: {}
};

test("overview explains an empty sales period without plotting a flat line", () => {
  const html = overview([
    { day: "2026-11-17", sales: 0 },
    { day: "2026-11-18", sales: 0 }
  ]);
  assert.doesNotMatch(html, /class="plot"/);
  assert.match(html, /Seçilen tarihlerde satış yok/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("overview shows one point with a single day of actual sales", () => {
  const html = overview([{ day: "2026-11-18", sales: 15050 }]);
  assert.match(html, /class="chart-point"/);
  assert.match(html, /150,50/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("overview handles missing dates without throwing", () => {
  assert.match(overview([]), /Seçilen dönemde satış tutarı yok/);
});

test("AI provides truthful and useful no-key business insights", () => {
  const html = ai(emptyFacts);
  assert.match(html, /Ücretsiz veriye dayalı analiz/);
  assert.match(html, /etkinleştirilmemiş/);
  assert.match(html, /Stokları incele/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("AI explains a decline and pending collections using only supplied data", () => {
  const facts = {
    ...emptyFacts,
    previousSales: 20000,
    totals: { ...emptyFacts.totals, sales: 10000 },
    unpaid: { sale: 7500 },
    lowStockCount: 2
  };
  const html = ai(facts);
  assert.match(html, /%50 azaldı/);
  assert.match(html, /2 şube stok uyarısı/);
  assert.match(html, /75,00/);
});

test("AI safely escapes product names in low-stock reporting", () => {
  const html = ai({
    ...emptyFacts, lowStockCount: 1,
    lowStock: [{ name: "<script>alert(1)</script>", sku: "X", branch_name: "Sahil<&>", stock: 0, reorder_at: 10, total_stock: 500 }]
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Sahil&lt;&amp;&gt;/);
  assert.match(html, /data-label="Şube stoku".*?>0</);
  assert.match(html, /data-label="İşletme toplamı">500</);
});

test("AI stok onayı işletme, şube, ürün, yön ve adedi gösterir; şubesiz taslak yalnızca reddedilebilir", () => {
  const draft = { id: "draft", kind: "stock", businessName: "Atölye", name: "Kola", sku: "KOLA", delta: -3,
    branchId: "branch", branchName: "Sahil<&>", description: "Sayım" };
  const preview = proposal => renderers.ai({ facts: emptyFacts, mode: "mock", proposals: [proposal] }, initialState);
  const scoped = preview(draft);
  assert.match(scoped, /Atölye.*Sahil&lt;&amp;&gt;.*Kola \(KOLA\).*Stok çıkışı, 3 adet/);
  assert.match(scoped, /apply-proposal/);
  const legacy = preview({ ...draft, branchId: undefined });
  assert.doesNotMatch(legacy, /apply-proposal/);
  assert.match(legacy, /discard-proposal/);
});

test("long periods retain the full total and bounded point count", () => {
  const html = overview(Array.from({length:366}, (_, index) =>
    ({day:offsetDay("2024-01-01", index), sales:10000000000})));
  assert.equal(html.match(/class="chart-point"/g).length, 8);
  assert.match(html, /4.600.000.000,00/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("period presets cross month boundaries including leap years", () => {
  assert.deepEqual(periods("2024-03-01").map(x => x.from),
    ["2024-03-01", "2024-02-24", "2024-02-01", "2024-03-01"]);
});

test("comparisons use posted totals from the previous period and handle a missing baseline", () => {
  const snapshot = {
    totals: {sales:15000, cost:4000, revenue:15000, spending:3000, saleCount:2},
    previous: {sales:10000, cost:3000, revenue:5000, spending:5000},
    days: [], latest: [], lowStock: []
  };
  const html = renderers.overview(snapshot, initialState);
  assert.match(html, /\+%50 · önceki döneme göre/);
  assert.equal(html.match(/class="delta"/g).length, 2);
  const noHistory = renderers.overview({...snapshot, previous:undefined}, initialState);
  assert.doesNotMatch(noHistory, /class="delta"/);
});

test("tamamı iade edilen ödenmemiş satış için tahsilat önerilmez", () => {
  const rows = [{ id: "sale", status: "posted", fully_returned: 1, reference: "İade", occurred_on: "2026-11-18", total_minor: 0 }];
  const html = renderers.sales({ rows }, initialState);
  assert.match(html, /Tam iade|Tamamı iade edildi/);
  assert.doesNotMatch(html, /settle-order/);
  assert.doesNotMatch(html, /void-order/);
});
