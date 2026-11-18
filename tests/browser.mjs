import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { chromium, devices, webkit } from "playwright-core";
import { offsetDay } from "../assets/ui.js";
import { views } from "../assets/views.js";
import { localPages } from "./local.mjs";
import { landingChecks, widths } from "./landing.mjs";

const local = await localPages({ https: true });
const systemChromium = "/usr/bin/chromium";
const executablePath = process.env.CHROMIUM_PATH || (existsSync(systemChromium) ? systemChromium : undefined);
const snapshots = process.env.OLVEX_SCREENSHOT_DIR;
const credentials = { email: "browser@example.test", password: "Fixture-browser-2026" };
const browser = await chromium.launch({ executablePath, args: ["--enable-unsafe-swiftshader"] }).catch(async (error) => {
  await local.close();
  throw error;
});

async function safeContext(options, engine = browser) {
  const context = await engine.newContext({ locale: "tr-TR", ignoreHTTPSErrors: true, ...options });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === local.url) return route.continue();
    return route.abort();
  });
  return context;
}

const browserErrors = [];
const watch = (page) => page.on("pageerror", (error) => browserErrors.push(error.message));
const dialog = (page) => page.getByRole("dialog");
const loaded = (page) => page.locator('#content[aria-busy="false"]').waitFor();
const heading = (page, text) => page.getByRole("heading", { level: 1, name: text, exact: true }).waitFor();

async function login(page) {
  await page.locator("#email").fill(credentials.email);
  await page.locator("#password").fill(credentials.password);
  await page.locator("#submitButton").click();
}

async function navigate(page, section, title) {
  const nav = page.locator('nav[aria-label="Panel bölümleri"]');
  const active = await page.locator("#menu").isVisible();
  if (active) await page.getByRole("button", { name: "Menüyü aç" }).click();
  await nav.locator(`[data-view="${section}"]`).click();
  await heading(page, title);
  await loaded(page);
  assert.equal(await page.getByText("Yeniden dene", { exact: true }).count(), 0, `${section} yüklenemedi`);
}

async function prepareScreenshot(page, filename) {
  if (!snapshots) return;
  await mkdir(snapshots, { recursive: true });
  await page.screenshot({ path: join(snapshots, filename), fullPage: true, animations: "disabled" });
}

