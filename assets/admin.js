import { h, money, count, day, today, offsetDay, toMinor } from "./ui.js";

const $ = selector => document.querySelector(selector);
const sections = {
  overview: ["Genel Bakış", "Bütün OLVEX platformunun güncel durumunu tek merkezden incele."],
  businesses: ["İşletmeler", "Kayıtlı işletmeleri, üye ve kasa sayılarını görüntüle."],
  users: ["Kullanıcılar", "Platform kullanıcılarının hesap ve üyelik özetleri."],
  finance: ["Gelir / Gider", "OLVEX şirketine ait gelir ve giderleri kaydet ve izle."],
  subscriptions: ["Abonelikler", "İyzico abonelik durumlarını izle; tahsilat olarak sayma."],
  ai: ["AI Kullanımı", "Platform genelindeki model ve kullanım sayılarını incele."],
  system: ["Sistem & İşlem Geçmişi", "Veritabanı durumu ve yönetici işlem kayıtları."]
};
const state = { section: "overview", page: 0, busy: false, sequence: 0, from: offsetDay(today(), -29), to: today() };
let authenticated = false;
const format = n => Number.isFinite(Number(n)) ? count(Number(n)) : "—";
const escaped = text => h(text ?? "—");
const dateLabel = value => value ? day(value) : "—";
const moneyLabel = minor => money(minor ?? 0);
const empty = message => `<p class="admin-empty">${h(message)}</p>`;
const panel = (title, content, aside = "") =>
  `<section class="admin-panel glass"><div class="admin-panel-head"><h2>${h(title)}</h2>${aside}</div>${content}</section>`;
const info = text => `<p class="admin-panel-note">${h(text)}</p>`;
const table = (head, body, opts = "") =>
  `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${head.map(c=>`<th scope="col">${h(c)}</th>`).join("")}</tr></thead><tbody>${body || `<tr><td colspan="${head.length}">${empty("Henüz kayıt bulunmuyor.")}</td></tr>`}</tbody></table></div>${opts}`;
const stat = (title, value, symbol, detail, tone = "") =>
  `<article class="admin-kpi glass ${tone}"><div class="admin-kpi-head"><span>${h(title)}</span><span class="admin-kpi-icon" aria-hidden="true">${h(symbol)}</span></div>
  <strong>${h(value)}</strong><small>${h(detail)}</small></article>`;
const stats = (...items) => `<div class="admin-kpis">${items.join("")}</div>`;
const status = (name, positive = false) =>
  `<span class="admin-status ${positive ? "live" : "off"}">${h(name)}</span>`;
const pagination = data => `<div class="admin-pagination">
  <button type="button" data-page="-1" ${data.page <= 0 ? "disabled" : ""}>← Önceki</button>
  <span>Sayfa ${data.page + 1}</span>
  <button type="button" data-page="1" ${data.hasMore ? "" : "disabled"}>Sonraki →</button>
</div>`;

