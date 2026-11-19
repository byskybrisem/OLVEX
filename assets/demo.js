import { bindDrawer, bindModuleSearch } from "./navigation.js";
import { bindSalesChart } from "./sales-chart.js";
import { newOrder, orderDetail } from "./orders.js";
import { renderers, views } from "./views.js";
import { offsetDay, today } from "./ui.js";

const now = today();
const products = [
  { id: "demo-p1", name: "Filtre Kahve 250 g", sku: "KAHVE-250", category: "Kahve",
    price_minor: 18990, cost_minor: 8900, stock: 16, reorder_at: 5, active: true },
  { id: "demo-p2", name: "Seramik Kupa", sku: "KUPA-01", category: "Aksesuar",
    price_minor: 12950, cost_minor: 6500, stock: 3, reorder_at: 5, active: true },
  { id: "demo-p3", name: "Çikolatalı Kurabiye", sku: "KURABIYE-01", category: "Atıştırmalık",
    price_minor: 5950, cost_minor: 2800, stock: 24, reorder_at: 6, active: true }
];
const customers = [
  { id: "demo-c1", name: "Ayşe Yılmaz", email: "ornek@example.com" },
  { id: "demo-c2", name: "Perakende müşteri", email: "" }
];
const sales = [
  { id: "demo-s1", occurred_on: now, customer: "Ayşe Yılmaz", reference: "DEMO-1001",
    product: products[0], quantity: 2, source: "manual", total_minor: 37980, status: "posted", paid_on: now },
  { id: "demo-s2", occurred_on: offsetDay(now, -1), customer: "Perakende",
    reference: "DEMO-1000", product: products[1], quantity: 1, source: "manual", total_minor: 12950, status: "posted", paid_on: null },
  { id: "demo-s3", occurred_on: offsetDay(now, -2), customer: "Perakende",
    reference: "DEMO-0999", product: products[2], quantity: 1, source: "manual", total_minor: 5950, status: "posted", paid_on: now }
];
const totals = {
  sales: sales.reduce((sum, row) => sum + row.total_minor, 0),
  cost: sales.reduce((sum, row) => sum + row.product.cost_minor * row.quantity, 0),
  revenue: sales.reduce((sum, row) => sum + (row.paid_on ? row.total_minor : 0), 0),
  spending: 15000, saleCount: sales.length
};
const state = {
  demo: true, manager: true, business: { id: "demo", name: "Örnek İşletme", role: "owner" },
  from: offsetDay(now, -6), to: now, q: "", archived: false, page: 1, chat: []
};
const notice = document.querySelector("#notice");
const content = document.querySelector("#content");
bindSalesChart(content);
const title = document.querySelector("#title");
const subtitle = document.querySelector("#subtitle");
const breadcrumb = document.querySelector("#breadcrumb");
const actionBar = document.querySelector("#actions");
const closeMenu = bindDrawer();
const visibleRoutes = new Set([...document.querySelectorAll("#sidebar [data-view]")].map(item => item.dataset.view));
bindModuleSearch(route => visibleRoutes.has(route));
document.querySelector("#module-search-open").disabled = false;

function showNotice(message, error = false) {
  notice.textContent = message;
  notice.classList.toggle("error", error);
  notice.hidden = !message;
}

const ctx = {
  manager: true,
  get: async (section, query = {}) => {
    if (section !== "catalog") throw new Error("Bu işlem demoda mevcut değil.");
    const isCustomers = query.type === "customers";
    const records = isCustomers ? customers : products;
    const q = String(query.q || "").trim().toLocaleLowerCase("tr-TR");
    return {
      rows: records.filter((item) =>
        [item.name, item.sku, item.email].filter(Boolean).some((value) =>
          value.toLocaleLowerCase("tr-TR").includes(q))),
      hasMore: false,
      page: 1
    };
  },
  post: async () => {
    throw new Error("Bu yalnızca örnek veri demosudur. Gerçek satış kaydedilmedi.");
  },
  changed: () => showNotice("Bu yalnızca demo; hiçbir gerçek kayıt oluşturulmadı."),
  notice: showNotice
};

