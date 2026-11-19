import { HttpError } from "./http.js";
import { addDays, choice, date, email, identifier, integer, MAX_UNIT_MINOR, period, text, today } from "./validate.js";
import { list, rowExists, searchTerm, transact } from "./workspace.js";

function record(ctx, table, action, body, columns) {
  const { db, businessId } = ctx;
  const requestId = identifier(body.requestId);
  const id = body.id ? identifier(body.id) : requestId;
  const names = Object.keys(columns);
  const values = Object.values(columns);
  if (body.id) {
    return transact(ctx, `${action}-update`, { requestId, id, ...columns }, [
      db.prepare(`UPDATE ${table} SET ${names.map((name) => `${name} = ?`).join(", ")}
        WHERE business_id = ? AND id = ?`).bind(...values, businessId, id)
    ], rowExists(table, id));
  }
  return transact(ctx, `${action}-create`, { requestId, ...columns }, [
    db.prepare(`INSERT INTO ${table} (business_id, id, ${names.join(", ")})
      VALUES (?, ?, ${values.map(() => "?").join(", ")})`).bind(businessId, id, ...values)
  ]);
}

function setActive(ctx, table, action, body) {
  const id = identifier(body.id);
  const active = body.active === true ? 1 : 0;
  return transact(ctx, action, { requestId: body.requestId, id, active }, [
    ctx.db.prepare(`UPDATE ${table} SET active = ? WHERE business_id = ? AND id = ?`)
      .bind(active, ctx.businessId, id)
  ], rowExists(table, id));
}

export function customers(ctx) {
  const query = searchTerm(ctx.paramsUrl.get("q"));
  return list(ctx, `SELECT id, name, email, phone, notes, active FROM olvex_customers
    WHERE business_id = ? AND active >= ?
      AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')
    ORDER BY active DESC, name COLLATE NOCASE, id LIMIT ? OFFSET ?`,
  [ctx.paramsUrl.get("archived") === "1" ? 0 : 1, query, query, query]);
}

export function customerHistory(ctx) {
  const id = identifier(ctx.paramsUrl.get("id"), "Müşteri");
  return list(ctx, `SELECT o.id, o.occurred_on, o.reference, o.status, o.paid_on,
      SUM(i.quantity * i.unit_minor) AS total_minor
    FROM olvex_orders o JOIN olvex_net_order_items i ON o.business_id = i.business_id AND o.id = i.order_id
    WHERE o.business_id = ? AND o.customer_id = ? AND o.kind = 'sale'
    GROUP BY o.business_id, o.id ORDER BY o.occurred_on DESC, o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`, [id]);
}

export function saveCustomer(ctx, body) {
  return record(ctx, "olvex_customers", "customer", body, {
    name: text(body.name, "Müşteri adı"),
    email: email(body.email, true),
    phone: text(body.phone, "Telefon", { min: 0, max: 40 }),
    notes: text(body.notes, "Not", { min: 0, max: 500 })
  });
}

export const archiveCustomer = (ctx, body) => setActive(ctx, "olvex_customers", "customer-visibility", body);

export function cashEntries(ctx) {
  const { start, end } = period(ctx.paramsUrl);
  return list(ctx, `SELECT id, kind, description, category, amount_minor, occurred_on, voided_at
    FROM olvex_cash_entries WHERE business_id = ? AND occurred_on BETWEEN ? AND ?
    ORDER BY occurred_on DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`, [start, end]);
}

export function createCashEntry(ctx, body) {
  const requestId = identifier(body.requestId);
  const data = {
    requestId, kind: choice(body.kind, ["income", "expense"], "Kayıt türü"),
    description: text(body.description, "Açıklama", { max: 180 }),
    category: text(body.category, "Kategori", { min: 0, max: 80 }),
    amount: integer(body.amount, "Tutar", 1, MAX_UNIT_MINOR),
    occurredOn: date(body.date)
  };
  if (data.occurredOn > today()) throw new HttpError(400, "Nakit işlem tarihi bugünden ileri olamaz.");
  return transact(ctx, "cash-create", data, [cashInsert(ctx, requestId, data)]);
}

