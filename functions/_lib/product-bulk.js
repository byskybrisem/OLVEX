
import { resolveBranch } from "./branches.js";
import { HttpError } from "./http.js";
import {
  identifier, integer, MAX_STOCK,
  MAX_UNIT_MINOR, sku, text
} from "./validate.js";
import { stableId, transact } from "./workspace.js";

const MAX_BATCH_SIZE = 25;

export async function importProducts(ctx, body) {
  const requestId = identifier(
    body.requestId, "İstek kimliği"
  );

  if (
    !Array.isArray(body.items) ||
    body.items.length < 1 ||
    body.items.length > MAX_BATCH_SIZE
  ) {
    throw new HttpError(
      400,
      `Her aktarımda 1–${MAX_BATCH_SIZE} ürün olmalı.`
    );
  }

  const branchId = await resolveBranch(ctx, body.branchId);
  const seen = new Set();
  const items = [];
  const statements = [];

  for (let index = 0; index < body.items.length; index++) {
    const raw = body.items[index];

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new HttpError(
        400,
        `${index + 1}. satır geçerli bir ürün olmalı.`
      );
    }

    const id = await stableId(JSON.stringify([
      "bulk-product", ctx.businessId, requestId, index
    ]));

    const givenSku =
      typeof raw.sku === "string" ? raw.sku.trim() : "";

    const product = {
      id,
      sku: givenSku
        ? sku(givenSku)
        : `TMP-${id.replace(/-/g, "").slice(0, 16).toUpperCase()}`,
      name: text(raw.name, `${index + 1}. satır ürün adı`),
      category: text(raw.category ?? "", "Kategori", {
        min: 0, max: 60
      }),
      price: integer(
        raw.price, "Satış fiyatı (kuruş)", 0, MAX_UNIT_MINOR
      ),
      cost: integer(
        raw.cost ?? 0, "Birim maliyet (kuruş)", 0, MAX_UNIT_MINOR
      ),
      reorder: integer(
        raw.reorder ?? 0, "Kritik stok eşiği", 0, MAX_STOCK
      ),
      opening: integer(
        raw.opening ?? 0, "Açılış stoğu", 0, MAX_STOCK
      )
    };

    if (seen.has(product.sku)) {
      throw new HttpError(
        400,
        `${product.sku} kodu dosyada birden fazla kez bulunuyor.`
      );
    }

    seen.add(product.sku);
    items.push(product);

    statements.push(
      ctx.db.prepare(`
        INSERT INTO olvex_products
        (
          business_id, id, sku, name, category,
          price_minor, cost_minor, reorder_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        ctx.businessId,
        id,
        product.sku,
        product.name,
        product.category,
        product.price,
        product.cost,
        product.reorder
      )
    );

    if (product.opening > 0) {
      const movementId = await stableId(JSON.stringify([
        "bulk-opening", ctx.businessId, requestId, index
      ]));

      statements.push(
        ctx.db.prepare(`
          INSERT INTO olvex_stock_movements
          (
            business_id, id, product_id, kind,
            delta, note, created_by, branch_id
          )
          VALUES (?, ?, ?, 'opening', ?, ?, ?, ?)
        `).bind(
          ctx.businessId,
          movementId,
          id,
          product.opening,
          "Toplu ürün aktarımı",
          ctx.actorId,
          branchId
        )
      );
    }
  }

  const result = await transact(
    ctx,
    "product-bulk-import",
    { requestId, branchId, items },
    statements
  );

  return { ...result, count: items.length };
}
