import { badge, button, count, day, empty, filters, h, link, money, offsetDay, pagination, panel, rowName, stat, table, tabs, today } from "./ui.js";

export const roles = { owner: "İşletme sahibi", admin: "Yönetici", member: "Ekip üyesi" };
export const repeats = { none: "Tek sefer", daily: "Günlük", weekly: "Haftalık", monthly: "Aylık" };
const sources = { manual: "Manuel", csv: "CSV", pos: "Kasa bağlantısı" };
const movementKinds = { opening: "Açılış stoğu", sale: "Satış", purchase: "Satın alma", adjustment: "Düzeltme", reversal: "İade / iptal" };
const invoiceStates = { open: "Açık", paid: "Ödendi", cancelled: "İptal" };

export const views = {
  overview: ["Genel Bakış", "Satışlar, nakit ve stok durumu."],
  sales: ["Satışlar", "Tamamlanan satışlar ve tahsilatlar."],
  products: ["Ürünler ve Stok", "Ürün kartları, fiyatlar ve mevcut stok."],
  stock: ["Stok Hareketleri", "Açılış, satış, satın alma ve sayım düzeltmeleri.", "products"],
  purchases: ["Satın Alma", "Teslim alınan ürünleri, tedarikçileri ve ödemeleri kaydedin.", null, true],
  customers: ["Müşteriler", "İletişim bilgileri ve satış geçmişi."],
  finance: ["Finans", "Tahsil edilen satışlar, ödenen alışlar ve diğer nakit hareketleri.", null, true],
  invoices: ["Faturalar", "Gelen ve giden belge numaraları, vadeler ve ödeme durumu.", null, true],
  employees: ["Personel", "Çalışan kayıtları, görevler ve vardiyalar.", null, true],
  shifts: ["Vardiyalar", "Çalışma saatleri ve vardiya takvimi.", "employees", true],
  tasks: ["Görev ve Takvim", "Planlanan işler ve düzenli tekrarlar."],
  branches: ["İşletmeler", "Eriştiğiniz işletmeler arasında geçin ve satış tutarlarını karşılaştırın."],
  reports: ["Raporlar", "Günlük performans, ürün satışları ve brüt kâr.", null, true],
  ai: ["OLVEX AI", "İşletme verilerinize dayalı analiz ve işlem taslakları.", null, true],
  settings: ["Ayarlar", "İşletme bilgileri ve ekip erişimi.", null, true],
  pos: ["Kasa Bağlantıları", "Mevcut kasa yazılımınızdan satış ve iade aktarımı.", "settings", true]
};

const group = (inner) => `<div class="inline">${inner}</div>`;
const stats = (inner) => `<div class="stat-grid">${inner}</div>`;
const grid = (left, right) => `<div class="split">${left}${right}</div>`;
const withPage = (heading, data, content) => panel(heading, content + pagination(data));
const inventoryTabs = (id) => tabs([["Ürün kartları", "products"], ["Stok hareketleri", "stock"]], id);
const staffTabs = (id) => tabs([["Çalışanlar", "employees"], ["Vardiyalar", "shifts"]], id);
const settingsTabs = (id) => tabs([["İşletme ve ekip", "settings"], ["Kasa bağlantıları", "pos"]], id);


