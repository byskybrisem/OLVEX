import { HttpError } from "./http.js";

export const MAX_UNIT_MINOR = 100_000_000;
export const MAX_STOCK = 10_000_000;
export const MAX_QUANTITY = 10_000;
export const MAX_LINES = 25;

export function text(value, label, { min = 1, max = 120 } = {}) {
  const normalized = value == null && min === 0 ? "" : typeof value === "string" ? value.trim() : null;
  if (normalized === null || normalized.length < min || normalized.length > max) {
    throw new HttpError(400, `${label} ${min}–${max} karakter arasında olmalı.`);
  }
  return normalized;
}

export function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${label} ${min} ile ${max} arasında bir tam sayı olmalı.`);
  }
  return value;
}

export function choice(value, allowed, label) {
  if (!allowed.includes(value)) throw new HttpError(400, `${label} geçersiz.`);
  return value;
}

export function identifier(value, label = "Kayıt kimliği") {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, `${label} geçersiz.`);
  }
  return value.toLowerCase();
}

export function email(value, optional = false) {
  const address = text(value, "E-posta", { min: optional ? 0 : 1, max: 254 }).toLowerCase();
  if ((address || !optional) && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
    throw new HttpError(400, "Geçerli bir e-posta adresi girin.");
  }
  return address;
}

export function date(value, label = "Tarih") {
  if (typeof value !== "string" || !/^2\d{3}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${label} geçersiz.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${label} geçersiz.`);
  }
  return value;
}

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
});

export function today() {
  return dayFormatter.format(new Date());
}

export function addDays(value, days) {
  const day = new Date(value);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

export function period(params) {
  const end = date(params.get("to") || today(), "Bitiş tarihi");
  const start = date(params.get("from") || addDays(end, -29), "Başlangıç tarihi");
  if (start > end || end > addDays(start, 365)) {
    throw new HttpError(400, "En fazla 366 günlük geçerli bir tarih aralığı seçin.");
  }
  return { start, end };
}

export function sku(value) {
  return text(value, "SKU", { max: 64 }).toUpperCase();
}
