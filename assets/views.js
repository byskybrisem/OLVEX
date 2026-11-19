import { overview } from "./dashboard.js";
import { salesChart } from "./sales-chart.js";
import { badge, button, count, day, empty, filters, h, link, money, offsetDay, pagination, panel, rowName, stat, table, tabs, today } from "./ui.js";

export const roles = { owner: "İşletme sahibi", admin: "Yönetici", member: "Ekip üyesi" };
export const repeats = { none: "Tek sefer", daily: "Günlük", weekly: "Haftalık", monthly: "Aylık" };
const sources = { manual: "Manuel", csv: "CSV", pos: "Kasa bağlantısı" };
const movementKinds = { opening: "Açılış stoğu", sale: "Satış", purchase: "Satın alma", adjustment: "Düzeltme", reversal: "İade / iptal" };
const invoiceStates = { open: "Açık", paid: "Ödendi", cancelled: "İptal" };

export const views = {
  overview: ["Genel Bakış", "Satışlar, nakit ve stok durumu."],
  sales: ["Satışlar", "Tamamlanan satışlar ve tahsilatlar."],
  "stock-alerts": ["Kritik stok uyarıları", "Kritik eşiğe ulaşan şube stokları.", "products"],
  products: ["Ürünler ve Stok", "Ürün kartları, fiyatlar ve mevcut stok."],
  stock: ["Stok Hareketleri", "Açılış, satış, satın alma ve sayım düzeltmeleri.", "products"],
  transfers: ["Şubeler arası transferler", "Ürünlerin çıkış ve giriş şubelerini, adetlerini ve işlem geçmişini görüntüleyin.", "products"],
  purchases: ["Satın Alma", "Teslim alınan ürünleri, tedarikçileri ve ödemeleri kaydedin.", null, true],
  customers: ["Müşteriler", "İletişim bilgileri ve satış geçmişi."],
  finance: ["Finans", "Tahsil edilen satışlar, ödenen alışlar ve diğer nakit hareketleri.", null, true],
  invoices: ["Faturalar", "Gelen ve giden belge numaraları, vadeler ve ödeme durumu.", null, true],
  employees: ["Personel", "Çalışan kayıtları, görevler ve vardiyalar.", null, true],
  shifts: ["Vardiyalar", "Çalışma saatleri ve vardiya takvimi.", "employees", true],
  tasks: ["Görev ve Takvim", "Planlanan işler ve düzenli tekrarlar."],
  branches: ["İşletmeler", "Eriştiğiniz işletmeler arasında geçin ve satış tutarlarını karşılaştırın."],
  locations: ["Şubeler", "Bu işletmenin şubeleri ve şubelere göre stok durumu.", "branches"],
  reports: ["Raporlar", "Günlük performans, ürün satışları ve brüt kâr.", null, true],
  ai: ["OLVEX AI", "İşletme verilerinize dayalı analiz ve işlem taslakları.", null, true],
  settings: ["Ayarlar", "İşletme bilgileri ve ekip erişimi.", null, true],
  pos: ["Kasa Bağlantıları", "Mevcut kasa yazılımınızdan satış ve iade aktarımı.", "settings", true]
};

const group = (inner) => `<div class="inline">${inner}</div>`;
const stats = (inner) => `<div class="stat-grid">${inner}</div>`;
const grid = (left, right) => `<div class="split">${left}${right}</div>`;
const withPage = (heading, data, content) => panel(heading, content + pagination(data));
const inventoryTabs = (id) => tabs([["Ürün kartları", "products"], ["Stok hareketleri", "stock"], ["Kritik stok", "stock-alerts"], ["Şubeler arası transferler", "transfers"]], id);
const staffTabs = (id) => tabs([["Çalışanlar", "employees"], ["Vardiyalar", "shifts"]], id);
const settingsTabs = (id) => tabs([["İşletme ve ekip", "settings"], ["Kasa bağlantıları", "pos"]], id);
const businessTabs = (id) => tabs([["İşletmeler", "branches"], ["Şubeler", "locations"]], id);

function inventoryScope(state) {
  return group(`<strong>${h(state.branchName || "Tüm şubeler")}</strong>` +
    link("Şube seç", "#locations", "small") +
    (state.branchId ? button("Tüm şubeleri göster", "all-branch-stock", { kind: "small" }) : ""));
}

