import test from "node:test";
import assert from "node:assert/strict";
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

test("overview renders an SVG chart with zero sales instead of disappearing", () => {
  const html = overview([
    { day: "2026-11-17", sales: 0 },
    { day: "2026-11-18", sales: 0 }
  ]);
  assert.match(html, /<svg/);
  assert.match(html, /Seçilen tarihlerde satış yok/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("overview shows one point with a single day of actual sales", () => {
  const html = overview([{ day: "2026-11-18", sales: 15050 }]);
  assert.match(html, /<circle/);
  assert.match(html, /150,50/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("overview handles missing dates without throwing", () => {
  assert.match(overview([]), /Grafik için tarih verisi bulunamadı/);
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
  assert.match(html, /2 ürün kritik stok/);
  assert.match(html, /75,00/);
});

test("AI safely escapes product names in low-stock reporting", () => {
  const html = ai({
    ...emptyFacts, lowStockCount: 1,
    lowStock: [{ name: "<script>alert(1)</script>", sku: "X", stock: 0 }]
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});
