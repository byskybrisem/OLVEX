import { formCommand } from "./forms.js";
import { customerHistory, importSales, newOrder, orderCommand } from "./orders.js";
import { actions, renderers, roles, views } from "./views.js";
import { button, csvDownload, day, h, monthSpan, moveMonth, offsetDay, panel, request, today } from "./ui.js";

const $ = (selector) => document.querySelector(selector);
const content = $("#content");
const noticeBox = $("#notice");
const selector = $("#business");
const title = $("#title");
const sidebar = $("#sidebar");
const menu = $("#menu");
const backdrop = $("#backdrop");
const sectionsWithPeriod = new Set(["overview", "finance", "shifts", "branches", "reports"]);
const filters = new Map();
const conversations = new Map();
let user;
let businesses = [];
let business;
let view = "overview";
let data;
let revision = 0;
let product = "";
let productName = "";
let calendar = monthSpan(today());
let taskDay = "";

function appNotice(message = "", error = false) {
  noticeBox.textContent = message;
  noticeBox.classList.toggle("error", error);
  noticeBox.hidden = !message;
}

function localSelection(value) {
  try {
    const key = `olvex:business:${user.id}`;
    if (value) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function loginIfNeeded(error) {
  if (error.status === 401) {
    location.replace("/login.html");
    return true;
  }
  return false;
}

function viewManager() {
  return business.role === "owner" || business.role === "admin";
}

function viewFilter() {
  if (!filters.has(view)) {
    const end = view === "shifts" ? offsetDay(today(), 29) : today();
    const start = view === "shifts" ? today() : offsetDay(end, -29);
    filters.set(view, { page: 1, q: "", archived: false, from: start, to: end });
  }
  return filters.get(view);
}

function state() {
  return {
    ...viewFilter(), business, manager: viewManager(), product, productName, calendar, taskDay,
    chat: conversations.get(business.id) || []
  };
}

function basePath(businessId, section) {
  return `/api/workspace/${encodeURIComponent(businessId)}/${section}`;
}

function get(businessId, section, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") query.set(key, value);
  }
  const suffix = query.size ? "?" + query : "";
  return request(basePath(businessId, section) + suffix);
}

function commandContext() {
  const snapshot = state();
  const businessId = snapshot.business.id;
  return {
    ...snapshot,
    get: (section, params) => get(businessId, section, params),
    post: (section, action, body = {}) => request(basePath(businessId, section), "POST", { ...body, action }).catch((error) => {
      loginIfNeeded(error);
      throw error;
    }),
    notice: appNotice,
    async changed(message = "Kayıt güncellendi.") {
      appNotice(message);
      if (business.id === businessId) await load();
    },
    async refreshBusinesses(message) {
      const response = await request("/api/businesses");
      businesses = response.businesses;
      if (!businesses.length) {
        location.replace("/setup.html");
        return;
      }
      setBusiness(businesses.find((item) => item.id === businessId) || businesses[0], false);
      appNotice(message);
      await load();
    }
  };
}

function setBusiness(selected, reset = true) {
  business = selected;
  localSelection(selected.id);
  selector.replaceChildren(...businesses.map((item) => new Option(item.name, item.id)));
  selector.value = selected.id;
  selector.disabled = false;
  $("#workspace-name").textContent = selected.name;
  $("#user-role").textContent = roles[selected.role];
  for (const entry of sidebar.querySelectorAll("[data-manager]")) entry.hidden = !viewManager();
  if (reset) {
    filters.clear();
    product = "";
    productName = "";
    taskDay = "";
    data = null;
  }
}

function closeMenu(restoreFocus = false) {
  if (!sidebar.classList.contains("open")) return;
  sidebar.classList.remove("open");
  backdrop.hidden = true;
  menu.setAttribute("aria-expanded", "false");
  menu.setAttribute("aria-label", "Menüyü aç");
  if (restoreFocus) menu.focus();
}

menu.addEventListener("click", () => {
  if (sidebar.classList.contains("open")) {
    closeMenu();
    return;
  }
  sidebar.classList.add("open");
  backdrop.hidden = false;
  menu.setAttribute("aria-expanded", "true");
  menu.setAttribute("aria-label", "Menüyü kapat");
  selector.focus();
});
backdrop.addEventListener("click", () => closeMenu(true));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#editor").open) closeMenu(true);
});
$(".skip").addEventListener("click", (event) => {
  event.preventDefault();
  title.focus();
});