export function cashInsert(ctx, id, data) {
  return ctx.db.prepare(`INSERT INTO olvex_cash_entries (business_id, id, kind, description,
    category, amount_minor, occurred_on, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(ctx.businessId, id, data.kind, data.description, data.category, data.amount, data.occurredOn, ctx.actorId);
}

export function voidCash(ctx, body) {
  const id = identifier(body.id);
  return transact(ctx, "cash-void", { requestId: body.requestId, id }, [
    ctx.db.prepare("UPDATE olvex_cash_entries SET voided_at = CURRENT_TIMESTAMP WHERE business_id = ? AND id = ?")
      .bind(ctx.businessId, id)
  ], rowExists("olvex_cash_entries", id, "AND voided_at IS NULL"));
}

export function invoices(ctx) {
  const query = searchTerm(ctx.paramsUrl.get("q"));
  return list(ctx, `SELECT id, direction, number, counterparty, issued_on, due_on, amount_minor, status, note
    FROM olvex_invoices WHERE business_id = ?
      AND (number LIKE ? ESCAPE '\\' OR counterparty LIKE ? ESCAPE '\\')
    ORDER BY issued_on DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`, [query, query]);
}

export function saveInvoice(ctx, body) {
  const issuedOn = date(body.issuedOn, "Belge tarihi");
  const dueOn = body.dueOn ? date(body.dueOn, "Vade") : null;
  if (dueOn && dueOn < issuedOn) throw new HttpError(400, "Vade belge tarihinden önce olamaz.");
  return record(ctx, "olvex_invoices", "invoice", body, {
    direction: choice(body.direction, ["incoming", "outgoing"], "Belge yönü"),
    number: text(body.number, "Belge numarası", { max: 64 }),
    counterparty: text(body.counterparty, "Karşı taraf"),
    issued_on: issuedOn, due_on: dueOn,
    amount_minor: integer(body.amount, "Tutar", 0, 25_000_000_000_000),
    status: choice(body.status, ["open", "paid", "cancelled"], "Durum"),
    note: text(body.note, "Not", { min: 0, max: 500 })
  });
}

export function employees(ctx) {
  const query = searchTerm(ctx.paramsUrl.get("q"));
  return list(ctx, `SELECT id, name, job_title, active FROM olvex_employees
    WHERE business_id = ? AND active >= ? AND name LIKE ? ESCAPE '\\'
    ORDER BY active DESC, name COLLATE NOCASE, id LIMIT ? OFFSET ?`,
  [ctx.paramsUrl.get("archived") === "1" ? 0 : 1, query]);
}

export function saveEmployee(ctx, body) {
  return record(ctx, "olvex_employees", "employee", body, {
    name: text(body.name, "Çalışan adı"),
    job_title: text(body.title, "Görev", { min: 0, max: 80 })
  });
}

export const archiveEmployee = (ctx, body) => setActive(ctx, "olvex_employees", "employee-visibility", body);

export function shifts(ctx) {
  const { start, end } = period(ctx.paramsUrl);
  return list(ctx, `SELECT s.id, e.name, s.shift_on, s.start_time, s.end_time
    FROM olvex_shifts s JOIN olvex_employees e ON s.business_id = e.business_id AND s.employee_id = e.id
    WHERE s.business_id = ? AND s.shift_on BETWEEN ? AND ?
    ORDER BY s.shift_on, s.start_time, e.name, s.id LIMIT ? OFFSET ?`, [start, end]);
}

function time(value, label) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new HttpError(400, `${label} için geçerli bir saat girin.`);
  }
  return value;
}

export function createShift(ctx, body) {
  const data = {
    requestId: identifier(body.requestId), employee: identifier(body.employeeId, "Çalışan"),
    day: date(body.date), start: time(body.start, "Başlangıç"), end: time(body.end, "Bitiş")
  };
  if (data.start === data.end) throw new HttpError(400, "Başlangıç ve bitiş saati aynı olamaz.");
  return transact(ctx, "shift-create", data, [
    ctx.db.prepare(`INSERT INTO olvex_shifts (business_id, id, employee_id, shift_on, start_time, end_time)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(ctx.businessId, data.requestId, data.employee, data.day, data.start, data.end)
  ], rowExists("olvex_employees", data.employee, "AND active = 1"));
}

export function removeShift(ctx, body) {
  const id = identifier(body.id);
  return transact(ctx, "shift-remove", { requestId: body.requestId, id }, [
    ctx.db.prepare("DELETE FROM olvex_shifts WHERE business_id = ? AND id = ?").bind(ctx.businessId, id)
  ], rowExists("olvex_shifts", id));
}

