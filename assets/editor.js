import { h, toMinor, whole } from "./ui.js";

const dialog = document.querySelector("#editor");
const form = document.querySelector("#editor-form");
const title = document.querySelector("#editor-title");
const content = document.querySelector("#editor-content");
const error = document.querySelector("#editor-message");
const save = document.querySelector("#editor-submit");
const cancel = document.querySelector("#editor-cancel");
const close = document.querySelector("#editor-close");
let active;
let busy = false;

cancel.addEventListener("click", () => dialog.close());
close.addEventListener("click", () => dialog.close());
dialog.addEventListener("cancel", (event) => {
  if (busy) event.preventDefault();
});
dialog.addEventListener("close", () => {
  if (dialog.open) return;
  active = null;
  content.replaceChildren();
});

function setError(message) {
  error.textContent = message;
  error.hidden = !message;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!active?.submit || busy) return;
  const job = active;
  busy = true;
  save.disabled = cancel.disabled = close.disabled = true;
  save.textContent = "Kaydediliyor…";
  setError("");
  const formData = new FormData(form);
  const send = (section, action, values) => {
    const signature = JSON.stringify([section, action, values]);
    if (signature !== job.signature) {
      job.signature = signature;
      job.requestId = crypto.randomUUID();
    }
    return job.ctx.post(section, action, { ...values, requestId: job.requestId });
  };

  let result;
  let saved = false;
  try {
    result = await job.submit(formData, send, content);
    saved = true;
  } catch (failure) {
    setError(failure.message || "İşlem tamamlanamadı.");
  } finally {
    busy = false;
    save.disabled = cancel.disabled = close.disabled = false;
    save.textContent = job.label;
  }
  if (saved) {
    dialog.close();
    if (job.done) {
      try { await job.done(result); } catch (failure) { job.ctx.notice(failure.message, true); }
    }
  }
});

export function editor(ctx, options) {
  const job = { ctx, label: "Kaydet", ...options };
  active = job;
  title.textContent = job.title;
  content.innerHTML = job.html;
  setError("");
  save.textContent = job.label;
  save.hidden = !job.submit;
  cancel.textContent = job.submit ? "Vazgeç" : "Kapat";
  if (!dialog.open) dialog.showModal();
  content.querySelector("input:not([readonly]), textarea, select")?.focus();
  job.init?.(content);
}

export const field = (label, name, value = "", opts = {}) => {
  const { type = "text", required = true, max = 120, extra = "" } = opts;
  return `<label class="field">${h(label)}<input name="${h(name)}" type="${h(type)}" value="${h(value)}"
    maxlength="${max}"${required ? " required" : ""} ${extra}></label>`;
};

export const note = (label, name, value = "") => `<label class="field">${h(label)}
  <textarea name="${h(name)}" rows="3" maxlength="500">${h(value)}</textarea></label>`;

export const select = (label, name, values, current = "", required = false) => `<label class="field">${h(label)}
  <select name="${h(name)}"${required ? " required" : ""}>${values.map(([value, label]) =>
    `<option value="${h(value)}"${value === current ? " selected" : ""}>${h(label)}</option>`
  ).join("")}</select></label>`;

export const check = (label, name, enabled = false) => `<label class="check">
  <input type="checkbox" name="${h(name)}"${enabled ? " checked" : ""}>${h(label)}</label>`;

export const fields = (...contents) => `<div class="field-grid">${contents.join("")}</div>`;

export const amount = (label, name, value = "", opts = {}) =>
  field(label, name, value, { ...opts, max: 18, extra: 'inputmode="decimal" placeholder="0,00"' });

export const intField = (label, name, value = "", opts = {}) =>
  field(label, name, value, { ...opts, max: 9, extra: 'inputmode="numeric"' });

export const readAmount = (form, name, optional = false) => toMinor(form.get(name), { optional });

export const readInt = (form, name, label) => whole(form.get(name), label);

export function confirm(ctx, { title, message, section, action, data, label = "Onayla", after }) {
  editor(ctx, {
    title, label, html: `<p>${h(message)}</p>`,
    submit: (_form, send) => send(section, action, data),
    done: after || (() => ctx.changed())
  });
}
