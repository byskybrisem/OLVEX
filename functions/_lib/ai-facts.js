import { financials } from "./reports.js";
import { addDays, period, today } from "./validate.js";

export function normalizeAI(value) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/\p{Mark}/gu, "").replaceAll("ı", "i");
}

function topic(prompt) {
  if (/zarar|eksi marj|kar marji/.test(prompt)) return "margin";
  if (/en cok.*(urun|sat)|en cok satan|hangi urun.*sat|urun.*sirala/.test(prompt)) return "products";
  if (/stok|siparis|tuken/.test(prompt)) return "inventory";
  if (/sube.*(satis|karsilast|performans)|hangi sube/.test(prompt)) return "branches";
  if (/gider|harcama|nakit|tahsilat|odeme|gelir/.test(prompt)) return "cash";
  if (/satis|ciro/.test(prompt)) return "sales";
  return null;
}

const weekStart = day => addDays(day, -((new Date(day).getUTCDay() + 6) % 7));

function dates(prompt, prior, now) {
  const explicit = prompt.match(/\b2\d{3}-\d{2}-\d{2}\b/g);
  if (explicit) return period(new URLSearchParams({ from: explicit[0], to: explicit[1] ?? explicit[0] }));
  const compare = /karsilast|gore|artti|azaldi/.test(prompt);
  const monday = weekStart(now);
  if (prompt.includes("bugun")) return { start: now, end: now };
  if (/\bdun\b/.test(prompt)) return { start: addDays(now, -1), end: addDays(now, -1) };
  if (/gecen hafta|onceki hafta/.test(prompt) && !compare) return { start: addDays(monday, -7), end: addDays(monday, -1) };
  if (/bu hafta|gecen hafta|onceki hafta/.test(prompt)) return { start: monday, end: now };
  if (/gecen ay|onceki ay/.test(prompt) && !compare) {
    const end = addDays(now.slice(0, 7) + "-01", -1);
    return { start: end.slice(0, 7) + "-01", end };
  }
  if (/bu ay|gecen ay|onceki ay/.test(prompt)) return { start: now.slice(0, 7) + "-01", end: now };
  const days = Number(prompt.match(/son (\d{1,3}) gun/)?.[1]);
  if (days >= 1 && days <= 366) return { start: addDays(now, 1 - days), end: now };
  return prior ?? { start: addDays(now, -6), end: now };
}

function inventory(ctx, branch) {
  return ctx.db.prepare(`SELECT b.name AS branch, p.sku, substr(p.name,1,80) AS name, COALESCE(s.stock,0) AS stock,
      p.reorder_at AS reorderAt, p.reorder_at - COALESCE(s.stock,0) AS quantityToThreshold
    FROM olvex_branches b JOIN olvex_products p ON p.business_id = b.business_id AND p.active = 1
    LEFT JOIN olvex_branch_stock s ON s.business_id = b.business_id AND s.product_id = p.id AND s.branch_id = b.id
    WHERE b.business_id = ? AND (? IS NULL OR b.id = ?) AND COALESCE(s.stock,0) <= p.reorder_at
    ORDER BY quantityToThreshold DESC, b.id, p.sku LIMIT 8`).bind(ctx.businessId, branch, branch).all();
}

function salesBreakdown(ctx, start, end, branch, kind) {
  const byBranch = kind === "branches";
  const columns = byBranch ? "b.id AS group_key, substr(b.name,1,80) AS name"
    : "p.id AS group_key, p.sku, substr(p.name,1,80) AS name";
  const join = byBranch ? "JOIN olvex_branches b ON b.business_id = e.business_id AND b.id = e.branch_id"
    : "JOIN olvex_products p ON p.business_id = e.business_id AND p.id = e.product_id";
  const order = byBranch ? "salesMinor DESC" : kind === "margin" ? "grossProfitMinor ASC" : "netQuantity DESC";
  return ctx.db.prepare(`SELECT ${columns}, SUM(e.quantity) AS netQuantity,
      SUM(e.quantity * e.unit_minor) AS salesMinor,
      SUM(e.quantity * (e.unit_minor - e.cost_minor)) AS grossProfitMinor
    FROM olvex_order_events e ${join}
    WHERE e.business_id = ? AND e.kind = 'sale' AND e.occurred_on BETWEEN ? AND ?
      AND (? IS NULL OR e.branch_id = ?)
    GROUP BY group_key
    ${kind === "margin" ? "HAVING netQuantity > 0 AND grossProfitMinor < 0" : ""}
    ORDER BY ${order}, group_key LIMIT 8`).bind(ctx.businessId, start, end, branch, branch).all();
}

