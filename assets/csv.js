import { today, toMinor, whole } from "./ui.js";

function records(input, separator) {
  const output = [];
  let row = [];
  let value = "";
  let quoted = false;
  let closed = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        value += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else value += char;
    } else if (char === separator || char === "\r" || char === "\n") {
      row.push(value);
      value = "";
      closed = false;
      if (char !== separator) {
        if (char === "\r" && input[index + 1] === "\n") index++;
        output.push(row);
        row = [];
      }
    } else if (char === '"' && !value && !closed) {
      quoted = true;
    } else {
      if (closed || char === '"') throw new Error("CSV tırnaklarını kontrol edin.");
      value += char;
    }
  }
  if (quoted) throw new Error("CSV dosyasında açık tırnak var.");
  row.push(value);
  output.push(row);
  return output.filter((values) => values.some((entry) => entry.trim()));
}

export function parseSalesCsv(input) {
  const plain = input.replace(/^\ufeff/, "");
  const separator = plain.split(/\r?\n/, 1)[0].includes(";") ? ";" : ",";
  const [header, ...rows] = records(plain, separator);
  const expected = ["referans", "tarih", "sku", "adet", "birim_fiyat"];
  if (!header || header.length !== expected.length ||
      header.some((item, index) => item.trim().toLowerCase() !== expected[index])) {
    throw new Error("CSV başlıkları referans, tarih, sku, adet, birim_fiyat sırasıyla olmalı.");
  }
  if (!rows.length) throw new Error("CSV dosyasında satış satırı yok.");

  const orders = new Map();
  for (const [index, row] of rows.entries()) {
    const lineNumber = index + 2;
    try {
      if (row.length !== 5) throw new Error("Beş sütun olmalı.");
      const [reference, day, sku, qty, price] = row.map((value) => value.trim());
      if (!reference || reference.length > 100 || !sku || sku.length > 64) throw new Error("Referans ve SKU gerekli.");
      const parsed = new Date(day);
      if (!/^2\d{3}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(+parsed) ||
          parsed.toISOString().slice(0, 10) !== day || day > today()) throw new Error("Tarih geçersiz.");
      const quantity = whole(qty, "Adet");
      const unit = toMinor(price);
      if (quantity < 1 || quantity > 10000 || unit > 100000000) throw new Error("Adet veya fiyat sınırı aşılıyor.");
      if (!orders.has(reference)) orders.set(reference, { reference, date: day, lines: [] });
      const sale = orders.get(reference);
      if (sale.date !== day) throw new Error("Aynı referansın tarihleri farklı.");
      const code = sku.toUpperCase();
      if (sale.lines.some((line) => line.sku === code)) throw new Error("Bu SKU aynı referansta tekrar ediyor.");
      if (sale.lines.length >= 25) throw new Error("Bir satışta en fazla 25 ürün olabilir.");
      sale.lines.push({ sku: code, quantity, unit });
    } catch (error) {
      throw new Error(`${lineNumber}. CSV kaydı: ${error.message}`);
    }
  }
  return [...orders.values()];
}