function productList(data, state) {
  const columns = ["Ürün", "Satış fiyatı", ...(state.manager ? ["Maliyet"] : []),
    ...(state.branchId ? ["Şube stoku"] : []), "İşletme stoku", ...(state.demo ? [] : ["İşlemler"])];
  const rows = data.rows.map((row) => [
    rowName(row.name, [row.sku, row.category].filter(Boolean).join(" · ")),
    h(money(row.price_minor)), ...(state.manager ? [h(money(row.cost_minor))] : []),
    !row.active ? badge(`Arşiv · ${count(row.stock)}`) :
      badge(count(row.stock), row.stock <= row.reorder_at ? "warn" : "ok"),
    ...(state.branchId ? [h(count(row.total_stock))] : []),
    ...(state.demo ? [] : [group(button("Hareketler", "product-history", { id: row.id, kind: "small" }) + (state.manager ?
      button("Düzenle", "edit-product", { id: row.id, kind: "small" }) +
      (row.active ? button("Stok düzelt", "adjust-stock", { id: row.id, kind: "small" }) : "") +
      ((row.total_stock ?? row.stock) === 0 || !row.active ? button(row.active ? "Arşivle" : "Geri aç", "archive-product", { id: row.id, kind: "small" }) : "") : ""))])
  ]);
  return (state.demo ? "" : inventoryTabs("products") + inventoryScope(state)) + filters(state, { query: "Ürün veya SKU", archive: !state.demo }) +
    withPage("Ürün kayıtları", data, table(columns, rows, "Bu görünümde ürün yok."));
}

function stock(data, state) {
  return inventoryTabs("stock") + inventoryScope(state) + (state.product ?
    group(`<span class="muted">${h(state.productName || "Seçilen ürün")}</span>` + button("Tüm hareketler", "clear-product", { kind: "small" })) : "") +
    filters(state, { query: "Ürün, SKU veya açıklama" }) +
    withPage("Hareket geçmişi", data, table(["Ürün", "Şube", "Tür", "Stok farkı", "Tarih", "Açıklama"], data.rows.map((row) =>
      [rowName(row.name, row.sku), h(row.branch_name), h(row.transfer_id ? "Şube transferi" : movementKinds[row.kind]), badge(`${row.delta > 0 ? "+" : ""}${count(row.delta)}`, row.delta > 0 ? "ok" : "warn"),
        h(day(row.created_at)), h(row.note || "—")]), "Stok hareketi kaydı yok."));
}

function transfers(data, state) {
  return inventoryTabs("transfers") + filters(state, { query: "Şube, ürün, SKU veya açıklama" }) +
    withPage("Transfer geçmişi", data, table(["Tarih", "Kaynak şube", "Hedef şube", "Ürün", "Adet", "İşlemi yapan", "Açıklama"],
      data.rows.map(row => [h(day(row.occurred_on)), h(row.source_name), h(row.destination_name), rowName(row.name, row.sku),
        h(count(row.quantity)), h(row.actor_name), h(row.note || "—")]), "Transfer kaydı yok."));
}