async function api(section, method = "GET", body, query = "") {
  const response = await fetch("/api/admin/" + section + query, {
    method, credentials: "same-origin", cache: "no-store",
    headers: method === "POST" ? { "Content-Type": "application/json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error || "İstek tamamlanamadı.");
    error.status = response.status;
    throw error;
  }
  return payload;
}
function notice(text, error = true) {
  const node = $("#admin-notice");
  node.textContent = text;
  node.style.borderColor = error ? "#ffbac555" : "#66e2ce88";
  node.style.background = error ? "#5723333b" : "#13443b42";
  node.hidden = false;
}
function clearNotice() { $("#admin-notice").hidden = true; }
function graph(points, kind = "finance") {
  const rows = (points || []).slice(-12);
  if (!rows.length) return empty("Bu dönemde grafik oluşturacak hareket bulunmuyor.");
  const maxValue = Math.max(1, ...rows.flatMap(row => kind === "ai" ? [row.requests] : [row.income, row.expense]));
  return `<div class="admin-graph" role="img" aria-label="${kind === "ai" ? "Günlük AI isteklerinin grafiği" : "Günlük gelir ve gider grafiği"}">${rows.map(row => {
    const heights = kind === "ai" ? [row.requests] : [row.income, row.expense];
    const bars = heights.map((value, i) => `<div class="admin-bar ${i === 1 ? "out" : ""}" style="height:${Math.max(2, Number(value || 0) / maxValue * 100)}%" title="${kind === "ai" ? h(format(value) + " istek") : h(moneyLabel(value))}"></div>`).join("");
    return `<div class="admin-graph-col"><div class="admin-bars">${bars}</div><small>${h(row.day.slice(5))}</small></div>`;
  }).join("")}</div>${kind === "ai" ? "" : '<div class="admin-legend"><span>Gelir</span><span>Gider</span></div>'}`;
}
function overview(data) {
  const f = data.finance, c = data.counts;
  const cards = stats(
    stat("Toplam işletme", format(c.businesses), "▥", "Platformda kayıtlı", "purple"),
    stat("Toplam kullanıcı", format(c.users), "♙", "Üyelik hesapları"),
    stat("Dönem gelir", moneyLabel(f.income), "↗", "Manuel OLVEX kayıtları", "teal"),
    stat("Dönem gider", moneyLabel(f.expense), "↘", "Manuel OLVEX kayıtları", "negative")
  );
  const rows = data.latestBusinesses.map(b=>`<tr><td><strong>${escaped(b.name)}</strong><small>${dateLabel(b.created_at)}</small></td><td class="num">${format(b.members)}</td></tr>`).join("");
  const left = panel("Finansal durum", `<div class="admin-kpis" style="grid-template-columns:repeat(2,minmax(0,1fr));">
    ${stat("Net fark", moneyLabel(f.net), "≈", "Gelir − gider", f.net >= 0 ? "teal" : "negative")}
    ${stat("Dönem hareketi", format(f.entries), "≡", "İptal edilmemiş kayıtlar")}
    </div>${info("Bu tutarlar sadece OLVEX'in elle girilmiş platform gelir/gider hareketleridir. İyzico ödemeleri otomatik gelir yazılmaz.")}`);
  const right = panel("Platform durumu", `<div class="admin-quick">
    <a href="#subscriptions">Canlı aktif abonelik <strong>${format(data.subscriptions.liveActive)}</strong></a>
    <a href="#ai">Bugünkü AI istekleri <strong>${format(data.ai.requests)}</strong></a>
    <a href="#businesses">Bağlı kasa kayıtları <strong>${format(c.registers)}</strong></a>
    <a href="#users">Oturumu açık hesaplar <strong>${format(c.loggedInUsers)}</strong></a>
    </div>${info("Aktif abonelik sayısı gelir veya tahsilat tutarı anlamına gelmez.")}`);
  return cards + `<div class="admin-panels">${left}${right}</div>` +
    panel("Son kayıt olan işletmeler", table(["İşletme", "Üye sayısı"], rows),
      `<a href="#businesses" class="admin-mini-label" style="text-decoration:none;">Tümünü gör →</a>`);
}
function businesses(data) {
  const rows = data.rows.map(row=>`<tr><td><strong>${escaped(row.name)}</strong><small>${escaped(row.id.slice(0, 8))}…</small></td>
  <td>${escaped(row.owner_name)}</td><td class="num">${format(row.members)}</td><td class="num">${format(row.registers)}</td><td>${dateLabel(row.created_at)}</td></tr>`).join("");
  return panel("Kayıtlı işletmeler", table(["İşletme", "Hesabı oluşturan", "Üye", "Kasa", "Kayıt"], rows) + pagination(data),
    '<span class="admin-mini-label">Salt okunur</span>');
}
function users(data) {
  const rows = data.rows.map(row=>`<tr><td><strong>${escaped(row.full_name)}</strong></td><td>${escaped(row.email)}</td>
    <td class="num">${format(row.memberships)}</td><td>${dateLabel(row.created_at)}</td></tr>`).join("");
  return panel("Kullanıcı hesapları", table(["Ad soyad", "E-posta", "İşletme üyeliği", "Kayıt"], rows) + pagination(data),
    '<span class="admin-mini-label">Özet bilgiler</span>');
}
function subscriptions(data) {
  const rows = data.rows.map(row => `<tr><td><strong>${escaped(row.business)}</strong></td>
    <td>${escaped(row.plan)}</td><td>${status(row.state, row.state === "active")}</td>
    <td>${status(row.environment, row.environment === "live")}</td><td>${dateLabel(row.created_at)}</td></tr>`).join("");
  return panel("Abonelik durumları", table(["İşletme", "Paket", "Durum", "Ortam", "Oluşturulma"], rows) +
    pagination(data) + info(data.note));
}
function finance(data) {
  const t = data.totals;
  const cards = stats(
    stat("Toplam gelir", moneyLabel(t.income), "↗", "Seçilen dönem", "teal"),
    stat("Toplam gider", moneyLabel(t.expense), "↘", "Seçilen dönem", "negative"),
    stat("Net fark", moneyLabel(t.net), "≈", "Gelir − gider", t.net >= 0 ? "teal" : "negative"),
    stat("İşlem adedi", format(t.entries), "≡", "Geçerli defter hareketleri")
  );
  const chart = panel("Gelir / Gider Grafiği", graph(data.days) +
    info("Grafik yalnızca deftere kaydedilmiş OLVEX platform hareketlerini gösterir."));
  const action = '<button type="button" id="admin-add-ledger" class="admin-primary">+ Yeni gelir / gider</button>';
  const rows = data.rows.map(row=>`<tr class="${row.voided_at ? "is-void" : ""}">
    <td>${dateLabel(row.occurred_on)}</td><td>${status(row.kind === "income" ? "Gelir" : "Gider",row.kind === "income")}</td>
    <td><strong>${escaped(row.description)}</strong><small>${escaped(row.category || "Diğer")}</small></td>
    <td class="num ${row.kind === "income" ? "positive" : "negative"}">${row.kind === "income" ? "+" : "−"}${moneyLabel(row.amount_minor)}</td>
    <td>${row.voided_at ? status("İptal edilmiş") : status("Geçerli",true)}</td>
    <td class="right"><button type="button" data-void-id="${h(row.id)}" class="admin-icon-button" ${row.voided_at ? "disabled" : ""} aria-label="${h(row.description)} kaydını iptal et">İptal et</button></td></tr>`).join("");
  return cards + chart + panel("Platform gelir–gider defteri", table(["Tarih","Tür","Açıklama","Tutar","Durum","İşlem"], rows) +
    pagination(data) + info(data.note), action);
}
function ai(data) {
  const requests = data.models.reduce((sum,x)=>sum+Number(x.requests||0),0);
  const businesses = data.models.length ? "Model bazında" : "—";
  const cards = stats(
    stat("AI isteği", format(requests), "✧", "Seçilen dönem", "purple"),
    stat("Kullanılan model", format(data.models.length), "◇", businesses),
    stat("Girdi token", format(data.models.reduce((a,x)=>a+Number(x.inputTokens||0),0)), "↙", "Ölçülen kullanım"),
    stat("Çıktı token", format(data.models.reduce((a,x)=>a+Number(x.outputTokens||0),0)), "↗", "Ölçülen kullanım")
  );
  const rows = data.models.map(row=>`<tr><td><strong>${escaped(row.model)}</strong></td><td class="num">${format(row.requests)}</td>
  <td class="num">${format(row.businesses)}</td><td class="num">${format(row.inputTokens)}</td><td class="num">${format(row.outputTokens)}</td></tr>`).join("");
  return cards + panel("AI günlük kullanım grafiği",graph(data.days,"ai")) +
    panel("Modellere göre kullanım",table(["Model","İstek","İşletme","Girdi token","Çıktı token"],rows) +
    info("Cloudflare ücretsiz Neuron kullanımı bu tabloda hesaplanmaz. OpenAI için ölçülmüş tahmini token maliyeti, Cloudflare maliyeti yerine geçmez."));
}
function system(data) {
  const rows = data.recent.map(row=>`<tr><td>${dateLabel(row.created_at)}</td><td>${escaped(row.actor)}</td>
    <td>${escaped(row.action === "ledger_create" ? "Gelir/gider kaydı" : "Hareket iptali")}</td>
    <td><code>${escaped(row.subject_id.slice(0, 8))}…</code></td></tr>`).join("");
  return stats(
    stat("D1 bağlantısı", "Aktif", "●", "API üzerinden erişilebilir", "teal"),
    stat("Son migration", data.migration ? "#" + format(data.migration.id) : "—", "▤", data.migration?.name||""),
    stat("İşlem kaydı", format(data.recent.length), "≡", "Son denetim olayları"),
    stat("Platform erişimi", "Özel", "◇", "Hesap ID doğrulaması")
  ) + panel("Yönetici işlem geçmişi", table(["Tarih","Yönetici","İşlem","Kayıt"],rows) +
     info("Platform yönetim hareketleri sunucuda kaydedilir. Yönetici sayfası tek başına ikinci faktör doğrulaması değildir."));
}
const renderers = { overview, businesses, users, finance, subscriptions, ai, system };

function updateNavigation() {
  document.querySelectorAll("[data-admin-view]").forEach(link => {
    if (link.dataset.adminView === state.section) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  $("#admin-title").textContent = sections[state.section][0];
  $("#admin-breadcrumb").textContent = sections[state.section][0];
  $("#admin-subtitle").textContent = sections[state.section][1];
  closeMenu();
}
function closeMenu() {
  $("#admin-sidebar").classList.remove("open");
  $("#admin-backdrop").hidden = true;
  $("#admin-menu-toggle").setAttribute("aria-expanded","false");
}
function showMenu() {
  const next = !$("#admin-sidebar").classList.contains("open");
  $("#admin-sidebar").classList.toggle("open",next);
  $("#admin-backdrop").hidden = !next;
  $("#admin-menu-toggle").setAttribute("aria-expanded",String(next));
}
async function load() {
  if (!authenticated) return;
  const current = ++state.sequence;
  clearNotice();
  updateNavigation();
  const content = $("#admin-content");
  content.setAttribute("aria-busy", "true");
  content.innerHTML = panel("Yükleniyor", '<p class="admin-panel-note">Güncel veriler getiriliyor…</p>');
  const query = new URLSearchParams({ from: state.from, to: state.to, page: String(state.page) });
  try {
    const result = await api(state.section, "GET", undefined, "?" + query);
    if (current !== state.sequence) return;
    content.innerHTML = renderers[state.section](result);
  } catch (error) {
    if (current !== state.sequence) return;
    if (error.status === 401) { location.replace("/login.html"); return; }
    content.innerHTML = panel("Veri getirilemedi", empty(error.message));
    notice(error.message);
  } finally {
    if (current === state.sequence) content.setAttribute("aria-busy","false");
  }
}
function pageFromHash() {
  const name = location.hash.slice(1);
  state.section = Object.hasOwn(sections,name) ? name : "overview";
  state.page = 0;
  void load();
}
function parseTurkishMoney(raw) {
  let input = String(raw ?? "").trim();
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(input)) input = input.replaceAll(".","");
  return toMinor(input);
}
async function saveLedger(event) {
  event.preventDefault();
  const button = $("#admin-ledger-save");
  if (button.disabled) return;
  const form = $("#admin-ledger-form");
  const fields = new FormData(form);
  let amountMinor;
  try { amountMinor = parseTurkishMoney(fields.get("amount")); }
  catch (error) { notice(error.message); return; }
  button.disabled = true;
  try {
    await api("finance","POST", {
      action:"create",requestId:crypto.randomUUID(),
      kind:fields.get("kind"), occurredOn:fields.get("occurredOn"),
      amountMinor,category:fields.get("category"),description:fields.get("description")
    });
    $("#admin-ledger-dialog").close();
    await load();
    notice("Hareket OLVEX platform defterine kaydedildi.", false);
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; }
}
async function voidLedger(id) {
  if (!confirm("Bu gelir/gider kaydını iptal etmek istediğinize emin misiniz? İptal kaydı denetim geçmişinde tutulur.")) return;
  try { await api("finance","POST",{action:"void",id}); await load(); notice("Hareket iptal edildi. Denetim kaydı korundu.",false); }
  catch (error) { notice(error.message); }
}
async function start() {
  $("#admin-from").value = state.from;
  $("#admin-to").value = state.to;
  $("#admin-menu-toggle").addEventListener("click",showMenu);
  $("#admin-backdrop").addEventListener("click",closeMenu);
  $("#admin-refresh").addEventListener("click",()=>void load());
  $("#admin-apply").addEventListener("click",()=>{
    const from=$("#admin-from").value,to=$("#admin-to").value;
    if (!from || !to || from>to) return notice("Geçerli tarih aralığı seçin.");
    state.from=from;state.to=to;state.page=0;void load();
  });
  $("#admin-ledger-close").addEventListener("click",()=>$("#admin-ledger-dialog").close());
  $("#admin-ledger-cancel").addEventListener("click",()=>$("#admin-ledger-dialog").close());
  $("#admin-ledger-form").addEventListener("submit",saveLedger);
  $("#admin-logout").addEventListener("click",async()=>{
    try { await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:"{}"}); } finally { location.replace("/login.html"); }
  });
  $("#admin-content").addEventListener("click",event=>{
    const add=event.target.closest("#admin-add-ledger");
    if(add){$("#admin-ledger-form").reset();$("#admin-ledger-form").elements.occurredOn.value=today();$("#admin-ledger-dialog").showModal();return;}
    const page=event.target.closest("[data-page]");
    if(page && !page.disabled){state.page+=Number(page.dataset.page);void load();return;}
    const remove=event.target.closest("[data-void-id]");
    if(remove && !remove.disabled)void voidLedger(remove.dataset.voidId);
  });
  window.addEventListener("hashchange",pageFromHash);
  try {
    const me=await api("me");
    authenticated=true;
    $("#admin-user").textContent=me.user.name||me.user.email||"Yönetici";
    pageFromHash();
  }catch(error){
    if(error.status===401){location.replace("/login.html?next=admin");return;}
    $("#admin-content").innerHTML=panel("Yönetici erişimi",empty(error.message)+
      info("Bu panel yalnızca özel olarak yetkilendirilmiş Super Admin hesabıyla kullanılabilir."));
    $("#admin-content").setAttribute("aria-busy","false");
    notice(error.message);
  }
}
void start();