try {
  const desktop = await safeContext({ viewport: { width: 1366, height: 850 }, acceptDownloads: true });
  const page = await desktop.newPage();
  watch(page);
  await page.goto(local.url);
  await page.getByRole("link", { name: "Ücretsiz Hesap Oluştur", exact: true }).first().click();
  await page.locator("#name").fill("Örnek Kullanıcı");
  await page.locator("#email").fill(credentials.email);
  await page.locator("#password").fill(credentials.password);
  await page.locator("#confirmPassword").fill(credentials.password);
  assert.equal(await page.getByRole("link", { name: "Kullanım şartlarını" }).getAttribute("href"), "/terms.html");
  await page.locator("#terms").check();
  await page.getByRole("button", { name: "Ücretsiz Hesap Oluştur" }).click();
  await page.waitForURL(/\/login(?:\.html)?\?registered=1$/);
  await login(page);
  await page.waitForURL(/\/setup(?:\.html)?$/);
  await page.getByLabel("İşletme adı").fill("Atölye Kuzey");
  await page.locator("#submitButton").click();
  await page.waitForURL(/\/app(?:\.html)?(?:\?|#)/);
  await heading(page, "Genel Bakış");
  await loaded(page);
  await page.getByText("Son satışlar", { exact: true }).waitFor();

  await page.keyboard.press("Control+k");
  const palette = page.locator("#module-search");
  const query = page.locator("#module-query");
  await palette.waitFor();
  await query.fill("vardiya");
  await palette.locator('a[href="#shifts"]').waitFor();
  await query.fill("olmayan modül");
  assert.equal(await palette.getByRole("link").count(), 0);
  await query.fill("Ürünler");
  await query.press("Enter");
  await heading(page, "Ürünler ve Stok");
  await loaded(page);
  await palette.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "+ Ürün ekle", exact: true }).click();
  const product = dialog(page);
  await product.getByLabel("Ürün adı").fill("Filtre kahve");
  await product.getByLabel("SKU").fill("KAHVE-01");
  await product.getByLabel("Satış fiyatı (TL)").fill("125,50");
  await product.getByLabel("Birim maliyet (TL)").fill("52,25");
  await product.getByLabel("Kritik stok eşiği").fill("5");
  await product.getByLabel("Açılış stoğu").fill("6");
  await product.getByRole("button", { name: "Kaydet", exact: true }).click();
  await product.waitFor({ state: "hidden" });
  await page.getByText("Filtre kahve", { exact: true }).waitFor();

  await navigate(page, "sales", "Satışlar");
  await page.getByRole("button", { name: "+ Yeni satış", exact: true }).click();
  const saleDialog = dialog(page);
  await saleDialog.getByLabel("Referans").fill("BROWSER-001");
  await saleDialog.getByLabel("Ürün ara").fill("Filtre kahve");
  const picker = saleDialog.getByLabel("Kayıtlı ürünü seç");
  await picker.locator('option[value="KAHVE-01"]').waitFor({ state: "attached" });
  await picker.selectOption("KAHVE-01");
  assert.equal(await saleDialog.getByLabel("SKU").inputValue(), "KAHVE-01");
  await saleDialog.getByLabel("Adet").fill("2");
  assert.match(await saleDialog.locator("[data-order-total]").textContent(), /251,00/);
  await saleDialog.getByRole("button", { name: "+ Satır ekle" }).click();
  assert.equal(await saleDialog.locator(".order-line").count(), 2);
  await saleDialog.getByRole("button", { name: "Ürünü kaldır" }).last().click();
  assert.equal(await saleDialog.locator(".order-line").count(), 1);
  await dialog(page).getByRole("button", { name: "Kaydet", exact: true }).click();
  await dialog(page).waitFor({ state: "hidden" });
  await page.getByText("BROWSER-001", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Ayrıntı", exact: true }).click();
  await dialog(page).getByText("Filtre kahve", { exact: true }).waitFor();
  await dialog(page).getByRole("button", { name: "Kapat", exact: true }).last().click();

  const saleRow = page.getByRole("row").filter({ hasText: "BROWSER-001" });
  await saleRow.getByRole("button", { name: "Tam iade / iptal" }).click();
  await dialog(page).getByText(/BROWSER-001/).waitFor();
  await dialog(page).getByText(/251,00/).waitFor();
  await dialog(page).getByRole("button", { name: "Vazgeç" }).click();
  await saleRow.getByRole("button", { name: "Tam iade / iptal" }).waitFor();

  const csvRegister = await page.request.post(local.url + "/api/workspace/" + await page.locator("#business").inputValue() + "/pos", {
    headers: { Origin: local.url }, data: {
      action: "create", requestId: crypto.randomUUID(), name: "CSV kasa", identityMode: "native", secret: randomBytes(32).toString("base64url")
    }
  });
  assert.ok(csvRegister.ok(), await csvRegister.text());
  await page.getByRole("button", { name: "CSV içe aktar", exact: true }).click();
  await dialog(page).locator('[name="registerId"]').selectOption((await csvRegister.json()).id);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await dialog(page).getByLabel("CSV dosyası").setInputFiles({
    name: "ornek.csv", mimeType: "text/csv",
    buffer: Buffer.from(`referans;tarih;sku;adet;birim_fiyat\nCSV-BROWSER;${date};KAHVE-01;1;124,50`)
  });
  await dialog(page).getByRole("button", { name: "Satışları aktar", exact: true }).click();
  await dialog(page).waitFor({ state: "hidden" });
  await page.getByText("CSV-BROWSER", { exact: false }).waitFor();

  await navigate(page, "ai", "OLVEX AI");
  await page.getByText("Test modu", { exact: true }).waitFor();
  await page.getByText("Ücretsiz veriye dayalı analiz", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Stokları incele", exact: true }).waitFor();
  const prefill = page.locator("[data-prompt]").first();
  await prefill.click();
  assert.ok((await page.getByLabel("Mesaj", { exact: true }).inputValue()).trim().length > 0);
  await page.getByLabel("Mesaj", { exact: true }).fill("gider 125,50 elektrik");
  await page.getByRole("button", { name: "Gönder", exact: true }).click();
  await page.getByRole("button", { name: "Onayı incele", exact: true }).click();
  await dialog(page).getByText("elektrik", { exact: false }).waitFor();
  await dialog(page).getByRole("button", { name: "Onayla ve uygula", exact: true }).click();
  await dialog(page).waitFor({ state: "hidden" });
  await page.getByText("Onay bekleyen işlem yok.", { exact: true }).waitFor();

  await navigate(page, "finance", "Finans");
  await page.getByText("elektrik", { exact: true }).waitFor();
  await navigate(page, "reports", "Raporlar");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV indir" }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /^olvex-rapor-.+\.csv$/);
  assert.match(await readFile(await download.path(), "utf8"), /Brüt kâr TL/);
  // Exercise ranking and comparisons with orders in this test's temporary D1.
  const workspace = await page.locator("#business").inputValue();
  async function record(section, action, body) {
    const response = await page.request.post(local.url + "/api/workspace/" + workspace + "/" + section, {
      headers: {Origin: local.url}, data: {action, requestId:crypto.randomUUID(), ...body}
    });
    assert.ok(response.ok(), await response.text());
  }
  await record("products", "save", {sku:"FIN-02", name:"Seramik fincan", price:24500, cost:10200, opening:150, reorder:5});
  for (const [index, quantity] of [24, 3, 9, 5, 14, 8, 17, 10, 19].entries()) {
    const daysAgo = index === 0 ? 38 : 32 - index * 4;
    await record("sales", "create", {date:offsetDay(date,-daysAgo), paid:true,
      reference:"FIN-" + (100 + index), lines:[{sku:"FIN-02", quantity}]});
  }
  await navigate(page, "overview", "Genel Bakış");
  await page.locator(".ranking").getByText("Filtre kahve").waitFor();
  await page.locator(".revenue .delta").waitFor();
  const chartData = page.locator("details").filter({ has: page.getByText("Grafik verilerini göster", { exact: true }) });
  await chartData.locator("summary").click();
  assert.ok(await chartData.getByRole("row").count() > 1);
  await chartData.locator("summary").click();
  await page.locator("#alerts summary").click();
  await page.getByText("1 ürün kritik stokta").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", {name:"Menüyü daralt"}).click();
  assert.equal(await page.locator("#rail-toggle").getAttribute("aria-expanded"), "false");
  await page.getByRole("button", {name:"Menüyü genişlet"}).click();
  await prepareScreenshot(page, "panel-desktop.png");
  await page.getByRole("button", {name:"Bekleyenleri aç"}).click();
  await heading(page, "Satışlar");
  await loaded(page);
  assert.equal(await page.getByLabel("Tahsilat bekleyenler").isChecked(), true);
  assert.equal(await page.locator("tbody tr").count(), 1);
  const unpaidRow = page.getByRole("row").filter({ hasText: "CSV-BROWSER" });
  await unpaidRow.getByRole("button", { name: "Tahsilat kaydet" }).click();
  await dialog(page).getByText(/CSV-BROWSER/).waitFor();
  await dialog(page).getByText(/124,50/).waitFor();
  await dialog(page).getByRole("button", { name: "Vazgeç" }).click();
  await unpaidRow.getByRole("button", { name: "Tahsilat kaydet" }).waitFor();
  await page.route("**/api/workspace/*/customers?**", route => route.fulfill({
    status:503, contentType:"application/json", body:JSON.stringify({error:"Geçici bağlantı hatası"})
  }), {times:1});
  await page.locator('a[data-view="customers"]').click();
  await page.getByRole("button", {name:"Yeniden dene"}).click();
  await page.getByText("Bu görünümde müşteri yok.").waitFor();

  for (const [section, text] of [
    ["purchases", "Satın Alma"], ["customers", "Müşteriler"], ["invoices", "Faturalar"],
    ["employees", "Personel"], ["tasks", "Görev ve Takvim"], ["branches", "İşletmeler"],
    ["settings", "Ayarlar"]
  ]) await navigate(page, section, text);
  await page.getByRole("link", { name: "Kasa bağlantıları", exact: true }).click();
  await heading(page, "Kasa Bağlantıları");
  await loaded(page);
  await page.getByRole("link", { name: "Şubeler", exact: true }).click();
  await page.getByRole("button", { name: "+ Şube ekle" }).click();
  await dialog(page).getByLabel("Şube adı").fill("İskele");
  await dialog(page).getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "İskele" }).getByRole("button", { name: "Şube stoklarını göster" }).click();
  const coffee = page.getByRole("row").filter({ hasText: "Filtre kahve" });
  await coffee.getByRole("cell", { name: "0", exact: true }).waitFor();
  assert.equal(await coffee.locator('[data-label="İşletme stoku"]').innerText(), "3");
  await coffee.getByRole("button", { name: "Stok düzelt" }).click();
  assert.equal(await dialog(page).locator('[name="branchId"]').evaluate(el => el.selectedOptions[0].textContent), "İskele");
  await dialog(page).getByLabel("Adet farkı").fill("2");
  await dialog(page).getByLabel("Düzeltme nedeni").fill("Depo sayımı");
  await dialog(page).getByRole("button", { name: "Kaydet", exact: true }).click();
  await coffee.getByRole("cell", { name: "2", exact: true }).waitFor();
  assert.equal(await coffee.locator('[data-label="İşletme stoku"]').innerText(), "5");

  await navigate(page, "settings", "Ayarlar");
  await page.getByRole("link", { name: "Kasa bağlantıları", exact: true }).click();
  await page.getByRole("button", { name: "+ Bağlantı oluştur" }).click();
  await dialog(page).getByLabel("Bağlantı adı").fill("Örnek kasa");
  await dialog(page).locator('[name="branchId"]').selectOption({ label: "İskele" });
  await dialog(page).getByLabel("İşlem kimliği").selectOption("reconcile");
  await dialog(page).getByRole("button", { name: "Kaydet", exact: true }).click();
  await dialog(page).getByRole("heading", { name: "Kasa bağlantı anahtarı" }).waitFor();
  const initialKey = await dialog(page).getByLabel("Kopyalanacak değer").inputValue();
  assert.match(initialKey, /^olvex_pos_[A-Za-z0-9_-]{43}$/);
  await dialog(page).getByRole("button", { name: "Kapat", exact: true }).last().click();
  const register = page.getByRole("row").filter({ hasText: "Örnek kasa" });
  await register.getByRole("cell", { name: "İskele", exact: true }).waitFor();
  await register.getByRole("button", { name: "Kaynak kaydını eşleştir" }).click();
  await dialog(page).getByLabel("Kaynak belgedeki kalıcı konum").fill("journal-84/row-33");
  await dialog(page).getByLabel("Doğrulanan işlem referansı").fill("ISKELE-33");
  await dialog(page).getByRole("button", { name: "Kaydet", exact: true }).click();
  await dialog(page).waitFor({ state: "hidden" });
  await register.getByRole("button", { name: "Anahtarı yenile" }).click();
  await dialog(page).getByRole("button", { name: "Yeni anahtar oluştur" }).click();
  await dialog(page).getByRole("heading", { name: "Yeni kasa bağlantı anahtarı" }).waitFor();
  const replacementKey = await dialog(page).getByLabel("Kopyalanacak değer").inputValue();
  assert.match(replacementKey, /^olvex_pos_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(replacementKey, initialKey);
  await dialog(page).getByRole("button", { name: "Kapat", exact: true }).last().click();

  // Join as a real member to verify the search uses the selected business role.
  const member = await safeContext();
  try {
    const email = "member-browser@example.test";
    const secret = randomBytes(32).toString("base64url");
    const { termsVersion } = await (await member.request.get(local.url + "/api/public-info")).json();
    const memberPost = (path, data) => member.request.post(local.url + path, { headers: { Origin: local.url }, data });
    assert.equal((await memberPost("/api/auth/register", { fullName: "Ekip Üyesi",
      email, password: credentials.password, acceptedTerms: true, termsVersion })).status(), 201);
    assert.ok((await memberPost("/api/auth/login", { email, password: credentials.password })).ok());
    await record("settings", "invite", { email, role: "member", secret });
    assert.ok((await memberPost("/api/join", { token: secret })).ok());
    const memberPage = await member.newPage();
    watch(memberPage);
    await memberPage.goto(local.url + "/app.html#overview");
    await loaded(memberPage);
    await memberPage.locator("#module-search-open").click();
    const links = memberPage.locator("#module-search a");
    const routes = await links.evaluateAll(nodes => nodes.map(node => node.hash.slice(1)).sort());
    assert.deepEqual(routes, Object.keys(views).filter(route => !views[route][3]).sort());
    await memberPage.keyboard.press("Escape");
    assert.equal(await memberPage.locator("#module-search-open").evaluate(button => button === document.activeElement), true);
  } finally { await member.close(); }

  const mobile = await safeContext({
    ...devices["Pixel 7"], viewport: { width: 390, height: 844 },
    storageState: await desktop.storageState()
  });
  const handset = await mobile.newPage();
  watch(handset);
  await handset.goto(`${local.url}/app.html#overview`);
  await heading(handset, "Genel Bakış");
  await loaded(handset);
  await prepareScreenshot(handset, "panel-mobile.png");
  await navigate(handset, "products", "Ürünler ve Stok");
  await handset.getByText("Filtre kahve", { exact: true }).waitFor();
  assert.equal(await handset.locator("#sidebar").isVisible(), false);
  for (const width of widths) {
    await handset.setViewportSize({width, height: 900});
    for (const [route, [title]] of Object.entries(views)) {
      await handset.evaluate(hash => { location.hash = hash; }, route);
      await heading(handset, title);
      await loaded(handset);
      assert.equal(await handset.locator('[data-cmd="retry"]').count(), 0, route);
      assert.equal(await handset.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        true, route + " at " + width);
    }
  }
  await handset.setViewportSize({width:320, height:680});
  let releaseResponse;
  const release = new Promise(done => { releaseResponse = done; });
  await handset.route("**/api/workspace/*/overview?**", async route => {
    const response = await route.fetch();
    const summary = await response.json();
    summary.totals.sales = 98765432109876;
    summary.latest[0].reference = "Uzun referans ".repeat(7);
    summary.leaders[0].name = "ÇokUzunÜrünAdı".repeat(8);
    await release;
    await route.fulfill({response, json:summary});
  }, {times:1});
  await handset.evaluate(() => { location.hash = "overview"; });
  await handset.locator(".loading-panel").waitFor();
  releaseResponse();
  await loaded(handset);
  assert.equal(await handset.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  if (process.env.OLVEX_WEBKIT) {
    const safari = await webkit.launch();
    try {
      const context = await safeContext({ viewport: { width: 440, height: 956 }, isMobile: true,
        hasTouch: true, deviceScaleFactor: 3, storageState: await desktop.storageState() }, safari);
      const phone = await context.newPage();
      watch(phone);
      await phone.goto(local.url + "/app.html#overview");
      await loaded(phone);
      await phone.locator("[data-period]").selectOption({label:"Bugün"});
      await loaded(phone);
      assert.equal(await phone.locator(".chart-point").count(), 1);
      await phone.locator(".chart-point").tap();
      await prepareScreenshot(phone, "panel-webkit-mobile.png");
      await phone.locator("[data-period]").selectOption("custom");
      await phone.locator("[name=from]").fill("2020-01-01");
      await phone.locator("[name=to]").fill("2020-01-02");
      await phone.getByRole("button", {name:"Uygula"}).tap();
      await phone.locator(".chart-empty").waitFor();
      await phone.getByRole("button", {name:"Menüyü aç"}).tap();
      await prepareScreenshot(phone, "menu-webkit-mobile.png");
      await phone.locator("#close-menu").tap();
      await navigate(phone, "products", "Ürünler ve Stok");
      await phone.locator('[data-cmd="edit-product"]').first().tap();
      await dialog(phone).getByLabel("Ürün adı").fill("Yerel taslak");
      await phone.setViewportSize({width:440,height:500});
      await dialog(phone).getByRole("button", { name: "Vazgeç" }).tap();
      await dialog(phone).waitFor({state:"hidden"});
    } finally { await safari.close(); }
  }
  await handset.setViewportSize({ width: 390, height: 844 });
  await handset.getByRole("button", { name: "Menüyü aç" }).click();
  await handset.getByRole("button", { name: "Çıkış yap" }).click();
  await handset.waitForURL(/\/login(?:\.html)?$/);
  await handset.goto(`${local.url}/app.html`);
  await handset.waitForURL(/\/login(?:\.html)?$/);
  await landingChecks({ safeContext, url: local.url, snapshots });
  assert.deepEqual(browserErrors, []);
  console.log("Tarayıcı doğrulandı: masaüstü ve mobil akış, satış/CSV, AI onayı, rapor, kasa ve oturum.");
} finally {
  await browser.close();
  await local.close();
}