function orderList(data, state, purchase) {
  const rows = data.rows.map((row) => {
    const active = row.status === "posted";
    const party = purchase ? row.supplier : row.customer || "Perakende";
    const items = row.items_json ? JSON.parse(row.items_json) : [];
    const hasReturn = items.some(item => item.returned > 0);
    const fullyReturned = Boolean(row.fully_returned) || (hasReturn && items.every(item => item.quantity === 0));
    const status = !active ? badge("İptal") : fullyReturned ? badge("Tam iade") : row.paid_on ?
      badge(purchase ? "Ödendi" : "Tahsil edildi", "ok") : badge(purchase ? "Ödeme bekliyor" : "Tahsilat bekliyor", "warn");
    return [
      h(day(row.occurred_on)),
      rowName(party, [row.reference, row.branch_name, row.register_name, sources[row.source]].filter(Boolean).join(" · ")),
      h(money(row.total_minor)), status + (active && hasReturn && !fullyReturned ? badge("Kısmi iade") : ""),
      group(button("Ayrıntı", "order-detail", { id: row.id, kind: "small" }) +
        (row.can_link_csv && state.manager && !state.demo ? button("Eski fişi karşılaştır", "link-csv", { id: row.id, kind: "small" }) : "") +
        (active && state.manager && !state.demo ?
          (!purchase && row.source === "manual" ? button("Düzenle", "edit-sale", { id: row.id, kind: "small" }) : "") + (!row.paid_on && !fullyReturned ?
          button(purchase ? "Ödeme kaydet" : "Tahsilat kaydet", "settle-order", { id: row.id, kind: "small" }) : "") +
          (!fullyReturned ? button(purchase ? "İptal et" : "Tam iade / iptal", "void-order", { id: row.id, kind: "small danger" }) : "") : ""))
    ];
  });
  return filters(state, { unpaid: purchase ? "Ödeme bekleyenler" : "Tahsilat bekleyenler", query: purchase ? "Tedarikçi, ürün veya referans" : "Müşteri, ürün veya referans" }) +
    withPage(purchase ? "Alış geçmişi" : "Satış geçmişi", data,
      table(["Tarih", purchase ? "Tedarikçi" : "Müşteri", "Tutar", "Durum", "İşlemler"], rows, "Bu görünümde işlem yok."));
}

function customers(data, state) {
  return filters(state, { query: "Ad, e-posta veya telefon", archive: true }) +
    withPage("Müşteri kayıtları", data, table(["Müşteri", "İletişim", "İşlemler"], data.rows.map((row) => [
      rowName(row.name, row.active ? row.notes : "Arşiv"),
      `${h(row.email || "—")}${row.phone ? `<span class="row-sub">${h(row.phone)}</span>` : ""}`,
      group(button("Satış geçmişi", "customer-history", { id: row.id, kind: "small" }) +
      button("Düzenle", "edit-customer", { id: row.id, kind: "small" }) +
      (state.manager ? button(row.active ? "Arşivle" : "Geri aç", "archive-customer", { id: row.id, kind: "small" }) : ""))
    ]), "Bu görünümde müşteri yok."));
}

function finance(data, state) {
  const { totals, unpaid, days } = data.summary;
  const net = totals.revenue - totals.spending;
  const daily = days.filter(row => row.revenue || row.spending).reverse();
  const ledger = daily.length ? `<details class="cash-days"><summary>Günlük nakit dökümü (${count(daily.length)} gün)</summary>${table(
    ["Tarih", "Giriş", "Çıkış", "Net hareket"], daily.map(row => [
      h(day(row.day)), h(money(row.revenue)), h(money(row.spending)), h(money(row.revenue - row.spending))
    ]))}</details>` : empty("Seçilen dönemde nakit hareketi yok.");
  return filters(state, { range: true }) + `<div class="cash-grid">
    <section class="cash-period" aria-label="Seçilen dönemde nakit hareketi">
      <h2>Net nakit hareketi</h2><strong class="cash-value">${h(money(net))}</strong>
      <dl class="cash-breakdown"><div><dt>Nakit girişi</dt><dd>${h(money(totals.revenue))}</dd></div>
      <div><dt>Nakit çıkışı</dt><dd>${h(money(totals.spending))}</dd></div></dl>
      ${ledger}
    </section>
    <section class="cash-open" aria-label="Tüm dönemlerde açık tutarlar">
      <h2>Açık tutarlar</h2><p class="muted">Tüm dönemler</p>
      <dl><div><dt>Tahsilat bekleyen satışlar</dt><dd>${h(money(unpaid.sale))}</dd></div>
      <div><dt>Ödeme bekleyen alışlar</dt><dd>${h(money(unpaid.purchase))}</dd></div></dl>
    </section></div>` +
    withPage("Diğer nakit kayıtları", data, table(["Tarih", "Açıklama", "Tür", "Tutar", "İşlemler"], data.rows.map((row) => [
      h(day(row.occurred_on)), rowName(row.description, row.category), badge(row.kind === "income" ? "Gelir" : "Gider"),
      h(money(row.amount_minor)), row.voided_at ? badge("İptal") : state.demo ? "Örnek kayıt" : button("İptal et", "void-cash", { id: row.id, kind: "small danger" })
    ]), "Seçilen tarihlerde ek gelir veya gider kaydı yok."));
}

