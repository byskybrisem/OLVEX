import { badge, button, count, day, empty, filters, h, link, money, panel } from "./ui.js";
import { salesChart } from "./sales-chart.js";

const paths = {
  sales: "M3 17l6-6 4 4 8-10 M15 5h6v6",
  profit: "M3 19h18 M6 15v-4 M12 15V6 M18 15V3",
  cash: "M3 6h18v13H3z M3 10h18 M15 15h3",
  stock: "M3 7l9-4 9 4-9 5z M3 7v10l9 5 9-5V7 M12 12v10",
  due: "M12 3a9 9 0 1 0 .01 0 M12 7v6l4 2",
  receipt: "M5 3h14v18l-3-2-4 2-4-2-3 2z M8 8h8 M8 12h6"
};

function icon(name) {
  return `<svg class="metric-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name]}"/></svg>`;
}

function change(current, prior) {
  if (!Number.isFinite(prior) || prior === 0) return "";
  const difference = current - prior;
  const amount = prior > 0
    ? (difference / prior).toLocaleString("tr-TR", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" })
    : (difference > 0 ? "+" : "") + money(difference);
  return `<small class="delta" data-direction="${Math.sign(difference)}" title="Önceki eşit uzunluktaki döneme göre">${h(amount)} · önceki döneme göre</small>`;
}

function metric(symbol, title, value, detail) {
  return `<div class="metric"><div class="metric-label">${icon(symbol)}${h(title)}</div>
    <strong>${h(value)}</strong>${detail}</div>`;
}

function ledger(rows, fallback) {
  if (!rows.length) return empty(fallback);
  return `<ul class="ledger">${rows.map(({symbol, name, note, value}) => `<li>
    ${icon(symbol)}<div><b>${h(name)}</b><small>${h(note)}</small></div><strong>${value}</strong></li>`).join("")}</ul>`;
}

export function overview(data, state) {
  const {totals, previous, lowStock, latest, days} = data;
  const profit = totals.sales - totals.cost;
  const cash = totals.revenue - totals.spending;
  const gross = state.manager ? metric("profit", "Brüt kâr", money(profit),
    change(profit, previous && previous.sales - previous.cost)) : "";
  const balance = state.manager ? metric("cash", "Net nakit", money(cash),
    change(cash, previous && previous.revenue - previous.spending)) : "";
  const stock = metric("stock", "Kritik stok", count(lowStock[0]?.total), "<small>Güncel ürün sayısı</small>");
  const due = state.manager ? metric("due", "Bekleyen tahsilat", money(data.unpaid?.sale), "<small>Tüm dönemler</small>") : "";
  const hasReceiptTotals = days.every(row => Number.isFinite(row.receipts) && Number.isFinite(row.grossSales));
  const receipts = hasReceiptTotals ? days.reduce((sum, row) => sum + row.receipts, 0) : null;
  const grossSales = hasReceiptTotals ? days.reduce((sum, row) => sum + row.grossSales, 0) : null;
  const summary = `<section class="performance"><article class="revenue">
    <div class="revenue-head"><div><h2>${icon("sales")} Net satış tutarı</h2><strong>${h(money(totals.sales))}</strong></div>
    ${hasReceiptTotals ? `<span class="ticket-count">${count(receipts)} satış fişi</span>` : ""}</div>
    ${change(totals.sales, previous?.sales)}${salesChart(days)}</article>
    <aside class="metrics" aria-label="İşletme göstergeleri">${gross}${balance}${stock}${due}</aside></section>`;
  const recent = panel("Son satışlar", ledger(latest.map(row => ({
    symbol:"receipt", name:row.reference || "Manuel satış", note:day(row.occurred_on), value:h(money(row.total_minor))
  })), "Seçilen tarihlerde satış yok."), link("Satışları aç", "#sales", "small"));
  const critical = panel("Kritik stok", ledger(lowStock.map(row => ({
    symbol:"stock", name:row.name, note:row.sku, value:badge(count(row.stock) + " adet", "warn")
  })), "Kritik stok kaydı yok."), link("Ürünler", "#products", "small"));
  const pending = state.manager ? panel("Bekleyen tahsilatlar", ledger((data.receivables || []).map(row => ({
    symbol:"due", name:row.customer || "Perakende", note:row.reference || day(row.occurred_on), value:h(money(row.total_minor))
  })), "Bekleyen tahsilat yok."), state.demo ? "" : button("Bekleyenleri aç","open-receivables",{kind:"small"})) : "";
  const leaders = data.leaders || [];
  const ranking = panel("Net satış tutarına göre ürünler", leaders.length ? `<ol class="ranking">${leaders.map(row =>
    `<li><div><b>${h(row.name)}</b><strong>${h(money(row.sales))}</strong></div>${row.sales > 0 ? `<meter min="0" max="${leaders[0].sales}" value="${row.sales}" aria-label="${h(row.name)} net satış tutarı"></meter>` : ""}<small>${count(row.quantity)} adet (net)</small></li>`).join("")}</ol>` : empty("Bu dönem için sıralanacak ürün yok."));
  const average = receipts ? money(grossSales / receipts) : "—";
  const activeDays = days.filter(row => row.saleActivity || row.saleCount || row.sales).length;
  const insights = panel("İşletme içgörüleri", `<dl class="insights"><div><dt>Ortalama satış fişi (iade öncesi)</dt><dd>${h(average)}</dd></div>
    <div><dt>Satış hareketi olan gün</dt><dd>${count(activeDays)} / ${count(days.length)}</dd></div></dl>`);
  const quick = state.demo ? "" : panel("Hızlı işlemler", `<div class="inline">${button("Müşteri ekle","edit-customer")}${button("Görev oluştur","edit-task")}${state.manager ? button("Gelir / gider ekle","add-cash") : ""}</div>`);
  return filters(state, {range:true}) + summary + `<div class="dashboard-grid"><div class="dashboard-column">${recent}${pending}${quick}</div><div class="dashboard-column">${ranking}${critical}${insights}</div></div>`;
}
