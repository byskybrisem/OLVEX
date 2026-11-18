import test from "node:test";
import assert from "node:assert/strict";
import { day, money } from "../assets/ui.js";
import { renderers } from "../assets/views.js";
import { salesChart } from "../assets/sales-chart.js";

const state = { view: "finance", manager: true, from: "2026-11-15", to: "2026-11-17" };

test("nakit dökümü ödeme günlerini ve net hareketi gösterir, bekleyen tutarı ayrı tutar", () => {
  const view = renderers.finance({
    rows: [], page: 1,
    summary: {
      days: [
        { day: "2026-11-15", revenue: 27000, spending: 2000 },
        { day: "2026-11-16", revenue: 0, spending: 0 },
        { day: "2026-11-17", revenue: 0, spending: 31000 }
      ],
      totals: { revenue: 27000, spending: 33000 },
      unpaid: { sale: 82000, purchase: 43000 }
    }
  }, state);
  const period = view.split('aria-label="Seçilen dönemde nakit hareketi"')[1].split("</section>")[0];
  assert.ok(period.includes(money(-6000)));
  assert.ok(period.includes("Günlük nakit dökümü (2 gün)"));
  assert.ok(period.indexOf(day("2026-11-17")) < period.indexOf(day("2026-11-15")));
  assert.ok(!period.includes(day("2026-11-16")));
  assert.ok(!period.includes(money(82000)));
  assert.ok(period.includes(money(25000)) && period.includes(money(-31000)));
  const pending = view.split('aria-label="Tüm dönemlerde açık tutarlar"')[1].split("</section>")[0];
  assert.ok(pending.includes(money(82000)) && pending.includes(money(43000)));
});

test("hareketsiz nakit döneminde tablo kurulmaz, geçmişten açık tutar görülebilir", () => {
  const view = renderers.finance({
    rows: [], page: 1, summary: {
      days: [{ day: state.from, revenue: 0, spending: 0 }], totals: { revenue: 0, spending: 0 }, unpaid: { sale: 123456 }
    }
  }, state);
  assert.match(view, /Seçilen dönemde nakit hareketi yok/);
  assert.doesNotMatch(view, /Günlük nakit dökümü/);
  assert.ok(view.includes(money(123456)));
});

test("sıfır tutarlı gerçek satış, kayıtsız dönemden ayırt edilir", () => {
  const view = salesChart([{ day: state.to, sales: 0, saleCount: 1 }]);
  assert.match(view, /kaydedilen satışların tutarı sıfır/);
  assert.doesNotMatch(view, /class="plot"|Satış kaydedildiğinde/);
  assert.match(salesChart([{ day: state.to, sales: 0, saleCount: 0 }]), /Satış kaydedildiğinde/);
});

test("önceki net nakit negatifse değişim parasal fark olarak gösterilir", () => {
  const view = renderers.overview({
    totals: { sales: 0, cost: 0, revenue: 0, spending: 17500, saleCount: 0 },
    previous: { sales: 0, cost: 0, revenue: 0, spending: 25000 },
    lowStock: [], latest: [], days: []
  }, state);
  assert.ok(view.includes("+" + money(7500) + " · önceki döneme göre"));
});

test("işlem saati İstanbul'da gün değişimini izler, takvim günleri sabit kalır", () => {
  assert.equal(day("2026-11-17 21:01:00"), day("2026-11-18"));
  assert.equal(day("2026-11-17T23:59:00.000Z"), day("2026-11-18"));
  assert.equal(day("2026-11-17 20:59:59"), day("2026-11-17"));
  assert.notEqual(day("2026-11-17"), day("2026-11-18"));
});