function invoices(data, state) {
  return panel("", `<p class="muted">Fatura kayıtları iç takip içindir. Resmî e-Fatura ve e-Arşiv işlemlerini GİB üzerinden veya yetkili entegratörünüzle yapın.</p>`) +
    filters(state, { query: "Belge no veya karşı taraf" }) +
    withPage("Fatura kayıtları", data, table(["Belge", "Karşı taraf", "Vade", "Tutar", "Durum", "İşlemler"], data.rows.map((row) => [
      rowName(row.number, `${row.direction === "incoming" ? "Gelen" : "Giden"} · ${day(row.issued_on)}`),
      h(row.counterparty), h(day(row.due_on)), h(money(row.amount_minor)), badge(invoiceStates[row.status], row.status === "paid" ? "ok" : ""),
      button("Düzenle", "edit-invoice", { id: row.id, kind: "small" })
    ]), "Bu görünümde fatura yok."));
}

function employees(data, state) {
  return staffTabs("employees") + filters(state, { query: "Çalışan adı", archive: true }) +
    withPage("Çalışan kayıtları", data, table(["Çalışan", "Görev", "Durum", "İşlemler"], data.rows.map((row) => [
      h(row.name), h(row.job_title || "—"), badge(row.active ? "Aktif" : "Arşiv", row.active ? "ok" : ""),
      group(button("Düzenle", "edit-employee", { id: row.id, kind: "small" }) +
        button(row.active ? "Arşivle" : "Geri aç", "archive-employee", { id: row.id, kind: "small" }))
    ]), "Bu görünümde çalışan yok."));
}

function shifts(data, state) {
  return staffTabs("shifts") + filters(state, { range: true }) +
    withPage("Planlanan vardiyalar", data, table(["Tarih", "Çalışan", "Başlangıç", "Bitiş", "İşlemler"], data.rows.map((row) => [
      h(day(row.shift_on)), h(row.name), h(row.start_time),
      h(row.start_time > row.end_time ? `${row.end_time} · ertesi gün` : row.end_time),
      button("Kaldır", "remove-shift", { id: row.id, kind: "small danger" })
    ]), "Seçilen tarihlerde vardiya yok."));
}

function calendar(data, state) {
  const { from, to } = state.calendar;
  const [year, month] = from.split("-").map(Number);
  const monthName = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  const blanks = (new Date(from).getUTCDay() + 6) % 7;
  const counts = Object.fromEntries(data.calendar.rows.map((row) => [row.day, row.count]));
  const blocks = Array(blanks).fill("<span></span>");
  for (let date = from; date <= to; date = offsetDay(date, 1)) {
    const label = `${day(date)}, ${count(counts[date])} açık görev`;
    blocks.push(`<button type="button" data-cmd="task-day" data-id="${h(date)}" aria-label="${h(label)}"
      aria-pressed="${state.taskDay === date}"${date === today() ? ' aria-current="date"' : ""}>
      <span>${Number(date.slice(8))}</span>${counts[date] ? `<small>${count(counts[date])} görev</small>` : ""}
    </button>`);
  }

  const arrows = group(button("‹ Önceki", "month", { id: -1, kind: "small" }) + button("Sonraki ›", "month", { id: 1, kind: "small" }));
  return panel(monthName,
    `<div class="calendar-head">${["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((value) => `<span>${value}</span>`).join("")}</div>
      <div class="calendar-body">${blocks.join("")}</div>`, arrows);
}

function tasks(data, state) {
  const listTitle = state.taskDay ? day(state.taskDay) : "Görev listesi";
  const listActions = state.taskDay ? button("Ayın tüm görevleri", "task-day", { id: "", kind: "small" }) : "";
  const rows = data.rows.map((row) => [
    rowName(row.title, row.notes), h(day(row.due_on)), h(repeats[row.repeat_rule]),
    row.completed_at ? badge("Tamamlandı", "ok") : row.due_on < today() ? badge("Gecikmiş", "warn") : badge("Açık"),
    row.completed_at ? "—" : group(button("Tamamla", "complete-task", { id: row.id, kind: "small" }) +
      button("Düzenle", "edit-task", { id: row.id, kind: "small" }) + button("Kaldır", "remove-task", { id: row.id, kind: "small danger" }))
  ]);
  return calendar(data, state) + panel(listTitle, table(["Görev", "Tarih", "Tekrar", "Durum", "İşlemler"], rows,
    "Bu görünümde görev yok.") + pagination(data), listActions);
}

