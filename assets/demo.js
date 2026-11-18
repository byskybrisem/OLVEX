import { bindSalesChart } from "./sales-chart.js";
import { newOrder } from "./orders.js";
import { actions, renderers, views } from "./views.js";
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
    source: "manual", total_minor: 37980, status: "posted", paid_on: now },
  { id: "demo-s2", occurred_on: offsetDay(now, -1), customer: "Perakende",
    reference: "DEMO-1000", source: "manual", total_minor: 12950, status: "posted", paid_on: null },
  { id: "demo-s3", occurred_on: offsetDay(now, -2), customer: "Perakende",
    reference: "DEMO-0999", source: "manual", total_minor: 5950, status: "posted", paid_on: now }
];
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
const sidebar = document.querySelector("#sidebar");
const menu = document.querySelector("#menu");
const backdrop = document.querySelector("#backdrop");

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
    rows: sales.filter((s) => [s.customer, s.reference].some((v) =>
      v.toLocaleLowerCase("tr-TR").includes(q))),
    page: 1, hasMore: false
  };
  if (view === "overview") return {
    totals: { sales: 56880, cost: 25900, revenue: 43930, spending: 15000, saleCount: 3 },
    unpaid: { sale: 12950 }, receivables: sales.filter(row => !row.paid_on),
    latest: sales.map((s) => ({ occurred_on: s.occurred_on,
      reference: s.reference, total_minor: s.total_minor })),
    lowStock: [{ total: 1, name: "Seramik Kupa", sku: "KUPA-01", stock: 3 }],
    days: Array.from({ length: 7 }, (_, i) => ({
      day: offsetDay(now, i - 6),
      sales: [0, 5950, 0, 12950, 0, 0, 37980][i]
    }))
  };
  if (view === "ai") return {
    mode: "off", proposals: [],
    facts: {
      from: offsetDay(now, -6), to: now,
      totals: { sales: 56880, revenue: 43930, spending: 15000 },
      previousSales: 70000,
      lowStock: [{ name: "Seramik Kupa", sku: "KUPA-01", stock: 3 }],
      lowStockCount: 1,
      unpaid: { sale: 12950 }
    }
  };
  if (view === "finance") return {
    summary: {
      totals: { sales: 56880, revenue: 43930, spending: 15000 },
      unpaid: { sale: 12950, purchase: 0 }
    },
    rows: [], hasMore: false, page: 1
  };
  return null;
}

function closeMenu() {
  sidebar.classList.remove("open");
  document.body.classList.remove("menuopen");
  menu.setAttribute("aria-expanded", "false");
  backdrop.hidden = true;
}

function render() {
  const selected = location.hash.slice(1);
  const view = ["sales", "products", "ai", "overview", "finance"].includes(selected)
    ? selected : "sales";
  const meta = views[view];
  title.textContent = breadcrumb.textContent = meta[0];
  subtitle.textContent = meta[1];
  state.q = "";
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

document.querySelector("#today").textContent = new Date().toLocaleDateString("tr-TR", {
  day: "numeric", month: "long", year: "numeric"
});
document.querySelector("#avatar").textContent = "D";
document.querySelector("#user-name").textContent = "Demo Kullanıcısı";
document.querySelector("#user-role").textContent = "Örnek veriler";

menu.addEventListener("click", () => {
  const open = !sidebar.classList.contains("open");
  sidebar.classList.toggle("open", open);
  document.body.classList.toggle("menuopen", open);
  backdrop.hidden = !open;
  menu.setAttribute("aria-expanded", String(open));
});
backdrop.addEventListener("click", closeMenu);
window.addEventListener("hashchange", render);
document.addEventListener("click", (event) => {
  const cmd = event.target.closest("[data-cmd]");
  if (!cmd) return;
  if (cmd.dataset.cmd === "new-order") {
    newOrder(ctx, false);
    return;
  }
  showNotice("Bu işlem girişsiz demoda etkin değil. Gerçek veri değiştirilmez.");
});
document.addEventListener("submit", (event) => {
  if (!event.target.matches("[data-filter]")) return;
  event.preventDefault();
  const q = event.target.elements.namedItem("q");
  if (!q) return;
  const view = location.hash.slice(1);
  const data = demoData(view);
  const query = q.value.trim().toLocaleLowerCase("tr-TR");
  const rows = data.rows.filter((row) => Object.values(row).some((value) =>
    typeof value === "string" && value.toLocaleLowerCase("tr-TR").includes(query)));
  content.innerHTML = renderers[view]({ ...data, rows }, { ...state, q: q.value.trim() });
});
render();
