import { addDays, period, today } from "./validate.js";
import { MANAGERS } from "./workspace.js";

const blank = () => ({ sales: 0, saleCount: 0, cost: 0, purchases: 0, revenue: 0, spending: 0 });

export async function financials(ctx, start, end) {
  const { db, businessId } = ctx;
  const groups = await db.batch([
    db.prepare(`SELECT o.occurred_on AS day, o.kind, COUNT(DISTINCT o.id) AS orders,
       SUM(i.quantity * i.unit_minor) AS amount, SUM(i.quantity * i.cost_minor) AS cost
       FROM olvex_orders o JOIN olvex_order_items i ON o.business_id = i.business_id AND o.id = i.order_id
       WHERE o.business_id = ? AND o.status = 'posted' AND o.occurred_on BETWEEN ? AND ?
       GROUP BY o.occurred_on, o.kind`).bind(businessId, start, end),
    db.prepare(`SELECT o.paid_on AS day, o.kind, SUM(i.quantity * i.unit_minor) AS amount
       FROM olvex_orders o JOIN olvex_order_items i ON o.business_id = i.business_id AND o.id = i.order_id
       WHERE o.business_id = ? AND o.paid_on BETWEEN ? AND ?
       GROUP BY o.paid_on, o.kind`).bind(businessId, start, end),
    db.prepare(`SELECT occurred_on AS day, kind, SUM(amount_minor) AS amount FROM olvex_cash_entries
       WHERE business_id = ? AND voided_at IS NULL AND occurred_on BETWEEN ? AND ?
       GROUP BY occurred_on, kind`).bind(businessId, start, end),
    db.prepare(`SELECT o.voided_on AS day, o.kind, SUM(i.quantity * i.unit_minor) AS amount
       FROM olvex_orders o JOIN olvex_order_items i ON o.business_id = i.business_id AND o.id = i.order_id
       WHERE o.business_id = ? AND o.status = 'void' AND o.paid_on IS NOT NULL AND o.voided_on BETWEEN ? AND ?
       GROUP BY o.voided_on, o.kind`).bind(businessId, start, end)
  ]);
  const days = new Map();
  for (let day = start; day <= end; day = addDays(day, 1)) days.set(day, { day, ...blank() });

  for (const row of groups[0].results) {
    const day = days.get(row.day);
    if (row.kind === "sale") {
      day.sales += row.amount;
      day.saleCount += row.orders;
      day.cost += row.cost;
    } else day.purchases += row.amount;
  }
  for (const row of groups[1].results) days.get(row.day)[row.kind === "sale" ? "revenue" : "spending"] += row.amount;
  for (const row of groups[2].results) days.get(row.day)[row.kind === "income" ? "revenue" : "spending"] += row.amount;
  for (const row of groups[3].results) days.get(row.day)[row.kind === "sale" ? "spending" : "revenue"] += row.amount;

  const totals = blank();
  for (const day of days.values()) {
    for (const key of Object.keys(totals)) totals[key] += day[key];
  }

  return { totals, days: [...days.values()] };
}