function branches(data, state) {
  return businessTabs("branches") + filters(state, { range: true }) + panel("İşletme karşılaştırması", table(["İşletme", "Rol", "Satış sayısı", "Satış tutarı", "İşlemler"],
    data.rows.map((row) => [h(row.name), badge(roles[row.role]), h(count(row.sale_count)), h(money(row.sales)),
      row.id === state.business.id ? badge("Açık", "ok") : button("İşletmeye geç", "switch-business", { id: row.id, kind: "small" })])));
}

function locations(data, state) {
  return businessTabs("locations") + filters(state, { query: "Şube adı" }) +
    withPage(state.business.name, data, table(["Şube", "Stok"], data.rows.map((row) => [
      rowName(row.name, row.is_default ? "Varsayılan şube" : ""),
      button("Şube stoklarını göster", "branch-stock", { id: row.id, kind: "small" })
    ]), "Bu görünümde şube yok."));
}

function reports(data, state) {
  const { totals, days, topProducts } = data;
  return filters(state, { range: true }) + stats(
    stat("Net satış tutarı", money(totals.sales)) + stat("Satılan ürün maliyeti", money(totals.cost)) +
    stat("Brüt kâr", money(totals.sales - totals.cost), "teal") + stat("Satın alma tutarı", money(totals.purchases))) +
    panel("Net satış seyri", salesChart(days)) +
    panel("En çok satış tutarı getiren 20 ürün", table(["Ürün", "Adet", "Satış", "Brüt kâr"],
      topProducts.map((row) => [rowName(row.name, row.sku), h(count(row.quantity)), h(money(row.sales)), h(money(row.sales - row.cost))]),
      "Seçilen tarihlerde ürün satışı yok.")) +
    panel("Rapor hesabı", `<p class="muted">İade ve iptaller işlem gününde net satışı azaltır. Brüt kârda her ürünün satış anındaki maliyeti kullanılır. Nakit giriş ve çıkışları ödeme tarihine göre gösterilir.</p>`);
}

function settingView(data, state) {
  const owner = state.business.role === "owner";
  const members = panel("Ekip üyeleri", table(["Kullanıcı", "Rol", "İşlemler"], data.members.map((row) => [
    rowName(row.name || row.email, row.name ? row.email : ""), badge(roles[row.role]),
    owner && row.role !== "owner" ? button("Yetkiyi düzenle", "edit-member", { id: row.id, kind: "small" }) : "—"
  ])));
  return settingsTabs("settings") + members + (owner ?
    panel("Bekleyen davetler", table(["E-posta", "Rol", "Geçerlilik", "İşlemler"], data.invites.map((row) => [
      h(row.email), h(roles[row.role]), h(day(row.expires_at)), button("İptal et", "revoke-invite", { id: row.id, kind: "small danger" })
    ]), "Bekleyen davet yok.")) : "");
}

function posView(data) {
  return settingsTabs("pos") +
    panel("Satış aktarımı", `<p class="muted">Her kasa kendi anahtarıyla <code>/api/pos</code> üzerinden bağlı olduğu şubeye satış, iade ve iptal bildirir.</p>`,
      button("Bağlantı biçimi", "pos-help", { kind: "small" })) +
    withPage("Kasa bağlantıları", data, table(["Kasa", "Şube", "İşlem kimliği", "Durum", "İşlemler"], data.rows.map((row) => [
      rowName(row.name, day(row.created_at)), h(row.branch_name),
      h(row.identity_mode === "native" ? "Kaynak işlem kimliği" : "Uzlaştırma"),
      badge(row.revoked_at ? "İptal" : "Aktif", row.revoked_at ? "" : "ok"),
      group(button("Anahtarı yenile", "rotate-pos", { id: row.id, kind: "small" }) +
        (row.revoked_at ? "" : button("Kimlik ayarı", "pos-identity", { id: row.id, kind: "small" }) +
        (row.identity_mode === "reconcile" ? button("Kaynak kaydını eşleştir", "pos-reconcile", { id: row.id, kind: "small" }) : "") +
        button("Anahtarı iptal et", "revoke-pos", { id: row.id, kind: "small danger" })))
    ]), "Henüz kasa bağlantısı kurulmadı."));
}

