import { MAX_LINES, MAX_QUANTITY, MAX_UNIT_MINOR, date, sku } from "../../functions/_lib/validate.js";

export const objectId = (value) => typeof value === "string" && /^[a-f0-9]{24}$/.test(value);

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function isoTime(value) {
  requireValue(typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value, "Posnic zaman damgası geçersiz.");
  return value;
}

export function branchDay(value, formatter) {
  return date(formatter.format(new Date(isoTime(value))));
}

function minorUnits(value) {
  requireValue((typeof value === "number" || typeof value === "string") &&
    /^\d+(\.\d+)?$/.test(String(value)), "Posnic tutarı geçersiz.");
  const [whole, fraction = ""] = String(value).split(".");
  requireValue(whole.length <= 15, "Posnic tutarı desteklenen sınırı aşıyor.");
  const [first, second, third] = fraction.padEnd(3, "0");
  const minor = Number(whole) * 100 + Number(first + second) + Number(third >= "5");
  requireValue(Number.isSafeInteger(minor), "Posnic tutarı desteklenen sınırı aşıyor.");
  return minor;
}

function stockQuantity(quantity, line) {
  const factor = line.unit_conversion?.factor ?? 1;
  requireValue(["number", "string"].includes(typeof quantity) &&
    ["number", "string"].includes(typeof factor) && Number(quantity) > 0 && Number(factor) > 0,
    "Posnic miktarı veya birim katsayısı geçersiz.");
  const result = Math.round(Number(quantity) * Number(factor) * 1e9) / 1e9;
  requireValue(Number.isInteger(result) && result >= 1 && result <= MAX_QUANTITY,
    "OLVEX için stok miktarı tam sayı ve desteklenen sınırda olmalı.");
  return result;
}

function aggregate(lines, hasPrice) {
  const totals = new Map();
  for (const { sku: code, quantity, amount } of lines) {
    const previous = totals.get(code) || { quantity: 0, amount: 0 };
    totals.set(code, { quantity: previous.quantity + quantity, amount: previous.amount + (amount ?? 0) });
  }
  requireValue(totals.size > 0 && totals.size <= MAX_LINES, "Posnic satır sayısı OLVEX sınırı dışında.");
  return [...totals].sort(([a], [b]) => a < b ? -1 : Number(a > b)).map(([code, { quantity, amount }]) => {
    requireValue(quantity <= MAX_QUANTITY, "SKU toplam miktarı OLVEX sınırını aşıyor.");
    const unit = amount / quantity;
    requireValue(!hasPrice || (Number.isSafeInteger(unit) && unit <= MAX_UNIT_MINOR),
      "SKU toplamı, OLVEX'te tam kuruşlu birim fiyata dönüştürülemiyor.");
    return { sku: code, quantity, ...(hasPrice && { unit }) };
  });
}

function originalLines(sale, returns) {
  const origin = sale.business_item_origin;
  requireValue(origin?.schemaVersion === 1 && origin.saleId === sale._id &&
    origin.branchId === sale.branch_id && origin.businessId === sale.license &&
    origin.invoiceDate === sale.date && Array.isArray(origin.lines),
  "İlk iade öncesine ait doğrulanabilir Posnic satış satırları bulunamadı.");
  // The snapshot stores item ID and selling unit. The sale/return lines carry
  // the historic SKU and conversion for that same identity.
  const evidence = [...sale.items, ...returns.flatMap(({ returnValue }) => returnValue)];
  const lines = origin.lines.map((original) => {
    const matches = evidence.filter((line) => (line.item_id ?? line.item) === original.itemId &&
      (line.item_unit ?? "qty") === original.unit);
    requireValue(matches.length > 0, "Özgün satış satırının SKU veya birim kanıtı eksik.");
    const codes = new Set(matches.map(line => sku(line.item_sku)));
    const quantities = new Set(matches.map(line => stockQuantity(original.quantity, line)));
    requireValue(codes.size === 1 && quantities.size === 1, "Özgün satış satırı birden fazla SKU veya miktarla eşleşiyor.");
    return { sku: [...codes][0], quantity: [...quantities][0], amount: minorUnits(original.grossAmount) };
  });
  return { lines, total: minorUnits(origin.salesTotal) };
}

export function returnBlocks(sale) {
  requireValue(Array.isArray(sale.items) && (sale.items_return == null || Array.isArray(sale.items_return)),
    "Posnic satış veya iade satırları geçersiz.");
  return (sale.items_return ?? []).map(block => {
    const value = block?.returnArray;
    requireValue(objectId(value?.returnObjId) && Array.isArray(value.returnValue),
      "Posnic iade bloğunun kalıcı kimliği veya satırları eksik.");
    isoTime(value.returnDate);
    return value;
  });
}

export function salePayload(sale, returns, formatter) {
  requireValue(["Paid", "Unpaid"].includes(sale.payment_status),
    "Posnic ödeme durumu OLVEX'in tam ödendi/ödenmedi sözleşmesine uymuyor.");
  const decision = sale.business_decision_receipt;
  const currencies = [...sale.items.map(line => line.pricing?.currency), decision && {
    currencyCode: decision.currency, currencyDigits: decision.currencyDigits,
  }].filter(Boolean);
  requireValue(currencies.every(value => (!value.currencyCode || value.currencyCode === "TRY") &&
    (value.currencyDigits == null || value.currencyDigits === 2)), "Yalnızca TRY ve iki ondalık basamaklı satış desteklenir.");
  const { lines, total } = returns.length ? originalLines(sale, returns) : {
    lines: sale.items.map(line => ({
      sku: sku(line.item_sku), quantity: stockQuantity(line.item_quantity ?? line.quantity, line),
      amount: minorUnits(line.total_amount ?? line.total),
    })),
    total: minorUnits(sale.sales_total),
  };
  const items = aggregate(lines, true);
  requireValue(items.reduce((sum, line) => sum + line.quantity * line.unit, 0) === total,
    "Posnic satış toplamı, OLVEX satır toplamıyla eşleşmiyor.");
  return {
    action: "sale", reference: `posnic:${sale._id}`, date: branchDay(sale.date, formatter),
    paid: sale.payment_status === "Paid", lines: items,
  };
}

export function returnPayload(salePayload, block, formatter) {
  const lines = aggregate(block.returnValue.map(line => ({
    sku: sku(line.item_sku), quantity: stockQuantity(line.item_quantity, line),
  })), false);
  const saleLines = new Map(salePayload.lines.map(line => [line.sku, line]));
  const amount = lines.reduce((sum, line) => {
    const original = saleLines.get(line.sku);
    requireValue(original && line.quantity <= original.quantity, "İade kalemi özgün satışla uyuşmuyor.");
    return sum + original.unit * line.quantity;
  }, 0);
  requireValue(amount === minorUnits(block.itemsTotalAmount), "Posnic iade tutarı OLVEX iade tutarıyla eşleşmiyor.");
  const day = branchDay(block.returnDate, formatter);
  requireValue(day >= salePayload.date, "Posnic iade tarihi satıştan önce.");
  return {
    action: "return", reference: `posnic:${block.returnObjId}`, saleReference: salePayload.reference,
    date: day, lines,
  };
}