export async function factsForAI(ctx, messages, branch, allowedDraft) {
  const now = today();
  const userPrompts = messages.filter(msg => msg.role === "user").map(msg => normalizeAI(msg.content));
  const prompt = userPrompts.pop();
  const followUp = prompt.length < 100 && /^(peki\b|bunu\b|bunlari\b|ayni\b|neden\b|nasil\b)/.test(prompt);
  const previous = followUp ? userPrompts.at(-1) : null;
  const kind = topic(prompt) ?? (previous ? topic(previous) : null) ?? "summary";
  const branchId = branch?.id ?? null;
  const location = branch ? { scope: "selected_branch", name: branch.name } : { scope: "whole_business" };
  if (allowedDraft) return { asOf: now, location, kind: "draft" };
  if (kind === "inventory") {
    const { results } = await inventory(ctx, branchId);
    return { asOf: now, location, kind, candidates: results, limit: 8,
      note: "Stok anlık. quantityToThreshold yalnızca kritik eşiğe olan farktır. Tedarik süresi ve talep tahmini yok." };
  }

  const { start, end } = dates(prompt, previous ? dates(previous, null, now) : null, now);
  const scope = { ...ctx, branchId };
  const dated = { from: start, to: end, asOf: now, location, kind };
  if (["products", "margin", "branches"].includes(kind)) {
    const { results } = await salesBreakdown(ctx, start, end, branchId, kind);
    return { ...dated, rows: results.map(({ group_key, ...row }) => row), limit: 8 };
  }

  const span = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const compare = kind !== "cash" && (/karsilast|gore|artti|azaldi/.test(prompt) || kind === "summary");
  let previousFrom = addDays(start, -span);
  let previousTo = addDays(start, -1);
  if (end === now && start === weekStart(now) && /gecen hafta|onceki hafta/.test(prompt)) {
    previousFrom = addDays(start, -7);
    previousTo = addDays(end, -7);
  } else if (end === now && start.endsWith("-01") && /gecen ay|onceki ay/.test(prompt)) {
    const monthEnd = addDays(start, -1);
    previousFrom = monthEnd.slice(0, 7) + "-01";
    const matchedEnd = addDays(previousFrom, span - 1);
    previousTo = matchedEnd > monthEnd ? monthEnd : matchedEnd;
  }
  const [current, prior] = await Promise.all([
    financials(scope, start, end), compare ? financials(scope, previousFrom, previousTo) : null
  ]);
  const { totals, days } = current;
  const sales = { netSalesMinor: totals.sales, grossProfitMinor: totals.sales - totals.cost,
    receipts: days.reduce((sum, day) => sum + day.receipts, 0), hasSalesActivity: days.some(day => day.saleActivity) };
  const previousSales = prior && { from: previousFrom, to: previousTo, netSalesMinor: prior.totals.sales,
    hasSalesActivity: prior.days.some(day => day.saleActivity),
    differenceMinor: totals.sales - prior.totals.sales,
    changePercent: prior.totals.sales > 0 ? Math.round((totals.sales - prior.totals.sales) / prior.totals.sales * 100) : null };
  const cash = { inflowMinor: totals.revenue, outflowMinor: totals.spending,
    hasCashActivity: totals.revenue > 0 || totals.spending > 0,
    standaloneExpenseMinor: branchId ? null : current.standaloneExpense,
    netCashMovementMinor: totals.revenue - totals.spending, includesStandaloneEntries: !branchId };
  return { ...dated, ...(kind !== "cash" && { sales, previousSales }), ...(kind !== "sales" && { cash }) };
}

const lira = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });
const tl = minor => lira.format(minor / 100);

export function verifiedFacts(facts) {
  if (facts.kind === "draft") return "";
  const scope = facts.location.name ?? "Tüm işletme";
  const periodLabel = facts.from === facts.to ? facts.from : `${facts.from} – ${facts.to}`;
  const heading = `${scope} · ${facts.from ? periodLabel : facts.asOf}`;
  if (facts.candidates) {
    return [heading, ...facts.candidates.map(row => `${row.branch} · ${row.sku}: ${row.stock} adet, kritik eşik ${row.reorderAt}`),
      ...(facts.candidates.length ? [] : ["Kritik stok kaydı yok."])].join("\n");
  }
  if (facts.rows) {
    return [heading, ...facts.rows.map(row =>
      `${row.name}: ${row.netQuantity} net adet, ${tl(row.salesMinor)} net satış, ${tl(row.grossProfitMinor)} brüt sonuç`),
      ...(facts.rows.length ? [] : ["Bu ölçütlere uyan kayıt yok."])].join("\n");
  }
  const rows = [heading];
  if (facts.sales) rows.push(facts.sales.hasSalesActivity
    ? `Net satış ${tl(facts.sales.netSalesMinor)}, ${facts.sales.receipts} yeni fiş, brüt sonuç ${tl(facts.sales.grossProfitMinor)}.`
    : "Bu dönemde satış hareketi kaydı yok.");
  if (facts.previousSales) rows.push(facts.previousSales.hasSalesActivity
    ? `Önceki dönem (${facts.previousSales.from} – ${facts.previousSales.to}) net satış ${tl(facts.previousSales.netSalesMinor)}.`
    : "Karşılaştırma döneminde satış hareketi kaydı yok.");
  if (facts.cash) rows.push(facts.cash.hasCashActivity
    ? `Nakit girişi ${tl(facts.cash.inflowMinor)}, çıkışı ${tl(facts.cash.outflowMinor)}, net hareket ${tl(facts.cash.netCashMovementMinor)}.`
    : "Bu dönemde nakit hareketi kaydı yok.",
    ...(facts.cash.includesStandaloneEntries ? [`Bağımsız gider kayıtları ${tl(facts.cash.standaloneExpenseMinor)}.`]
      : ["Şubeye atanmamış nakit kayıtları dahil değildir."]));
  return rows.join("\n");
}