export function proposalLabel(proposal) {
  if (proposal.kind === "expense") return `${money(proposal.amount)} gider · ${proposal.description} · ${day(proposal.occurredOn)}`;
  const product = `${proposal.name} (${proposal.sku})`;
  if (!proposal.branchId) return `${product} · Bu eski taslakta şube seçilmemiş. Şube seçerek yeni bir taslak hazırlayın.`;
  const action = proposal.delta > 0 ? "Stok girişi" : "Stok çıkışı";
  return `İşletme: ${proposal.businessName} · Şube: ${proposal.branchName} · ${product} · ${action}, ${count(Math.abs(proposal.delta))} adet · ${proposal.description}`;
}

function stockAlertTable(rows) {
  return table(["Şube", "Ürün", "Şube stoku", "Kritik eşik", "İşletme toplamı"], rows.map(row => [
    h(row.branch_name), rowName(row.name, row.sku), badge(count(row.stock), "warn"), h(count(row.reorder_at)), h(count(row.total_stock))
  ]), "Kritik stok uyarısı yok.");
}

function stockAlerts(data, state) {
  return inventoryTabs("stock-alerts") + filters(state, { query: "Şube, ürün veya SKU" }) + withPage("Şube stokları", data, stockAlertTable(data.rows));
}

function freeBusinessInsights(facts, demo) {
  const sales = Number(facts.totals?.sales || 0);
  const previous = Number(facts.previousSales || 0);
  const lowCount = Number(facts.lowStockCount || 0);
  const receivables = Number(facts.unpaid?.sale || 0);

  let salesMessage;
  if (previous > 0) {
    const percent = Math.round((sales - previous) * 100 / previous);
    salesMessage = percent > 0
      ? "Son 7 gündeki satışlar önceki 7 güne göre %" + percent + " yükseldi."
      : percent < 0
        ? "Son 7 gündeki satışlar önceki 7 güne göre %" + Math.abs(percent) + " azaldı."
        : "Son 7 günün satış tutarı önceki dönemle aynı.";
  } else {
    salesMessage = sales > 0
      ? "Son 7 günde " + money(sales) + " satış kaydı var; önceki dönemde satış olmadığı için yüzdelik karşılaştırma yapılmıyor."
      : "Henüz karşılaştırılabilir satış verisi yok. İlk satış kaydından sonra eğilim burada gösterilecek.";
  }

  const stockMessage = lowCount > 0
    ? count(lowCount) + " şube stok uyarısı var. Kritik eşiğe ulaşan ürünleri ve şubeleri inceleyin."
    : "Kritik stok uyarısı bulunmuyor. Bu, henüz hiç ürün eklenmediği anlamına da gelebilir.";
  const paymentMessage = receivables > 0
    ? money(receivables) + " tutarında tahsilat bekleyen satış var."
    : "Tahsilat bekleyen satış kaydı görünmüyor.";

  return '<div class="stat-grid">' +
    panel("Satış eğilimi", '<p class="hint">' + h(salesMessage) + '</p>' +
      link("Satışları incele", "#sales", "small")) +
    panel("Stok kontrolü", '<p class="hint">' + h(stockMessage) + '</p>' +
      link("Stokları incele", demo ? "#products" : "#stock-alerts", "small")) +
    panel("Tahsilat kontrolü", '<p class="hint">' + h(paymentMessage) + '</p>' +
      link("Finansa geç", "#finance", "small")) +
    '</div>';
}