async function load() {
  const current = ++revision;
  const selected = state();
  const tab = view;
  const businessId = selected.business.id;
  const from = selected.from;
  const to = selected.to;
  const params = { page: selected.page, q: selected.q, archived: selected.archived ? "1" : "" };
  if (sectionsWithPeriod.has(tab)) Object.assign(params, { from, to });
  if (tab === "stock") params.product = product;
  if (tab === "tasks") Object.assign(params, taskDay ?
    { from: taskDay, to: taskDay, exact: "1" } : calendar);

  content.setAttribute("aria-busy", "true");
  content.innerHTML = panel("", '<p class="empty">Kayıtlar yükleniyor…</p>');
  data = null;
  try {
    const [result, additional] = await Promise.all([
      get(businessId, tab, params),
      tab === "finance" ? get(businessId, "overview", { from, to }) :
        tab === "tasks" ? get(businessId, "task-days", calendar) : null
    ]);
    if (current !== revision) return;
    data = result;
    if (tab === "finance") data.summary = additional;
    if (tab === "tasks") data.calendar = additional;
    content.innerHTML = renderers[tab](data, state());
    content.scrollTop = 0;
    const chat = content.querySelector(".chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  } catch (error) {
    if (current !== revision || loginIfNeeded(error)) return;
    content.innerHTML = panel("", `<p class="empty">${h(error.message)}</p>${button("Yeniden dene", "retry")}`);
  } finally {
    if (current === revision) content.setAttribute("aria-busy", "false");
  }
}

function navigate({ focus = false } = {}) {
  if (!business) return;
  const route = location.hash.slice(1);
  view = Object.hasOwn(views, route) && (!views[route][3] || viewManager()) ? route : "overview";
  if (view !== route) history.replaceState(null, "", `#${view}`);
  const [name, hint, parent] = views[view];
  title.textContent = name;
  $("#breadcrumb").textContent = name;
  $("#subtitle").textContent = hint;
  $("#actions").innerHTML = actions(view, state());
  document.title = `${name} | OLVEX`;
  for (const link of sidebar.querySelectorAll("[data-view]")) {
    if (link.dataset.view === (parent || view)) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  closeMenu();
  appNotice();
  if (focus) {
    title.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  load();
}

window.addEventListener("hashchange", () => navigate({ focus: true }));
sidebar.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (link && link.hash === location.hash) closeMenu(true);
});
selector.addEventListener("change", () => {
  const selected = businesses.find((item) => item.id === selector.value);
  if (!selected) return;
  setBusiness(selected);
  navigate({ focus: true });
});

$("#logout").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await request("/api/auth/logout", "POST", {});
    location.replace("/login.html");
  } catch (error) {
    button.disabled = false;
    appNotice(error.message, true);
  }
});

async function askAI(form) {
  const prompt = new FormData(form).get("prompt")?.trim();
  if (!prompt) return;
  const context = commandContext();
  const businessId = context.business.id;
  const chat = conversations.get(businessId) || [];
  const messages = [...chat, { role: "user", content: prompt }];
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  submit.textContent = "Yanıt bekleniyor…";
  appNotice();
  try {
    const result = await context.post("ai", "ask", { messages: messages.slice(-8) });
    conversations.set(businessId, [...messages, { role: "assistant", content: result.answer }].slice(-20));
    if (view === "ai" && business.id === businessId) {
      await load();
      content.querySelector("[name=prompt]")?.focus();
    }
  } catch (error) {
    if (view === "ai" && business.id === businessId) appNotice(error.message, true);
  } finally {
    submit.disabled = false;
    submit.textContent = "Gönder";
  }
}

