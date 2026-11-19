import { registerOwnsOrder, replayLegacyCsv } from "./legacy-csv.js";
import { resolveBranch } from "./branches.js";
import { HttpError } from "./http.js";
import { date, identifier, integer, MAX_LINES, MAX_QUANTITY, MAX_STOCK, MAX_UNIT_MINOR, sku, text, today } from "./validate.js";
import { list, MANAGERS, rowExists, searchTerm, stableId, transact } from "./workspace.js";

export async function products(ctx) {
  const search = searchTerm(ctx.paramsUrl.get("q"));
  const archived = ctx.paramsUrl.get("archived") === "1";
  const costColumn = MANAGERS.includes(ctx.role) ? ", cost_minor" : "";
  const branch = ctx.paramsUrl.get("branchId");
  const branchId = branch == null ? null : await resolveBranch(ctx, branch);
  return list(ctx, `WITH scope(business_id, branch_id) AS (VALUES (?, ?))
    SELECT p.id, p.sku, p.name, p.category, p.price_minor,
      CASE WHEN scope.branch_id IS NULL THEN p.stock ELSE COALESCE(s.stock, 0) END AS stock,
      p.stock AS total_stock, p.reorder_at, p.active ${costColumn}
    FROM scope JOIN olvex_products p ON p.business_id = scope.business_id
    LEFT JOIN olvex_branch_stock s ON s.business_id = p.business_id AND s.product_id = p.id AND s.branch_id = scope.branch_id
    WHERE p.active >= ? AND (p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')
    ORDER BY p.active DESC, p.name COLLATE NOCASE, p.sku LIMIT ? OFFSET ?`, [branchId, archived ? 0 : 1, search, search]);
}

export async function stockHistory(ctx) {
  const productId = ctx.paramsUrl.get("product");
  const branch = ctx.paramsUrl.get("branchId");
  const branchId = branch == null ? null : await resolveBranch(ctx, branch);
  const query = searchTerm(ctx.paramsUrl.get("q"));
  return list(ctx, `SELECT m.id, m.kind, m.delta, m.note, m.created_at, m.branch_id, b.name AS branch_name, p.name, p.sku
    FROM olvex_stock_movements m JOIN olvex_products p
      ON p.business_id = m.business_id AND p.id = m.product_id
    JOIN olvex_branches b ON b.id = m.branch_id AND b.business_id = m.business_id
    WHERE m.business_id = ? AND (? IS NULL OR m.product_id = ?) AND (? IS NULL OR m.branch_id = ?)
      AND (p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR m.note LIKE ? ESCAPE '\\')
    ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`, [productId, productId, branchId, branchId, query, query, query]);
}