function chart(days) {
  if (!days.length) {
    return empty("Grafik için tarih verisi bulunamadı.");
  }

  const bucketSize = Math.max(1, Math.ceil(days.length / 14));
  const groups = [];

  for (let i = 0; i < days.length; i += bucketSize) {
    const segment = days.slice(i, i + bucketSize);
    groups.push({
      from: segment[0].day,
      to: segment.at(-1).day,
      sales: segment.reduce((sum, row) => sum + row.sales, 0)
    });
  }

  const highest = Math.max(0, ...groups.map((item) => item.sales));
  const ceiling = highest || 1;
  const baseY = 218;

  const points = groups.map((item, index) => ({
    ...item,
    x: groups.length === 1
      ? 380
      : 24 + index * 712 / (groups.length - 1),
    y: baseY - item.sales / ceiling * 166
  }));

  const linePath = points.map((point, index) =>
    `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  ).join(" ");

  const areaPath = `${linePath} L${points.at(-1).x.toFixed(2)} ${baseY} L${points[0].x.toFixed(2)} ${baseY} Z`;

  return `<div class="chart" role="group" aria-label="Satış grafiği"
    style="display:block;height:auto;padding:12px 12px 8px;">
    <svg viewBox="0 0 760 250" role="group" aria-label="Dönemsel satışlar"
      style="display:block;width:100%;height:auto;overflow:visible;">
      <defs>
        <linearGradient id="olvex-sales-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#9b8aff" stop-opacity="0.34" />
          <stop offset="100%" stop-color="#9b8aff" stop-opacity="0.01" />
        </linearGradient>
      </defs>

      ${[52, 107, 162, 218].map((y) =>
        `<line x1="24" y1="${y}" x2="736" y2="${y}"
          stroke="#aab7d2" stroke-opacity="0.17" stroke-dasharray="4 7" />`
      ).join("")}

      <path d="${areaPath}" fill="url(#olvex-sales-gradient)" />

      <path d="${linePath}" fill="none" stroke="#a99fff"
        stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"
        vector-effect="non-scaling-stroke" />

      ${points.map((point) => {
        const range = point.from === point.to
          ? day(point.from)
          : `${day(point.from)} – ${day(point.to)}`;

        const label = `${range} · ${money(point.sales)}`;

        return `<circle class="bar" cx="${point.x.toFixed(2)}"
          cy="${point.y.toFixed(2)}" r="7" fill="#b6aaff"
          stroke="#111a31" stroke-width="2" title="${h(label)}"
          style="animation:none;transform:none;cursor:pointer;" />`;
      }).join("")}

      <text x="24" y="22" fill="#aab7d2" font-size="14">
        En yüksek dönem: ${h(money(highest))}
      </text>
    </svg>
  </div>

  <div class="chart-axis">
    <span>${h(day(days[0].day))}</span>
    <span>${h(day(days.at(-1).day))}</span>
  </div>

  ${highest === 0
    ? '<p class="hint">Seçilen tarihlerde satış yok. Grafik sıfır düzeyinde.</p>'
    : '<p class="hint">Noktalara dokunarak ilgili dönemin satışını inceleyin.</p>'}`;
}


  if (!days.length) {
    return empty("Grafik için tarih verisi bulunamadı.");
  }

  if (!days.some((row) => row.sales > 0)) {
    return `<div class="chart" role="img"
      aria-label="Seçilen dönemde satış bulunamadı">
      <p class="empty" style="margin:auto; text-align:center; padding:12px;">
        Bu dönemde henüz satış yok.
        İlk satıştan sonra grafik burada oluşacak.
      </p>
    </div>
    <div class="chart-axis">
      <span>${h(day(days[0].day))}</span>
      <span>${h(day(days.at(-1).day))}</span>
    </div>`;
  }
  const span = Math.ceil(days.length / 30);
  const groups = [];
  for (let index = 0; index < days.length; index += span) {
    const bucket = days.slice(index, index + span);
    groups.push({ from: bucket[0].day, to: bucket.at(-1).day, sales: bucket.reduce((sum, row) => sum + row.sales, 0) });
  }
  const max = Math.max(...groups.map((bucket) => bucket.sales));
  return `<div class="chart" role="img" aria-label="${h(day(days[0].day))} ve ${h(day(days.at(-1).day))} arasında satış grafiği">
    ${groups.map((bucket) => {
      const label = `${day(bucket.from)}${bucket.from === bucket.to ? "" : ` – ${day(bucket.to)}`} · ${money(bucket.sales)}`;
      return `<span aria-hidden="true" class="bar" title="${h(label)}" style="height:${bucket.sales > 0 ? Math.max(1, 100 * bucket.sales / max) : 0}%"></span>`;
    }).join("")}</div>
    <div class="chart-axis"><span>${h(day(days[0].day))}</span><span>${h(day(days.at(-1).day))}</span></div>`;
}

function overview(data, state) {
  const { totals, latest, lowStock, days } = data;
  const cards = stat("Satış tutarı", money(totals.sales)) +
    (state.manager ? stat("Brüt kâr", money(totals.sales - totals.cost), "teal") +
      stat("Net nakit", money(totals.revenue - totals.spending)) : stat("Satış sayısı", count(totals.saleCount))) +
    stat("Kritik stok", count(lowStock[0]?.total), "warm");
  return filters(state, { range: true }) + stats(cards) +
    grid(panel("Satış seyri", chart(days)),
      panel("Kritik stok", table(["Ürün", "Stok"], lowStock.map((row) =>
        [rowName(row.name, row.sku), badge(count(row.stock), "warn")]), "Kritik stok kaydı yok."),
      link("Ürünler", "#products", "small"))) +
    panel("Son satışlar", table(["Tarih", "Referans", "Tutar"], latest.map((row) =>
      [h(day(row.occurred_on)), h(row.reference || "Manuel kayıt"), h(money(row.total_minor))]),
    "Seçilen tarihlerde satış yok."), link("Satışları aç", "#sales", "small"));
}

function productList(data, state) {
  const columns = ["Ürün", "Satış fiyatı", ...(state.manager ? ["Maliyet"] : []), "Stok", "İşlemler"];
  const rows = data.rows.map((row) => [
    rowName(row.name, [row.sku, row.category].filter(Boolean).join(" · ")),
    h(money(row.price_minor)), ...(state.manager ? [h(money(row.cost_minor))] : []),
    !row.active ? badge(`Arşiv · ${count(row.stock)}`) :
      badge(count(row.stock), row.stock <= row.reorder_at ? "warn" : "ok"),
    group(button("Hareketler", "product-history", { id: row.id, kind: "small" }) + (state.manager ?
      button("Düzenle", "edit-product", { id: row.id, kind: "small" }) +
      (row.active ? button("Stok düzelt", "adjust-stock", { id: row.id, kind: "small" }) : "") +
      (row.stock === 0 || !row.active ? button(row.active ? "Arşivle" : "Geri aç", "archive-product", { id: row.id, kind: "small" }) : "") : ""))
  ]);
  return inventoryTabs("products") + filters(state, { query: "Ürün veya SKU", archive: true }) +
    withPage("Ürün kayıtları", data, table(columns, rows, "Bu görünümde ürün yok."));
}

function stock(data, state) {
  return inventoryTabs("stock") + (state.product ?
    group(`<span class="muted">${h(state.productName || "Seçilen ürün")}</span>` + button("Tüm hareketler", "clear-product", { kind: "small" })) : "") +
    withPage("Hareket geçmişi", data, table(["Ürün", "Tür", "Stok farkı", "Tarih", "Açıklama"], data.rows.map((row) =>
      [rowName(row.name, row.sku), h(movementKinds[row.kind]), badge(`${row.delta > 0 ? "+" : ""}${count(row.delta)}`, row.delta > 0 ? "ok" : "warn"),
        h(day(row.created_at)), h(row.note || "—")]), "Stok hareketi kaydı yok."));
}

function orderList(data, state, purchase) {
  const rows = data.rows.map((row) => {
    const active = row.status === "posted";
    const party = purchase ? row.supplier : row.customer || "Perakende";
    const status = active === false ? badge("İptal") : row.paid_on ?
      badge(purchase ? "Ödendi" : "Tahsil edildi", "ok") : badge(purchase ? "Ödeme bekliyor" : "Tahsilat bekliyor", "warn");
    return [
      h(day(row.occurred_on)),
      rowName(party, [row.reference, sources[row.source]].filter(Boolean).join(" · ")),
      h(money(row.total_minor)), status,
      group(button("Ayrıntı", "order-detail", { id: row.id, kind: "small" }) +
        (active && state.manager ? (!row.paid_on ?
          button(purchase ? "Ödeme kaydet" : "Tahsilat kaydet", "settle-order", { id: row.id, kind: "small" }) : "") +
          button(purchase ? "İptal et" : "Tam iade / iptal", "void-order", { id: row.id, kind: "small danger" }) : ""))
    ];
  });
  return filters(state, { query: purchase ? "Tedarikçi, ürün veya referans" : "Müşteri, ürün veya referans" }) +
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
  const { totals, unpaid } = data.summary;
  return filters(state, { range: true }) + stats(
    stat("Toplam nakit girişi", money(totals.revenue), "teal") + stat("Toplam nakit çıkışı", money(totals.spending)) +
    stat("Net nakit hareketi", money(totals.revenue - totals.spending)) +
    stat("Tahsilat bekleyen satışlar", money(unpaid.sale), "warm") +
    stat("Ödeme bekleyen alışlar", money(unpaid.purchase), "warm")) +
    withPage("Diğer nakit kayıtları", data, table(["Tarih", "Açıklama", "Tür", "Tutar", "İşlemler"], data.rows.map((row) => [
      h(day(row.occurred_on)), rowName(row.description, row.category), badge(row.kind === "income" ? "Gelir" : "Gider"),
      h(money(row.amount_minor)), row.voided_at ? badge("İptal") : button("İptal et", "void-cash", { id: row.id, kind: "small danger" })
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
  return filters(state, { range: true }) + panel("İşletme karşılaştırması", table(["İşletme", "Rol", "Satış sayısı", "Satış tutarı", "İşlemler"],
    data.rows.map((row) => [h(row.name), badge(roles[row.role]), h(count(row.sale_count)), h(money(row.sales)),
      row.id === state.business.id ? badge("Açık", "ok") : button("İşletmeye geç", "switch-business", { id: row.id, kind: "small" })])));
}

function reports(data, state) {
  const { totals, days, topProducts } = data;
  return filters(state, { range: true }) + stats(
    stat("Satış tutarı", money(totals.sales)) + stat("Satılan ürün maliyeti", money(totals.cost)) +
    stat("Brüt kâr", money(totals.sales - totals.cost), "teal") + stat("Satın alma tutarı", money(totals.purchases))) +
    panel("Günlük satış grafiği", chart(days)) +
    panel("En çok satış tutarı getiren 20 ürün", table(["Ürün", "Adet", "Satış", "Brüt kâr"],
      topProducts.map((row) => [rowName(row.name, row.sku), h(count(row.quantity)), h(money(row.sales)), h(money(row.sales - row.cost))]),
      "Seçilen tarihlerde ürün satışı yok.")) +
    panel("Rapor hesabı", `<p class="muted">Brüt kâr, satış tutarından satış kaydedilirken ürün kartındaki birim maliyet düşülerek hesaplanır. Nakit giriş ve çıkışları ödeme tarihine göre gösterilir.</p>`);
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
    panel("Satış aktarımı", `<p class="muted">Kasa sağlayıcınız OLVEX’in <code>/api/pos</code> uç noktasına satış ve tam iade bildirebilir. CSV dosyaları Satışlar bölümünden içe aktarılır.</p>`,
      button("Bağlantı biçimi", "pos-help", { kind: "small" })) +
    withPage("Kasa bağlantıları", data, table(["Bağlantı", "Tarih", "Durum", "İşlemler"], data.rows.map((row) => [
      h(row.name), h(day(row.created_at)), badge(row.revoked_at ? "İptal" : "Aktif", row.revoked_at ? "" : "ok"),
      row.revoked_at ? "—" : button("Anahtarı iptal et", "revoke-pos", { id: row.id, kind: "small danger" })
    ]), "Henüz kasa bağlantısı kurulmadı."));
}

export function proposalLabel(proposal) {
  if (proposal.kind === "expense") return `${money(proposal.amount)} gider · ${proposal.description} · ${day(proposal.occurredOn)}`;
  return `${proposal.name} (${proposal.sku}) · ${proposal.delta > 0 ? "+" : ""}${count(proposal.delta)} adet · ${proposal.description}`;
}

function ai(data, state) {
  const { facts, mode, proposals } = data;
  const change = facts.previousSales > 0 ?
    `Önceki 7 güne göre %${count(Math.round((facts.totals.sales - facts.previousSales) * 100 / facts.previousSales))}.` :
    "Önceki 7 günde karşılaştırılabilir satış kaydı yok.";
  const chat = state.chat.map((msg) => `<article class="${msg.role === "user" ? "user" : "assistant"}">
    <strong>${msg.role === "user" ? "Siz" : "OLVEX AI"}</strong><p>${h(msg.content)}</p></article>`).join("");
  const chatForm = mode === "off" ? empty("OLVEX AI sohbeti bu ortamda kapalı.") :
    `<form class="ai-form" id="ai-form"><label>Mesaj
      <textarea name="prompt" required maxlength="2000" rows="3" placeholder="Son 7 günlük satışlarımı değerlendir"></textarea></label>
      <p class="hint">${mode === "mock" ? "Test modu. Örnek gider taslağı için “gider 125,50 elektrik” yazın." :
      "Mesajınız ve işletme özetiniz OpenAI’ye iletilir. Kişisel bilgi veya parola girmeyin."}</p>
      <button class="button primary" type="submit">Gönder</button></form>`;
  return stats(stat("Son 7 gün satış", money(facts.totals.sales)) + stat("Kritik stok", count(facts.lowStockCount), "warm") +
    stat("Bekleyen tahsilat", money(facts.unpaid.sale), "teal")) +
    grid(panel("İşletme analizi", `<p class="hint">${h(day(facts.from))} – ${h(day(facts.to))} · ${h(change)}</p>` +
      table(["Kritik ürün", "Stok"], facts.lowStock.map((row) => [rowName(row.name, row.sku), h(count(row.stock))]), "Kritik stok kaydı yok.")),
    panel("Bekleyen işlem taslakları", proposals.length ? `<div class="proposals">${proposals.map((proposal) =>
      `<article class="proposal"><strong>${h(proposalLabel(proposal))}</strong>${group(
        button("Onayı incele", "apply-proposal", { id: proposal.id, kind: "small primary" }) +
        button("Reddet", "discard-proposal", { id: proposal.id, kind: "small" }))}</article>`
    ).join("")}</div>` : empty("Onay bekleyen işlem yok."))) +
    panel("OLVEX AI sohbeti", `<div class="chat" aria-live="polite">${chat}</div>${chatForm}`,
      mode === "mock" ? badge("Test modu", "warn") : "");
}

export const renderers = {
  overview, products: productList, stock, sales: (data, state) => orderList(data, state, false),
  purchases: (data, state) => orderList(data, state, true), customers, finance, invoices,
  employees, shifts, tasks, branches, reports, settings: settingView, pos: posView, ai
};

export function actions(view, state) {
  const primary = (title, command) => button(title, command, { kind: "primary" });
  const addSale = primary("+ Yeni satış", "new-order");
  switch (view) {
    case "overview": return addSale;
    case "sales": return (state.manager ? button("CSV içe aktar", "import-sales") : "") + addSale;
    case "purchases": return primary("+ Satın alma", "new-order");
    case "products": return state.manager ? primary("+ Ürün ekle", "edit-product") : "";
    case "customers": return primary("+ Müşteri ekle", "edit-customer");
    case "finance": return primary("+ Gelir / gider", "add-cash");
    case "invoices": return primary("+ Fatura kaydı", "edit-invoice");
    case "employees": return primary("+ Çalışan ekle", "edit-employee");
    case "shifts": return primary("+ Vardiya ekle", "add-shift");
    case "tasks": return primary("+ Görev ekle", "edit-task");
    case "branches": return link("Davetle katıl", "/join.html") + link("+ Yeni işletme", "/setup.html?new=1", "primary");
    case "reports": return button("CSV indir", "export-report");
    case "settings": return state.business.role === "owner"
      ? button("İşletme adını düzenle", "rename-business") + primary("+ Ekip daveti", "invite")
      : "";
    case "pos": return primary("+ Bağlantı oluştur", "create-pos");
    default: return "";
  }
}
