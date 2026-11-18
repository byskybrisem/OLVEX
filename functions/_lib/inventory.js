import { HttpError } from "./http.js";
import { date, identifier, integer, MAX_LINES, MAX_QUANTITY, MAX_STOCK, MAX_UNIT_MINOR, sku, text, today } from "./validate.js";
import { list, MANAGERS, rowExists, searchTerm, stableId, transact } from "./workspace.js";

export async function products(ctx) {
  const search = searchTerm(ctx.paramsUrl.get("q"));
  const archived = ctx.paramsUrl.get("archived") === "1";
  const costColumn = MANAGERS.includes(ctx.role) ? ", cost_minor" : "";
  return list(ctx, `SELECT id, sku, name, category, price_minor, stock, reorder_at, active ${costColumn}
    FROM olvex_products
    WHERE business_id = ? AND active >= ? AND (name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\')
    ORDER BY active DESC, name COLLATE NOCASE, sku LIMIT ? OFFSET ?`, [archived ? 0 : 1, search, search]);
}

export function stockHistory(ctx) {
  const productId = ctx.paramsUrl.get("product");
  const query = searchTerm(ctx.paramsUrl.get("q"));
  return list(ctx, `SELECT m.id, m.kind, m.delta, m.note, m.created_at, p.name, p.sku
    FROM olvex_stock_movements m JOIN olvex_products p
      ON p.business_id = m.business_id AND p.id = m.product_id
    WHERE m.business_id = ? AND (? IS NULL OR m.product_id = ?)
      AND (p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR m.note LIKE ? ESCAPE '\\')
    ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`, [productId, productId, query, query, query]);
}

function stockStatement(ctx, id, productId, kind, delta, note) {
  return ctx.db.prepare(`INSERT INTO olvex_stock_movements
    (business_id, id, product_id, kind, delta, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(ctx.businessId, id, productId, kind, delta, note, ctx.actorId);
}

export function saveProduct(ctx, body) {
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
  if (data.opening) statements.push(stockStatement(ctx, requestId, id, "opening", data.opening, "Açılış stoğu"));
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

export function stockAdjustment(ctx, body) {
  const id = identifier(body.productId, "Ürün");
  const delta = integer(body.delta, "Stok farkı", -MAX_STOCK, MAX_STOCK);
  if (!delta) throw new HttpError(400, "Stok farkı sıfır olamaz.");
  const note = text(body.note, "Stok düzeltme nedeni", { max: 180 });
  const requestId = identifier(body.requestId);
  return transact(ctx, "stock-adjustment", { requestId, id, delta, note }, [
    stockStatement(ctx, requestId, id, "adjustment", delta, note)
  ]);
}

export function orders(ctx, kind) {
  const query = searchTerm(ctx.paramsUrl.get("q"));
  const manager = MANAGERS.includes(ctx.role);
  return list(ctx, `SELECT o.id, o.source, o.reference, o.occurred_on, o.paid_on, o.status,
      o.note, o.supplier, o.voided_on, c.name AS customer, COALESCE(SUM(i.quantity * i.unit_minor), 0) AS total_minor,
      json_group_array(json_object('sku', i.product_sku, 'name', i.product_name, 'quantity', i.quantity,
        'unit', i.unit_minor${manager ? ", 'cost', i.cost_minor" : ""})) AS items_json
    FROM olvex_orders o JOIN olvex_order_items i ON i.business_id = o.business_id AND i.order_id = o.id
    LEFT JOIN olvex_customers c ON c.business_id = o.business_id AND c.id = o.customer_id
    WHERE o.business_id = ? AND o.kind = ?
      AND (? = 0 OR (o.status = 'posted' AND o.paid_on IS NULL))
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

  const statements = [
    db.prepare(`INSERT INTO olvex_orders (business_id, id, kind, source, source_key, reference, occurred_on,
      customer_id, supplier, note, paid_on, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(businessId, requestId, kind, source, pos?.id || "", reference, occurredOn, customerId, supplier, note, paidOn, actorId),
    ...items.map((item) => db.prepare(lineSql)
      .bind(businessId, crypto.randomUUID(), requestId, item.quantity, item.unit, kind, kind, item.unit, businessId, item.sku))
  ];
  return transact(ctx, `${kind}-create`, data, statements, customerId ? rowExists("olvex_customers", customerId, "AND active = 1") : undefined);
}

export function voidOrder(ctx, body, kind) {
  const id = identifier(body.id);
  const requestedDay = body.date == null ? null : date(body.date, "İade tarihi");
  const day = requestedDay || today();
  if (day > today()) throw new HttpError(400, "İade tarihi bugünden ileri olamaz.");
  const guard = rowExists("olvex_orders", id,
    "AND kind = ? AND status = 'posted' AND occurred_on <= ? AND (paid_on IS NULL OR paid_on <= ?)", kind, day, day);
  guard.message = "Kayıt iptal edilmiş veya iade tarihi satış ya da ödeme tarihinden önce.";
  return transact(ctx, `${kind}-void`, { requestId: body.requestId, id, date: requestedDay }, [
    ctx.db.prepare("UPDATE olvex_orders SET status = 'void', voided_by = ?, voided_on = ? WHERE business_id = ? AND id = ?")
      .bind(ctx.actorId, day, ctx.businessId, id)
  ], guard);
}

export function settleOrder(ctx, body, kind) {
  const id = identifier(body.id);
  const paidOn = date(body.date, "Ödeme tarihi");
  if (paidOn > today()) throw new HttpError(400, "Ödeme tarihi bugünden ileri olamaz.");
  const guard = rowExists("olvex_orders", id, "AND kind = ? AND status = 'posted' AND paid_on IS NULL AND occurred_on <= ?", kind, paidOn);
  guard.message = "Ödenmemiş bir işlem seçin. Ödeme tarihi işlem tarihinden önce olamaz.";
  return transact(ctx, `${kind}-settle`, { requestId: body.requestId, id, paidOn }, [
    ctx.db.prepare("UPDATE olvex_orders SET paid_on = ? WHERE business_id = ? AND id = ?")
      .bind(paidOn, ctx.businessId, id)
  ], guard);
}

export function catalog(ctx) {
  const query = searchTerm(ctx.paramsUrl.get("q"));
  if (ctx.paramsUrl.get("type") === "customers") {
    return list(ctx, `SELECT id, name, email FROM olvex_customers WHERE business_id = ? AND active = 1
      AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY name, id LIMIT ? OFFSET ?`, [query, query]);
  }
  return list(ctx, `SELECT id, name, sku, price_minor, stock FROM olvex_products WHERE business_id = ? AND active = 1
    AND (name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\') ORDER BY sku LIMIT ? OFFSET ?`, [query, query]);
}