export function tasks(ctx) {
  const { start, end } = period(ctx.paramsUrl);
  return list(ctx, `SELECT id, title, notes, due_on, repeat_rule, completed_at FROM olvex_tasks
    WHERE business_id = ? AND ((due_on BETWEEN ? AND ?) OR (? = 1 AND due_on < ? AND completed_at IS NULL))
    ORDER BY completed_at IS NOT NULL, due_on ASC, created_at DESC, id DESC LIMIT ? OFFSET ?`,
  [start, end, ctx.paramsUrl.get("exact") === "1" ? 0 : 1, start]);
}

export function saveTask(ctx, body) {
  const dueOn = date(body.date);
  const task = {
    title: text(body.title, "Görev adı", { max: 180 }),
    notes: text(body.notes, "Not", { min: 0, max: 500 }),
    due_on: dueOn, repeat_rule: choice(body.repeat, ["none", "daily", "weekly", "monthly"], "Tekrar"),
    repeat_day: Number(dueOn.slice(8))
  };
  if (!body.id) return record(ctx, "olvex_tasks", "task", body, task);
  const id = identifier(body.id);
  const guard = rowExists("olvex_tasks", id, "AND completed_at IS NULL");
  return transact(ctx, "task-update", { requestId: body.requestId, id, ...task }, [
    ctx.db.prepare(`UPDATE olvex_tasks SET title = ?, notes = ?, due_on = ?3, repeat_rule = ?4,
      repeat_day = CASE WHEN due_on = ?3 AND repeat_rule = 'monthly' AND ?4 = 'monthly'
        THEN repeat_day ELSE ? END
      WHERE business_id = ? AND id = ?`)
      .bind(...Object.values(task), ctx.businessId, id)
  ], guard);
}

function nextOccurrence(row) {
  if (row.repeat_rule === "daily") return addDays(row.due_on, 1);
  if (row.repeat_rule === "weekly") return addDays(row.due_on, 7);
  if (row.repeat_rule !== "monthly") return null;
  const current = new Date(row.due_on);
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(Date.UTC(year, month + 1, Math.min(lastDay, row.repeat_day))).toISOString().slice(0, 10);
}

export async function completeTask(ctx, body) {
  const id = identifier(body.id);
  const requestId = identifier(body.requestId);
  const row = await ctx.db.prepare("SELECT * FROM olvex_tasks WHERE business_id = ? AND id = ?")
    .bind(ctx.businessId, id).first();
  if (!row) throw new HttpError(404, "Görev bulunamadı.");
  const statements = [
    ctx.db.prepare("UPDATE olvex_tasks SET completed_at = CURRENT_TIMESTAMP WHERE business_id = ? AND id = ?")
      .bind(ctx.businessId, id)
  ];
  const next = nextOccurrence(row);
  if (next) {
    statements.push(ctx.db.prepare(`INSERT INTO olvex_tasks
      (business_id, id, title, notes, due_on, repeat_rule, repeat_day) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(ctx.businessId, requestId, row.title, row.notes, next, row.repeat_rule, row.repeat_day));
  }
  return transact(ctx, "task-complete", { requestId, id }, statements,
    rowExists("olvex_tasks", id, "AND completed_at IS NULL AND title = ? AND notes = ? AND due_on = ? AND repeat_rule = ? AND repeat_day = ?",
      row.title, row.notes, row.due_on, row.repeat_rule, row.repeat_day));
}

export function removeTask(ctx, body) {
  const id = identifier(body.id);
  return transact(ctx, "task-remove", { requestId: body.requestId, id }, [
    ctx.db.prepare("DELETE FROM olvex_tasks WHERE business_id = ? AND id = ?").bind(ctx.businessId, id)
  ], rowExists("olvex_tasks", id, "AND completed_at IS NULL"));
}

export async function taskDays(ctx) {
  const { start, end } = period(ctx.paramsUrl);
  const { results } = await ctx.db.prepare(`SELECT due_on AS day, COUNT(*) AS count FROM olvex_tasks
    WHERE business_id = ? AND due_on BETWEEN ? AND ? AND completed_at IS NULL GROUP BY due_on`)
    .bind(ctx.businessId, start, end).all();
  return { rows: results };
}