export async function summary(ctx) {
  const { start, end } = period(ctx.paramsUrl);
  const manager = MANAGERS.includes(ctx.role);
  const scope = [ctx.businessId, start, end];
  const [{ totals, days }, results] = await Promise.all([
    financials(ctx, start, end),
    ctx.db.batch([
      ctx.db.prepare(`SELECT id, sku, name, stock, reorder_at, COUNT(*) OVER () as total
        FROM olvex_products WHERE business_id = ? AND active = 1 AND stock <= reorder_at
        ORDER BY stock, name, id LIMIT 8`).bind(ctx.businessId),
      ctx.db.prepare(`SELECT o.id, o.occurred_on, o.reference, SUM(i.quantity * i.unit_minor) AS total_minor
        FROM olvex_orders o JOIN olvex_order_items i ON o.business_id = i.business_id AND o.id = i.order_id
        WHERE o.business_id = ? AND o.status = 'posted' AND o.kind = 'sale' AND o.occurred_on BETWEEN ? AND ?
        GROUP BY o.business_id, o.id ORDER BY o.occurred_on DESC, o.created_at DESC, o.id DESC LIMIT 6`).bind(...scope),
      ctx.db.prepare(`SELECT kind, SUM(i.quantity * i.unit_minor) AS total_minor
        FROM olvex_orders o JOIN olvex_order_items i ON o.business_id = i.business_id AND o.id = i.order_id
        WHERE o.business_id = ? AND o.status = 'posted' AND o.paid_on IS NULL GROUP BY kind`).bind(ctx.businessId),
      ...(manager ? [ctx.db.prepare(`SELECT o.occurred_on, o.reference, c.name AS customer, SUM(i.quantity * i.unit_minor) AS total_minor
        FROM olvex_orders o JOIN olvex_order_items i ON o.business_id = i.business_id AND o.id = i.order_id
        LEFT JOIN olvex_customers c ON c.business_id = o.business_id AND c.id = o.customer_id
        WHERE o.business_id = ? AND o.kind = 'sale' AND o.status = 'posted' AND o.paid_on IS NULL
        GROUP BY o.id ORDER BY o.occurred_on, o.id LIMIT 5`).bind(ctx.businessId)] : [])
    ])
  ]);
  const [lowStock, latest, unpaid, receivables] = results.map((result) => result.results);
  const sums = manager ? totals : { sales: totals.sales, saleCount: totals.saleCount };
  return {
    from: start, to: end, totals: sums, lowStock, latest, receivables,
    days: manager ? days : days.map(({ day, sales, saleCount }) => ({ day, sales, saleCount })),
    unpaid: manager ? Object.fromEntries(unpaid.map((row) => [row.kind, row.total_minor])) : null
  };
}

export async function reports(ctx) {
  const result = await summary(ctx);
  const { results } = await ctx.db.prepare(`
    SELECT i.product_id AS id, p.sku, p.name, SUM(i.quantity) AS quantity,
      SUM(i.quantity * i.unit_minor) AS sales, SUM(i.quantity * i.cost_minor) AS cost
    FROM olvex_orders o JOIN olvex_order_items i ON o.business_id = i.business_id AND o.id = i.order_id
    JOIN olvex_products p ON p.business_id = i.business_id AND p.id = i.product_id
    WHERE o.business_id = ? AND o.status = 'posted' AND o.kind = 'sale' AND o.occurred_on BETWEEN ? AND ?
    GROUP BY i.product_id ORDER BY sales DESC, p.sku LIMIT 20
  `).bind(ctx.businessId, result.from, result.to).all();
  return { ...result, topProducts: results };
}

export async function branches(ctx) {
  const { start, end } = period(ctx.paramsUrl);
  const { results } = await ctx.db.prepare(`
    SELECT b.id, b.name, m.role, COUNT(DISTINCT o.id) AS sale_count,
      COALESCE(SUM(i.quantity * i.unit_minor), 0) AS sales
    FROM business_members m JOIN businesses b ON b.id = m.business_id
    LEFT JOIN olvex_orders o ON o.business_id = b.id AND o.kind = 'sale' AND o.status = 'posted'
      AND o.occurred_on BETWEEN ? AND ?
    LEFT JOIN olvex_order_items i ON i.business_id = o.business_id AND i.order_id = o.id
    WHERE m.user_id = ?
    GROUP BY b.id ORDER BY b.name COLLATE NOCASE, b.id
  `).bind(start, end, ctx.user.id).all();
  return { rows: results };
}

export async function insights(ctx) {
  const end = today();
  const start = addDays(end, -6);
  const [current, previous] = await Promise.all([
    summary({ ...ctx, paramsUrl: new URLSearchParams({ from: start, to: end }) }),
    financials(ctx, addDays(start, -7), addDays(start, -1))
  ]);
  return {
    from: start, to: end, totals: current.totals, previousSales: previous.totals.sales,
    lowStock: current.lowStock.map(({ sku, name, stock, reorder_at }) => ({ sku, name, stock, reorder_at })),
    lowStockCount: current.lowStock[0]?.total ?? 0, unpaid: current.unpaid
  };
}
