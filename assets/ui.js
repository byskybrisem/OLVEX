const escaped = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const h = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => escaped[char]);
const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });
const quantity = new Intl.NumberFormat("tr-TR");
const dateFormat = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" });
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
});

export const money = (minor) => currency.format(Number(minor ?? 0) / 100);
export const count = (amount) => quantity.format(amount ?? 0);
export function day(iso) {
  if (!iso) return "—";
  // D1 CURRENT_TIMESTAMP values are UTC, with a space and no zone suffix.
  const value = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso)
    ? iso.replace(" ", "T") + "Z" : iso;
  return dateFormat.format(new Date(value));
}
export const today = () => dayFormat.format(new Date());

export function offsetDay(date, count) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
}

export function monthSpan(anchor) {
  const [year, month] = anchor.split("-").map(Number);
  return {
    from: `${anchor.slice(0, 7)}-01`,
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  };
}

export function moveMonth(anchor, delta) {
  const [year, month] = anchor.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 10);
}

export function toMinor(value, { optional = false } = {}) {
  const input = String(value).trim().replace(",", ".");
  if (!input && optional) return null;
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(input)) {
    throw new Error("Tutarı en fazla iki ondalık hane ile girin. Örnek 125,50.");
  }
  const [whole, fraction = ""] = input.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw new Error("Tutar üst sınırı aşıyor.");
  return minor;
}

export const fromMinor = (minor) => Number.isFinite(minor) ? (minor / 100).toFixed(2).replace(".", ",") : "";

export function whole(value, label) {
  if (!/^-?\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${label} için tam sayı girin.`);
  }
  return Number(value);
}

export function button(label, command, { id, kind = "", title = "", disabled = false } = {}) {
  return `<button type="button" class="button ${kind}" data-cmd="${h(command)}"${id == null ? "" : ` data-id="${h(id)}"`}${title ? ` title="${h(title)}"` : ""}${disabled ? " disabled" : ""}>${h(label)}</button>`;
}

export function link(label, href, kind = "") {
  return `<a class="button ${kind}" href="${h(href)}">${h(label)}</a>`;
}

export function badge(label, kind = "") {
  return `<span class="badge ${kind}">${h(label)}</span>`;
}

export function panel(title, inner, action = "") {
  return `<article class="glass panel">${title ? `<div class="panel-title"><h2>${h(title)}</h2>${action}</div>` : ""}${inner}</article>`;
}

export function empty(message) {
  return `<p class="empty">${h(message)}</p>`;
}

export function stat(label, value, tone = "") {
  return `<article class="glass panel stat ${tone}"><small>${h(label)}</small><strong>${h(value)}</strong></article>`;
}

export function rowName(name, subtitle = "") {
  return `<span class="row-name">${h(name)}</span>${subtitle ? `<span class="row-sub">${h(subtitle)}</span>` : ""}`;
}

export function table(columns, rows, placeholder) {
  if (!rows.length) return empty(placeholder || "Henüz kayıt yok.");
  return `<div class="data-table" tabindex="0" role="region" aria-label="Kayıt tablosu"><table><thead><tr>
    ${columns.map((col) => `<th scope="col">${h(col)}</th>`).join("")}</tr></thead><tbody>
    ${rows.map((row) => `<tr>${row.map((cell, i) => `<td data-label="${h(columns[i])}">${cell}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>`;
}

export function pagination(data) {
  if (!data?.hasMore && !(data?.page > 1)) return "";
  return `<nav class="pagination" aria-label="Tablo sayfaları">
    ${button("Önceki", "page", { id: data.page - 1, disabled: data.page <= 1, kind: "small" })}
    <span>Sayfa ${h(data.page)}</span>
    ${button("Sonraki", "page", { id: data.page + 1, disabled: !data.hasMore, kind: "small" })}
  </nav>`;
}

export function tabs(entries, active) {
  return `<nav class="tabs" aria-label="Bölüm sekmeleri">${entries.map(([name, id]) =>
    `<a class="button small ${id === active ? "current" : ""}" href="#${id}"${id === active ? ' aria-current="page"' : ""}>${h(name)}</a>`
  ).join("")}</nav>`;
}

export function periods(end = today(), upcoming = false) {
  const choices = [
    ["Bugün", end], ["Son 7 gün", offsetDay(end, -6)],
    ["Son 30 gün", offsetDay(end, -29)], ["Bu ay", monthSpan(end).from]
  ].map(([label, from]) => ({label, from, to: end}));
  if (upcoming) choices.push({label: "Gelecek 30 gün", from: end, to: offsetDay(end, 29)});
  return choices;
}

export function filters(state, { query = "", archive = false, range = false, unpaid = "" } = {}) {
  if (range && state.demo) return `<p class="hint">Örnek dönem · ${h(day(state.from))} – ${h(day(state.to))}</p>`;
  if (range) {
    const choices = periods(today(), state.view === "shifts");
    const active = choices.findIndex(item => item.from === state.from && item.to === state.to && (!state.periodLabel || item.label === state.periodLabel));
    return `<div class="period-bar"><label>Dönem <select data-period>
      ${choices.map((item, index) => `<option value="${index}" ${index === active ? "selected" : ""}>${item.label}</option>`).join("")}
      <option value="custom" ${active < 0 ? "selected" : ""}>Özel tarih</option></select></label>
      <span>${h(day(state.from))} – ${h(day(state.to))}</span>
      <form data-filter class="filters custom-period" ${active >= 0 ? "hidden" : ""}>
        <label>Başlangıç<input name="from" type="date" required value="${h(state.from)}"></label>
        <label>Bitiş<input name="to" type="date" required value="${h(state.to)}"></label>
        <button class="button" type="submit">Uygula</button></form></div>`;
  }
  return `<form class="glass panel filters" data-filter>
    ${query ? `<label>${h(query)}<input type="search" name="q" maxlength="80" value="${h(state.q)}" placeholder="Ara"></label>` : ""}
    ${archive ? `<label class="check"><input name="archived" type="checkbox"${state.archived ? " checked" : ""}> Arşivi de göster</label>` : ""}
    ${unpaid ? `<label class="check"><input name="unpaid" type="checkbox"${state.unpaid ? " checked" : ""}> ${h(unpaid)}</label>` : ""}
    <button type="submit" class="button small">Uygula</button>
  </form>`;
}

export async function request(path, method = "GET", body) {
  const response = await fetch(path, {
    method, credentials: "same-origin", cache: "no-store",
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== "object" || Array.isArray(data)) {
    const error = new Error(data?.error || "Bağlantı kurulamadı. Tekrar deneyin.");
    error.status = response.status;
    throw error;
  }
  return data;
}

export function randomSecret() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(value); return true; } catch {}
  }
  return false;
}

export function csvDownload(filename, rows) {
  const quote = (cell) => {
    const value = typeof cell === "number" ? String(cell).replace(".", ",") : String(cell ?? "");
    const safe = /^[\s]*[=+@-]/.test(value) && typeof cell !== "number" ? "'" + value : value;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const file = new Blob(["\ufeff", rows.map((row) => row.map(quote).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