content.addEventListener("submit", (event) => {
  const form = event.target;
  if (form.id === "ai-form") {
    event.preventDefault();
    askAI(form);
    return;
  }
  if (!form.hasAttribute("data-filter")) return;
  event.preventDefault();
  const fields = new FormData(form);
  const current = viewFilter();
  if (fields.get("from") && fields.get("from") > fields.get("to")) {
    appNotice("Başlangıç tarihi bitiş tarihinden sonra olamaz.", true);
    return;
  }
  Object.assign(current, {
    q: fields.get("q") || "", archived: fields.has("archived"),
    from: fields.get("from") || current.from, to: fields.get("to") || current.to, page: 1
  });
  appNotice();
  load();
});

function exportReport() {
  if (!data?.days) {
    appNotice("Rapor yüklenince tekrar deneyin.", true);
    return;
  }
  csvDownload(`olvex-rapor-${data.from}-${data.to}.csv`, [
    ["Tarih", "Satış sayısı", "Satış TL", "Satılan ürün maliyeti TL", "Brüt kâr TL", "Alış TL", "Nakit girişi TL", "Nakit çıkışı TL"],
    ...data.days.map((row) => [
      row.day, row.saleCount, row.sales / 100, row.cost / 100, (row.sales - row.cost) / 100,
      row.purchases / 100, row.revenue / 100, row.spending / 100
    ])
  ]);
}

function command(event) {
  const target = event.target.closest("[data-cmd]");
  if (!target || target.disabled) return;
  const { cmd, id } = target.dataset;
  if (cmd === "retry" && !business) return start();
  if (!business) return;
  const ctx = commandContext();
  const rows = [...(data?.rows || []), ...(data?.members || []), ...(data?.invites || []), ...(data?.proposals || [])];
  const row = id ? rows.find((item) => item.id === id) : undefined;
  switch (cmd) {
    case "retry": return load();
    case "page":
      viewFilter().page = Number(id);
      return load();
    case "new-order": return newOrder(ctx, view === "purchases");
    case "import-sales": return importSales(ctx);
    case "order-detail":
    case "settle-order":
    case "void-order":
      if (row) return orderCommand(ctx, row, cmd, view === "purchases");
      return;
    case "customer-history":
      if (row) return customerHistory(ctx, row);
      return;
    case "product-history":
      if (!row) return;
      product = id;
      productName = row.name;
      if (filters.has("stock")) filters.get("stock").page = 1;
      location.hash = "#stock";
      return;
    case "clear-product":
      product = productName = "";
      viewFilter().page = 1;
      return load();
    case "task-day":
      taskDay = taskDay === id ? "" : id;
      viewFilter().page = 1;
      return load();
    case "month":
      calendar = monthSpan(moveMonth(calendar.from, Number(id)));
      taskDay = "";
      viewFilter().page = 1;
      return load();
    case "switch-business":
      if (!row) return;
      setBusiness(businesses.find((item) => item.id === id));
      if (location.hash === "#overview") navigate({ focus: true });
      else location.hash = "#overview";
      return;
    case "export-report": return exportReport();
    default:
      if (!id || row) return formCommand(ctx, cmd, row, id);
  }
}

content.addEventListener("click", command);
$("#actions").addEventListener("click", command);

async function start() {
  $("#today").textContent = day(today());
  try {
    const [session, result] = await Promise.all([request("/api/auth/me"), request("/api/businesses")]);
    user = session.user;
    businesses = result.businesses;
    if (!businesses.length) {
      location.replace("/setup.html");
      return;
    }
    $("#user-name").textContent = user.fullName || user.email;
    $("#avatar").textContent = (user.fullName || user.email).trim().slice(0, 1).toLocaleUpperCase("tr-TR") || "O";
    const preferred = new URLSearchParams(location.search).get("business") || localSelection();
    setBusiness(businesses.find((item) => item.id === preferred) || businesses[0]);
    if (location.search) history.replaceState(null, "", location.pathname + location.hash);
    navigate();
  } catch (error) {
    if (loginIfNeeded(error)) return;
    content.setAttribute("aria-busy", "false");
    content.innerHTML = panel("", `<p class="empty">${h(error.message)}</p>${button("Yeniden dene", "retry")}`);
  }
}

start();
