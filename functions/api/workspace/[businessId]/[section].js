import { beginCheckout, billingStatus, manageSubscription } from "../../../_lib/billing.js";
import { linkLegacyCsv } from "../../../_lib/legacy-csv.js";
import { importRegisterSale } from "../../../_lib/register.js";
import { createBranch, createTransfer, locations, transferHistory } from "../../../_lib/branches.js";
import { reconcilePos } from "../../../_lib/pos-identity.js";
import { handle, HttpError, json, readJson, sameOrigin } from "../../../_lib/http.js";
import { EVERY_ROLE, MANAGERS, OWNER, workspace } from "../../../_lib/workspace.js";
import { archiveProduct, catalog, createOrder, orders, products, saveProduct, settleOrder, stockAdjustment, stockHistory, voidOrder } from "../../../_lib/inventory.js";
import { archiveCustomer, archiveEmployee, cashEntries, completeTask, createCashEntry, createShift, customerHistory,
  customers, employees, invoices, removeShift, removeTask, saveCustomer, saveEmployee, saveInvoice, saveTask, shifts,
  taskDays, tasks, voidCash } from "../../../_lib/records.js";
import { branches, reports, overview, stockAlerts } from "../../../_lib/reports.js";
import { changeMember, createPos, invite, posConnections, rename, revokeInvite, revokePos, rotatePos, setPosIdentity, settings } from "../../../_lib/team.js";
import { aiDashboard, ask, resolveProposal } from "../../../_lib/ai.js";
import { editSale, saleEditHistory } from "../../../_lib/sale-edits.js";

const READ = {
  billing: [OWNER, billingStatus],
  "sale-edits": [MANAGERS, saleEditHistory],
  "stock-alerts": [EVERY_ROLE, stockAlerts],
  transfers: [EVERY_ROLE, transferHistory],
  overview: [EVERY_ROLE, overview],
  products: [EVERY_ROLE, products],
  stock: [EVERY_ROLE, stockHistory],
  catalog: [EVERY_ROLE, catalog],
  sales: [EVERY_ROLE, (ctx) => orders(ctx, "sale")],
  purchases: [MANAGERS, (ctx) => orders(ctx, "purchase")],
  customers: [EVERY_ROLE, customers],
  "customer-history": [EVERY_ROLE, customerHistory],
  finance: [MANAGERS, cashEntries],
  invoices: [MANAGERS, invoices],
  employees: [MANAGERS, employees],
  shifts: [MANAGERS, shifts],
  tasks: [EVERY_ROLE, tasks],
  "task-days": [EVERY_ROLE, taskDays],
  branches: [EVERY_ROLE, branches],
  locations: [EVERY_ROLE, locations],
  reports: [MANAGERS, reports],
  settings: [MANAGERS, settings],
  pos: [MANAGERS, posConnections],
  ai: [MANAGERS, aiDashboard]
};

const WRITE = {
  billing: {
    checkout: [OWNER, beginCheckout],
    refresh: [OWNER, manageSubscription],
    cancel: [OWNER, (ctx, data) => manageSubscription(ctx, data, true)]
  },
  products: {
    save: [MANAGERS, saveProduct],
    archive: [MANAGERS, archiveProduct]
  },
  stock: { adjust: [MANAGERS, stockAdjustment] },
  transfers: { create: [MANAGERS, createTransfer] },
  sales: {
    edit: [MANAGERS, editSale],
    create: [EVERY_ROLE, (ctx, data) => createOrder(ctx, data, "sale")],
    import: [MANAGERS, importRegisterSale],
    void: [MANAGERS, (ctx, data) => voidOrder(ctx, data, "sale")],
    settle: [MANAGERS, (ctx, data) => settleOrder(ctx, data, "sale")]
  },
  purchases: {
    create: [MANAGERS, (ctx, data) => createOrder(ctx, data, "purchase")],
    void: [MANAGERS, (ctx, data) => voidOrder(ctx, data, "purchase")],
    settle: [MANAGERS, (ctx, data) => settleOrder(ctx, data, "purchase")]
  },
  customers: {
    save: [EVERY_ROLE, saveCustomer],
    archive: [MANAGERS, archiveCustomer]
  },
  finance: { create: [MANAGERS, createCashEntry], void: [MANAGERS, voidCash] },
  invoices: { save: [MANAGERS, saveInvoice] },
  employees: { save: [MANAGERS, saveEmployee], archive: [MANAGERS, archiveEmployee] },
  shifts: { create: [MANAGERS, createShift], remove: [MANAGERS, removeShift] },
  tasks: {
    save: [EVERY_ROLE, saveTask],
    complete: [EVERY_ROLE, completeTask],
    remove: [EVERY_ROLE, removeTask]
  },
  settings: {
    rename: [OWNER, rename],
    invite: [OWNER, invite],
    "revoke-invite": [OWNER, revokeInvite],
    member: [OWNER, changeMember]
  },
  locations: { create: [MANAGERS, createBranch] },
  pos: {
    create: [MANAGERS, createPos], revoke: [MANAGERS, revokePos],
    rotate: [MANAGERS, rotatePos], identity: [MANAGERS, setPosIdentity], reconcile: [MANAGERS, reconcilePos],
    "link-csv": [MANAGERS, linkLegacyCsv]
  },
  ai: {
    ask: [MANAGERS, ask],
    apply: [MANAGERS, (ctx, data) => resolveProposal(ctx, data, true)],
    discard: [MANAGERS, (ctx, data) => resolveProposal(ctx, data, false)]
  }
};

export const onRequestGet = handle(async (context) => {
  const section = context.params.section;
  if (!Object.hasOwn(READ, section)) throw new HttpError(404, "Bölüm bulunamadı.");
  const [roles, action] = READ[section];
  const ctx = await workspace(context, roles);
  ctx.paramsUrl = new URL(context.request.url).searchParams;
  return json(await action(ctx));
});

export const onRequestPost = handle(async (context) => {
  sameOrigin(context.request);
  const section = context.params.section;
  const data = await readJson(context.request);
  if (typeof data.action !== "string") throw new HttpError(400, "Geçerli bir işlem adı gerekli.");
  if (!Object.hasOwn(WRITE, section) || !Object.hasOwn(WRITE[section], data.action)) {
    throw new HttpError(404, "İşlem bulunamadı.");
  }
  const [roles, action] = WRITE[section][data.action];
  const ctx = await workspace(context, roles);
  if (Object.hasOwn(data, "businessId") && data.businessId !== ctx.businessId) {
    throw new HttpError(403, "İstek işletmesi çalışma alanıyla uyuşmuyor.");
  }
  return json(await action(ctx, data));
});