function ai(data, state) {
  const { facts, mode, proposals } = data;
  const change = facts.previousSales > 0 ?
    `Önceki 7 güne göre %${count(Math.round((facts.totals.sales - facts.previousSales) * 100 / facts.previousSales))}.` :
    "Önceki 7 günde karşılaştırılabilir satış kaydı yok.";
  const chat = state.chat.map((msg) => `<article class="${msg.role === "user" ? "user" : "assistant"}">
    <strong>${msg.role === "user" ? "Siz" : "OLVEX AI"}</strong><p>${h(msg.content)}</p></article>`).join("");
  const chatForm = mode === "off" ? empty("Canlı AI sohbeti bu ortamda etkinleştirilmemiş. Yukarıdaki ücretsiz veri analizleri çalışmaya devam eder.") :
    `<form class="ai-form" id="ai-form"><div data-ai-branch></div><label>Mesaj
      <textarea name="prompt" required maxlength="2000" rows="3" placeholder="Son 7 günlük satışlarımı değerlendir"></textarea></label>
      <p class="hint">${mode === "mock" ? "Test modu. Örnek gider taslağı için “gider 125,50 elektrik” yazın." :
      "Mesajınız ve işletme özetiniz OpenAI’ye iletilir. Kişisel bilgi veya parola girmeyin."}</p>
      <div class="ai-prompts" role="group" aria-label="Örnek sorular">
        <button class="button small" type="button" data-prompt="Son 7 günlük satışlarımı önceki dönemle karşılaştır.">Satışları karşılaştır</button>
        <button class="button small" type="button" data-prompt="Hangi ürünler kritik stok eşiğinde?">Kritik stokları özetle</button>
      </div><button class="button primary" type="submit">Gönder</button></form>`;
  return stats(stat("Son 7 gün satış", money(facts.totals.sales)) + stat("Kritik stok", count(facts.lowStockCount), "warm") +
    stat("Bekleyen tahsilat", money(facts.unpaid.sale), "teal")) +
    grid(panel("İşletme analizi", `<p class="hint">${h(day(facts.from))} – ${h(day(facts.to))} · ${h(change)}</p>` +
      stockAlertTable(facts.lowStock)),
    panel("Bekleyen işlem taslakları", proposals.length ? `<div class="proposals">${proposals.map((proposal) =>
      `<article class="proposal"><strong>${h(proposalLabel(proposal))}</strong>${group(
        (proposal.kind === "stock" && !proposal.branchId ? "" : button("Onayı incele", "apply-proposal", { id: proposal.id, kind: "small primary" })) +
        button("Reddet", "discard-proposal", { id: proposal.id, kind: "small" }))}</article>`
    ).join("")}</div>` : empty("Onay bekleyen işlem yok."))) +
    panel("Ücretsiz veriye dayalı analiz", freeBusinessInsights(facts, state.demo)) +
    panel("OLVEX AI sohbeti", `<div class="chat" aria-live="polite">${chat}</div>${chatForm}`,
      mode === "mock" ? badge("Test modu", "warn") : "");
}

export const renderers = {
  overview, "stock-alerts": stockAlerts, products: productList, stock, transfers, sales: (data, state) => orderList(data, state, false),
  purchases: (data, state) => orderList(data, state, true), customers, finance, invoices,
  employees, shifts, tasks, branches, locations, reports, settings: settingView, pos: posView, ai
};

export function actions(view, state) {
  const primary = (title, command) => button(title, command, { kind: "primary" });
  const addSale = primary("+ Yeni satış", "new-order");
  switch (view) {
    case "overview": return addSale;
    case "sales": return (state.manager ? button("CSV içe aktar", "import-sales") : "") + addSale;
    case "purchases": return primary("+ Satın alma", "new-order");
    case "products": return state.manager ? primary("+ Ürün ekle", "edit-product") : "";
    case "transfers": return state.manager ? primary("+ Transfer oluştur", "create-transfer") : "";
    case "customers": return primary("+ Müşteri ekle", "edit-customer");
    case "finance": return primary("+ Gelir / gider", "add-cash");
    case "invoices": return primary("+ Fatura kaydı", "edit-invoice");
    case "employees": return primary("+ Çalışan ekle", "edit-employee");
    case "shifts": return primary("+ Vardiya ekle", "add-shift");
    case "tasks": return primary("+ Görev ekle", "edit-task");
    case "branches": return link("Davetle katıl", "/join.html") + link("+ Yeni işletme", "/setup.html?new=1", "primary");
    case "locations": return state.manager ? primary("+ Şube ekle", "create-location") : "";
    case "reports": return button("CSV indir", "export-report");
    case "settings": return state.business.role === "owner"
      ? button("İşletme adını düzenle", "rename-business") + primary("+ Ekip daveti", "invite")
      : "";
    case "pos": return link("Şubeler", "#locations") + primary("+ Bağlantı oluştur", "create-pos");
    default: return "";
  }
}