function stockStatement(ctx, id, productId, kind, delta, note, branchId) {
  return ctx.db.prepare(`INSERT INTO olvex_stock_movements
    (business_id, id, product_id, kind, delta, note, created_by, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(ctx.businessId, id, productId, kind, delta, note, ctx.actorId, branchId);
}

export async function saveProduct(ctx, body) {
  const requestId = identifier(body.requestId);
  const id = body.id ? identifier(body.id) : requestId;
  const data = {
    requestId, id,
    sku: sku(body.sku), name: text(body.name, "Ürün adı"),
    category: text(body.category, "Kategori", { min: 0, max: 60 }),
    price: integer(body.price, "Satış fiyatı", 0, MAX_UNIT_MINOR),
    cost: integer(body.cost, "Maliyet", 0, MAX_UNIT_MINOR),
    reorder: integer(body.reorder ?? 0, "Kritik stok eşiği", 0, MAX_STOCK),
    opening: body.id ? 0 : integer(body.opening ?? 0, "Açılış stoğu", 0, MAX_STOCK)
  };
  const values = [data.sku, data.name, data.category, data.price, data.cost, data.reorder];
  const { db, businessId } = ctx;
  const statements = body.id ? [
    db.prepare(`UPDATE olvex_products SET sku = ?, name = ?, category = ?, price_minor = ?, cost_minor = ?, reorder_at = ?
      WHERE business_id = ? AND id = ?`).bind(...values, businessId, id)
  ] : [
    db.prepare(`INSERT INTO olvex_products (business_id, id, sku, name, category, price_minor, cost_minor, reorder_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(businessId, id, ...values)
  ];
  if (data.opening) {
    const branchId = await resolveBranch(ctx, body.branchId);
    if (body.branchId != null) data.branchId = branchId;
    statements.push(stockStatement(ctx, requestId, id, "opening", data.opening, "Açılış stoğu", branchId));
  }
  return transact(ctx, body.id ? "product-update" : "product-create", data, statements,
    body.id ? rowExists("olvex_products", id) : undefined);
}

export function archiveProduct(ctx, body) {
  const id = identifier(body.id);
  const active = body.active === true ? 1 : 0;
  return transact(ctx, "product-visibility", { requestId: body.requestId, id, active }, [
    ctx.db.prepare("UPDATE olvex_products SET active = ? WHERE business_id = ? AND id = ?")
      .bind(active, ctx.businessId, id)
  ], rowExists("olvex_products", id, active ? "" : "AND stock = 0"));
}

export async function stockAdjustment(ctx, body) {
  const id = identifier(body.productId, "Ürün");
  const delta = integer(body.delta, "Stok farkı", -MAX_STOCK, MAX_STOCK);
  if (!delta) throw new HttpError(400, "Stok farkı sıfır olamaz.");
  const note = text(body.note, "Stok düzeltme nedeni", { max: 180 });
  const requestId = identifier(body.requestId);
  const branchId = await resolveBranch(ctx, body.branchId);
  const data = { requestId, id, delta, note, ...(body.branchId != null && { branchId }) };
  const guard = rowExists("olvex_products", id, "AND active = 1");
  guard.message = "Stok düzeltmesi için işletmenizdeki etkin bir ürünü seçin.";
  return transact(ctx, "stock-adjustment", data, [
    stockStatement(ctx, requestId, id, "adjustment", delta, note, branchId)
  ], guard);
}

export function orders(ctx, kind) {
  const query = searchTerm(ctx.paramsUrl.get("q"));
  const manager = MANAGERS.includes(ctx.role);
  return list(ctx, `SELECT o.id, o.branch_id, b.name AS branch_name, r.name AS register_name, o.source, o.reference, o.revision,
      o.occurred_on, o.paid_on, o.status, o.note, o.supplier, o.voided_on, c.name AS customer,
      o.source = 'csv' AND o.source_key = '' AND m.register_id IS NULL AS can_link_csv,
      SUM(i.quantity) = 0 AS fully_returned, COALESCE(SUM(i.quantity * i.unit_minor), 0) AS total_minor,
      json_group_array(json_object(${manager && kind === "sale" ? "'id', i.id, " : ""}'sku', i.product_sku,
        'name', i.product_name, 'quantity', i.quantity, 'sold', i.gross_quantity, 'returned', i.gross_quantity - i.quantity,
        'unit', i.unit_minor${manager ? ", 'cost', i.cost_minor" : ""})) AS items_json
    FROM olvex_orders o JOIN olvex_net_order_items i ON i.business_id = o.business_id AND i.order_id = o.id
    JOIN olvex_branches b ON b.business_id = o.business_id AND b.id = o.branch_id
    LEFT JOIN olvex_csv_receipt_matches m ON m.business_id = o.business_id AND m.order_id = o.id AND m.decision = 'same'
    LEFT JOIN olvex_pos_connections r ON r.business_id = o.business_id
      AND r.id = CASE WHEN o.source = 'pos' THEN o.source_key ELSE m.register_id END
    LEFT JOIN olvex_customers c ON c.business_id = o.business_id AND c.id = o.customer_id
    WHERE o.business_id = ? AND o.kind = ?
      AND (? = 0 OR (o.status = 'posted' AND o.paid_on IS NULL AND EXISTS (
        SELECT 1 FROM olvex_net_order_items unpaid WHERE unpaid.business_id = o.business_id
          AND unpaid.order_id = o.id AND unpaid.quantity > 0)))
      AND (COALESCE(o.reference, '') LIKE ? ESCAPE '\\' OR o.supplier LIKE ? ESCAPE '\\'
        OR COALESCE(c.name, '') LIKE ? ESCAPE '\\' OR o.note LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM olvex_order_items oi WHERE oi.business_id = o.business_id
          AND oi.order_id = o.id AND (oi.product_sku LIKE ? ESCAPE '\\' OR oi.product_name LIKE ? ESCAPE '\\')))
    GROUP BY o.business_id, o.id ORDER BY o.occurred_on DESC, o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`,
  [kind, ctx.paramsUrl.get("unpaid") === "1" ? 1 : 0, query, query, query, query, query, query]);
}

const lineSql = `
  INSERT INTO olvex_order_items
    (business_id, id, order_id, product_id, product_sku, product_name, quantity, unit_minor, cost_minor)
  SELECT ?, ?, ?, p.id, p.sku, p.name, ?, COALESCE(?, CASE ? WHEN 'sale' THEN p.price_minor ELSE p.cost_minor END),
         CASE ? WHEN 'sale' THEN p.cost_minor ELSE COALESCE(?, p.cost_minor) END
  FROM (SELECT 1) LEFT JOIN olvex_products p ON p.business_id = ? AND p.sku = ? AND p.active = 1`;

export async function createOrder(ctx, body, kind, source = "manual") {
  const { db, businessId, actorId, pos } = ctx;
  if (body.paid !== undefined && typeof body.paid !== "boolean") throw new HttpError(400, "Ödeme durumu geçersiz.");
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > MAX_LINES) {
    throw new HttpError(400, `1 ile ${MAX_LINES} arasında ürün satırı girin.`);
  }
  const reference = text(body.reference, "Referans", { min: source === "manual" ? 0 : 1, max: 100 }) || null;
  const requestId = source === "manual" ? identifier(body.requestId) :
    await stableId(JSON.stringify([businessId, pos?.id || source, kind, reference]));
  const occurredOn = date(body.date);
  if (occurredOn > today()) throw new HttpError(400, "İşlem tarihi bugünden ileri olamaz.");
  const items = body.lines.map((line) => {
    if (!line || typeof line !== "object") throw new HttpError(400, "Ürün satırı geçersiz.");
    return {
      sku: sku(line.sku),
      quantity: integer(line.quantity, "Adet", 1, MAX_QUANTITY),
      unit: line.unit == null && source === "manual" ? null : integer(line.unit, "Birim fiyat", 0, MAX_UNIT_MINOR)
    };
  }).sort((a, b) => a.sku.localeCompare(b.sku, "en") || (a.sku < b.sku ? -1 : Number(a.sku > b.sku)));
  if (new Set(items.map((item) => item.sku)).size !== items.length) {
    throw new HttpError(400, "Aynı SKU bir işlemde yalnızca bir satırda yer alabilir.");
  }

  const customerId = kind === "sale" && body.customerId ? identifier(body.customerId, "Müşteri") : null;
  const supplier = kind === "purchase" ? text(body.supplier, "Tedarikçi") : "";
  const note = text(body.note, "Not", { min: 0, max: 500 });
  const paidOn = body.paid === true ? occurredOn : null;
  const data = { requestId, source, reference, occurredOn, customerId, supplier, note, paidOn, items };

  const branchId = pos ? pos.branch_id : await resolveBranch(ctx, body.branchId);
  if (!pos && body.branchId != null) data.branchId = branchId;
  const statements = [
    db.prepare(`INSERT INTO olvex_orders (business_id, id, kind, source, source_key, reference, occurred_on,
      customer_id, supplier, note, paid_on, created_by, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(businessId, requestId, kind, source, pos?.id || "", reference, occurredOn, customerId, supplier, note, paidOn, actorId, branchId),
    ...items.map((item) => db.prepare(lineSql)
      .bind(businessId, crypto.randomUUID(), requestId, item.quantity, item.unit, kind, kind, item.unit, businessId, item.sku))
  ];
  let guard = customerId ? rowExists("olvex_customers", customerId, "AND active = 1") : undefined;
  if (source === "manual" && body.branchId == null) {
    const customerGuard = guard;
    guard = {
      sql: `NOT EXISTS (SELECT 1 FROM olvex_branches WHERE business_id = ? AND id <> ?)
        ${customerGuard ? "AND " + customerGuard.sql : ""}`,
      values: id => [id, branchId, ...(customerGuard ? customerGuard.values(id) : [])],
      message: "Birden çok şubeli işletmede işlem şubesini seçin ve müşteri kaydını kontrol edin."
    };
  }
  try {
    return await transact(ctx, `${kind}-create`, data, statements, guard);
  } catch (error) {
    if (pos && error.message?.includes("olvex_csv_history")) return replayLegacyCsv(ctx, data);
    throw error;
  }
}

// Register integrations without a revision always operate against the current receipt and return ledger.
const currentRevision = "(revision = ? OR (? = 1 AND source <> 'manual'))";

// Closing an order before a previously recorded return would contradict its payment history.
const afterReturns = `NOT EXISTS (SELECT 1 FROM olvex_returns r WHERE r.business_id = olvex_orders.business_id
  AND r.order_id = olvex_orders.id AND r.occurred_on > ?)`;

export function voidOrder(ctx, body, kind) {
  const id = identifier(body.id);
  const requestedDay = body.date == null ? null : date(body.date, "İade tarihi");
  const day = requestedDay || today();
  if (day > today()) throw new HttpError(400, "İade tarihi bugünden ileri olamaz.");
  const revision = integer(body.revision ?? 0, "Sürüm", 0, Number.MAX_SAFE_INTEGER);
  const checkPayment = body.expectedPaidOn !== undefined;
  const expectedPaidOn = body.expectedPaidOn == null ? null : date(body.expectedPaidOn, "Tahsilat tarihi");
  const posScope = ctx.pos ? registerOwnsOrder : "";
  const guard = rowExists("olvex_orders", id,
    `AND kind = ? AND ${currentRevision} AND status = 'posted' AND occurred_on <= ? AND (paid_on IS NULL OR paid_on <= ?)
      AND (? = 0 OR paid_on IS ?) AND ${afterReturns} ${posScope}`,
    kind, revision, Number(body.revision === undefined), day, day, Number(checkPayment), expectedPaidOn, day,
    ...(ctx.pos ? [ctx.pos.branch_id, ctx.pos.id, ctx.pos.id] : []));
  guard.message = ctx.pos
    ? "Bu kasanın satışını önce aktarın. İptal için satış açık olmalı ve iptal tarihi kayıtlı işlemlerden önce olmamalı."
    : "İptal uygulanamadı. Kaydın güncel durumunu ve iade tarihini kontrol edin.";
  const data = { requestId: body.requestId, id, date: requestedDay, revision: body.revision, expectedPaidOn: body.expectedPaidOn };
  return transact(ctx, `${kind}-void`, data, [
    ctx.db.prepare("UPDATE olvex_orders SET status = 'void', voided_by = ?, voided_on = ? WHERE business_id = ? AND id = ?")
      .bind(ctx.actorId, day, ctx.businessId, id)
  ], guard);
}

export function settleOrder(ctx, body, kind) {
  const id = identifier(body.id);
  const paidOn = date(body.date, "Ödeme tarihi");
  if (paidOn > today()) throw new HttpError(400, "Ödeme tarihi bugünden ileri olamaz.");
  const revision = integer(body.revision ?? 0, "Sürüm", 0, Number.MAX_SAFE_INTEGER);
  const guard = rowExists("olvex_orders", id,
    `AND kind = ? AND ${currentRevision} AND status = 'posted' AND paid_on IS NULL AND occurred_on <= ? AND ${afterReturns}
      AND EXISTS (SELECT 1 FROM olvex_net_order_items i WHERE i.business_id = olvex_orders.business_id
        AND i.order_id = olvex_orders.id AND i.quantity > 0)`,
    kind, revision, Number(body.revision === undefined), paidOn, paidOn);
  guard.message = "Ödeme uygulanamadı. Kaydın güncel durumunu ve ödeme tarihini kontrol edin.";
  return transact(ctx, `${kind}-settle`, { requestId: body.requestId, id, paidOn, revision: body.revision }, [
    ctx.db.prepare("UPDATE olvex_orders SET paid_on = ? WHERE business_id = ? AND id = ?")
      .bind(paidOn, ctx.businessId, id)
  ], guard);
}

export async function catalog(ctx) {
  const query = searchTerm(ctx.paramsUrl.get("q"));
  if (ctx.paramsUrl.get("type") === "customers") {
    return list(ctx, `SELECT id, name, email FROM olvex_customers WHERE business_id = ? AND active = 1
      AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY name, id LIMIT ? OFFSET ?`, [query, query]);
  }
  const branch = ctx.paramsUrl.get("branchId");
  const branchId = branch == null ? null : await resolveBranch(ctx, branch);
  return list(ctx, `WITH scope(business_id, branch_id) AS (VALUES (?, ?))
    SELECT p.id, p.name, p.sku, p.price_minor,
      CASE WHEN scope.branch_id IS NULL THEN p.stock ELSE COALESCE(s.stock, 0) END AS stock
    FROM scope JOIN olvex_products p ON p.business_id = scope.business_id
    LEFT JOIN olvex_branch_stock s ON s.business_id = p.business_id AND s.product_id = p.id AND s.branch_id = scope.branch_id
    WHERE p.active = 1 AND (p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')
    ORDER BY p.sku LIMIT ? OFFSET ?`, [branchId, query, query]);
}