function demoData(view) {
  const q = state.q.toLocaleLowerCase("tr-TR");
  if (view === "products") return {
    rows: products.filter((p) => [p.name, p.sku].some((v) =>
      v.toLocaleLowerCase("tr-TR").includes(q))),
    page: 1, hasMore: false
  };
  if (view === "sales") return {
    rows: sales.filter((s) => (!state.unpaid || !s.paid_on) && [s.customer, s.reference, s.product.name, s.product.sku].some((v) =>
      v.toLocaleLowerCase("tr-TR").includes(q))),
    page: 1, hasMore: false
  };
  if (view === "overview") return {
    totals,
    leaders: [
      {name:products[0].name, sales:37980, quantity:2},
      {name:products[1].name, sales:12950, quantity:1},
      {name:products[2].name, sales:5950, quantity:1}
    ],
    unpaid: { sale: 12950 }, receivables: sales.filter(row => !row.paid_on),
    latest: sales.map((s) => ({ occurred_on: s.occurred_on,
      reference: s.reference, total_minor: s.total_minor })),
    lowStock: [{ total: 1, name: "Seramik Kupa", sku: "KUPA-01", stock: 3 }],
    days: Array.from({ length: 7 }, (_, i) => {
      const day = offsetDay(now, i - 6);
      const receipts = sales.filter(row => row.occurred_on === day);
      const amount = receipts.reduce((sum, row) => sum + row.total_minor, 0);
      return { day, sales: amount, grossSales: amount, receipts: receipts.length, saleActivity: receipts.length > 0 };
    })
  };
  if (view === "ai") return {
    mode: "off", proposals: [],
    facts: {
      from: offsetDay(now, -6), to: now,
      totals,
      previousSales: 70000,
      lowStock: [{ name: "Seramik Kupa", sku: "KUPA-01", stock: 3 }],
      lowStockCount: 1,
      unpaid: { sale: 12950 }
    }
  };
  if (view === "finance") return {
    summary: {
      totals,
      days: [{ day: now, revenue: totals.revenue, spending: totals.spending }],
      unpaid: { sale: 12950, purchase: 0 }
    },
    rows: [{ occurred_on: now, description: "Kargo hizmeti", category: "Nakliye", kind: "expense", amount_minor: totals.spending }],
    hasMore: false, page: 1
  };
  return null;
}

let view;
function render() {
  const route = location.hash.slice(1);
  const next = visibleRoutes.has(route) ? route : "sales";
  if (next !== view) {
    state.q = "";
    state.unpaid = false;
    showNotice("");
  }
  view = next;
  const meta = views[view];
  title.textContent = breadcrumb.textContent = meta[0];
  subtitle.textContent = meta[1];
  document.title = meta[0] + " · Örnek işletme | OLVEX";
  document.querySelectorAll("[data-view]").forEach((item) => {
    const active = item.dataset.view === view;
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  actionBar.innerHTML = view === "sales" || view === "overview"
    ? '<button type="button" class="button primary" data-cmd="new-order">+ Yeni satış</button>'
    : "";
  try {
    content.innerHTML = renderers[view](demoData(view), state);
  } catch (error) {
    content.textContent = "Ön izleme oluşturulamadı: " + error.message;
    showNotice("Demo ekranında hata oluştu.", true);
  }
  content.setAttribute("aria-busy", "false");
  closeMenu();
}

document.querySelector("#avatar").textContent = "D";
document.querySelector("#user-name").textContent = "Demo Kullanıcısı";
document.querySelector("#user-role").textContent = "Örnek veriler";

window.addEventListener("hashchange", () => {
  render();
  title.focus({ preventScroll: true });
  window.scrollTo(0, 0);
});
document.addEventListener("click", (event) => {
  const cmd = event.target.closest("[data-cmd]");
  if (!cmd) return;
  if (cmd.dataset.cmd === "new-order") {
    newOrder(ctx, false);
    const save = document.querySelector("#editor-submit");
    save.disabled = true;
    save.textContent = "Demoda kayıt kapalı";
    return;
  }
  if (cmd.dataset.cmd === "order-detail") {
    const sale = sales.find(row => row.id === cmd.dataset.id);
    if (!sale) return;
    const {name, sku, price_minor, cost_minor} = sale.product;
    orderDetail(ctx, {...sale, items_json: JSON.stringify([{name, sku, unit: price_minor, cost: cost_minor, quantity: sale.quantity}])}, false);
  }
});
document.addEventListener("submit", (event) => {
  if (!event.target.matches("[data-filter]")) return;
  event.preventDefault();
  const fields = new FormData(event.target);
  state.q = String(fields.get("q") || "").trim();
  state.unpaid = fields.has("unpaid");
  render();
  content.querySelector('[name="q"]')?.focus();
});
render();
