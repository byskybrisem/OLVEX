import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { chromium, devices, firefox, webkit } from "playwright-core";
import { offsetDay } from "../assets/ui.js";
import { views } from "../assets/views.js";
import { localPages } from "./local.mjs";
import { landingChecks, widths } from "./landing.mjs";

const desktopEngineName = process.env.OLVEX_DESKTOP_BROWSER || "chromium";
assert.ok(["chromium", "firefox", "webkit"].includes(desktopEngineName), "Unknown desktop engine");
const local = await localPages({ professionalFixtures: true, https: true });
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

const legalPaths = ["/terms.html", "/privacy.html", "/contact.html", "/pre-information.html",
  "/distance-service-agreement.html", "/subscription-terms.html", "/cookies.html"];
const fitsViewport = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function legalChecks(context) {
  const legal = await context.newPage();
  watch(legal);
  for (const width of [320, 768, 1440]) {
    await legal.setViewportSize({ width, height: 850 });
    const landing = await legal.goto(local.url);
    assert.ok(landing.ok());
    const links = await legal.locator("footer .legal-nav a").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
    assert.deepEqual([...links].sort(), [...legalPaths].sort());
    for (const path of legalPaths) {
      const response = await legal.goto(local.url + path);
      assert.ok(response.ok(), path);
      assert.equal(await legal.locator("main h1").count(), 1, path);
      assert.equal(await fitsViewport(legal), true, `${path} · ${width}px`);
      assert.equal(await legal.locator('footer a[aria-current="page"]').getAttribute("href"), path);
    }
    for (const path of ["/login", "/register", "/forgot-password", "/setup?new=1"]) {
      // Auth pages can redirect based on session and setup state.
      const auth = await context.newPage();
      watch(auth);
      await auth.setViewportSize({ width, height: 850 });
      const response = await auth.goto(local.url + path, { waitUntil: "commit" });
      assert.ok(response.ok(), path);
      await auth.locator("main").first().waitFor();
      assert.equal(await fitsViewport(auth), true, `${path} · ${width}px`);
      await auth.close();
    }
  }
  await legal.close();
}

async function preferencesChecks(page) {
  const banner = page.locator("[data-preference-banner]");
  const optional = () => page.evaluate(() => Object.keys(localStorage)
    .filter(key => key === "olvex:collapsed" || key.startsWith("olvex:business:")));
  await banner.waitFor();
  assert.deepEqual(await optional(), []);
  assert.equal(await fitsViewport(page), true);
  const reject = banner.getByRole("button", { name: "Tümünü reddet" });
  await reject.focus();
  await page.keyboard.press("Enter");
  await banner.waitFor({ state: "hidden" });
  await page.reload();
  await loaded(page);
  assert.deepEqual(await optional(), []);
  assert.equal(await banner.isHidden(), true);
  await page.goto(local.url + "/cookies.html#browser-preferences");
  await page.getByText("Panel tercihleri kapalı.").waitFor();
  await page.getByRole("button", { name: "Tümünü kabul et" }).click();
  await page.getByText("Panel tercihleri açık.").waitFor();
  await page.getByRole("link", { name: "Panele dön" }).click();
  await loaded(page);
  assert.ok((await optional()).some(key => key.startsWith("olvex:business:")));
  const rail = page.locator("#rail-toggle");
  await rail.click();
  await page.reload();
  await loaded(page);
  assert.equal(await rail.getAttribute("aria-expanded"), "false");
  await rail.click();
  await page.goto(local.url + "/cookies.html#browser-preferences");
  await page.getByRole("button", { name: "Tümünü reddet" }).click();
  assert.deepEqual(await optional(), []);
  await page.getByRole("link", { name: "Panele dön" }).click();
  await loaded(page);
  assert.equal(await banner.isHidden(), true);
  assert.deepEqual(await optional(), []);
}

let desktopEngine = browser;
try {
  if (desktopEngineName === "firefox") desktopEngine = await firefox.launch();
  if (desktopEngineName === "webkit") desktopEngine = await webkit.launch();
  console.log("Masaüstü iş akışı", desktopEngineName, desktopEngine.version());
  const desktop = await safeContext({ viewport: { width: 1366, height: 850 }, acceptDownloads: true }, desktopEngine);
  const page = await desktop.newPage();
  watch(page);
  await page.goto(local.url);
  await page.getByRole("link", { name: "Hesap oluştur", exact: true }).first().click();
  await page.locator("#name").fill("Örnek Kullanıcı");
  await page.locator("#email").fill(credentials.email);
  await page.locator("#password").fill(credentials.password);
  await page.locator("#confirmPassword").fill(credentials.password);
  assert.equal(await page.getByRole("link", { name: "Kullanım şartlarını" }).getAttribute("href"), "/terms.html");
  await page.locator("#terms").check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page.waitForURL(/\/login(?:\.html)?\?registered=1$/);
  await login(page);
  await page.waitForURL(/\/setup(?:\.html)?$/);
  await page.getByLabel("İşletme adı").fill("Atölye Kuzey");
  await page.locator("#submitButton").click();
  await page.waitForURL(/\/app(?:\.html)?(?:\?|#)/);
  await heading(page, "Genel Bakış");
  await loaded(page);
  await page.getByText("Son satışlar", { exact: true }).waitFor();
  await preferencesChecks(page);
  await legalChecks(desktop);

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
  await page.getByRole("heading", { name: "İşletmen için ne yapabilirim?" }).waitFor();
  await prepareScreenshot(page, "ai-desktop-welcome.png");
  await page.getByRole("button", { name: "İşletme Özeti" }).click();
  const summary = page.getByRole("dialog", { name: "İşletme Özeti" });
  await summary.getByText("Ücretsiz veriye dayalı analiz", { exact: true }).waitFor();
  await summary.getByText("Bugün satış", { exact: true }).waitFor();
  await summary.getByRole("button", { name: "Kapat", exact: true }).click();

  const suggestion = page.getByRole("button", { name: "Satışlarımı analiz et" });
  await suggestion.click();
  await page.getByText("OLVEX kayıtları", { exact: true }).waitFor();
  assert.equal(await suggestion.isVisible(), false);
  const prompt = page.getByRole("textbox", { name: "Mesaj", exact: true });
  await prompt.fill("Birinci satır");
  await prompt.press("Shift+Enter");
  assert.equal(await prompt.inputValue(), "Birinci satır\n");
  const attempts = [];
  await page.route("**/api/workspace/*/ai", route => {
    if (route.request().method() !== "POST" || route.request().postDataJSON().action !== "send") return route.fallback();
    attempts.push(route.request().postDataJSON().requestId);
    return route.abort("internetdisconnected");
  }, { times: 1 });
  await prompt.fill("gider 125,50 elektrik");
  await page.getByRole("button", { name: "Gönder", exact: true }).click();
  const retry = page.getByRole("button", { name: "Yeniden gönder" });
  await retry.waitFor();
  page.on("request", request => {
    if (request.method() === "POST" && request.url().endsWith("/ai") && request.postDataJSON().action === "send")
      attempts.push(request.postDataJSON().requestId);
  });
  await retry.click();
  const card = page.locator(".ai-draft");
  await card.getByRole("button", { name: "Onayla", exact: true }).click();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0], attempts[1]);
  await dialog(page).getByText("elektrik", { exact: false }).waitFor();
  await dialog(page).getByRole("button", { name: "Onayla ve uygula", exact: true }).click();
  await dialog(page).waitFor({ state: "hidden" });
  await card.getByText("Uygulandı", { exact: true }).waitFor();
  await prepareScreenshot(page, "ai-desktop-thread.png");
  await page.reload();
  await card.getByText("Uygulandı", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Geçmiş", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Sohbet geçmişi" });
  await history.getByRole("button", { name: "Yeniden adlandır", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Sohbeti yeniden adlandır" });
  const chatTitle = "<img src=x onerror=alert(1)>";
  await rename.getByLabel("Sohbet adı").fill(chatTitle);
  await rename.getByRole("button", { name: "Kaydet", exact: true }).click();
  await history.getByText(chatTitle, { exact: true }).waitFor();
  assert.equal(await history.locator("img").count(), 0);
  await history.getByRole("button", { name: "Kapat", exact: true }).click();
  await page.getByRole("combobox", { name: "Şube", exact: true }).selectOption({ label: "Merkez" });
  await page.getByText("Şube değişti. Yeni sohbet açıldı.").waitFor();
  await suggestion.waitFor();
  await page.getByRole("button", { name: "Yeni sohbet" }).click();
  await suggestion.waitFor();
  await page.getByRole("button", { name: "Geçmiş", exact: true }).click();
  await history.getByRole("button", { name: chatTitle, exact: false }).click();
  await card.getByText("Uygulandı", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Geçmiş", exact: true }).click();
  await history.getByRole("button", { name: "Sil", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "Sohbeti sil" });
  await deletion.getByRole("button", { name: "Sohbeti sil", exact: true }).click();
  await history.getByText("Henüz kayıtlı sohbet yok.", { exact: true }).waitFor();
  await history.getByRole("button", { name: "Kapat", exact: true }).click();
  await suggestion.waitFor();

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
  await page.getByText("1 şube stok uyarısı").waitFor();
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
  await navigate(page, "products", "Ürünler ve Stok");
  const coffeeStock = page.getByRole("row").filter({ hasText: "KAHVE-01" }).locator('[data-label="İşletme stoku"]');
  assert.equal((await coffeeStock.innerText()).trim(), "3", "6 opening - 2 manual - 1 CSV sale");
  // Correct an unpaid manual sale and follow the stock delta and immutable history in the UI.
  await record("sales", "create", {date, paid: false, reference: "REV-1", lines: [{sku: "KAHVE-01", quantity: 1}]});
  await navigate(page, "sales", "Satışlar");
  const editedRow = page.getByRole("row").filter({hasText: "REV-1"});
  await editedRow.getByRole("button", {name: "Düzenle", exact: true}).click();
  const correction = page.getByRole("dialog", {name: "Satışı düzenle"});
  await correction.getByLabel("Adet", {exact: true}).fill("2");
  await correction.getByLabel("Birim fiyat", {exact: true}).fill("80,00");
  await correction.getByLabel("Düzeltme nedeni").fill("Müşteri iki paket aldı");
  await correction.getByRole("button", {name: "Düzeltmeyi kaydet"}).click();
  await correction.waitFor({state:"hidden"});
  await editedRow.getByText(/160,00/).waitFor();
  await editedRow.getByRole("button", {name: "Ayrıntı"}).click();
  await dialog(page).getByRole("button", {name:"Düzeltmeleri göster"}).click();
  await dialog(page).getByText("Müşteri iki paket aldı", {exact:false}).waitFor();
  if (snapshots) {
    await mkdir(snapshots, {recursive:true});
    await dialog(page).screenshot({path: join(snapshots, "sale-correction.png"), animations:"disabled"});
  }
  await dialog(page).getByRole("button", {name:"Kapat", exact:true}).last().click();
  await navigate(page, "products", "Ürünler ve Stok");
  assert.equal((await coffeeStock.innerText()).trim(), "1", "Only the quantity difference is applied on correction");
  await navigate(page, "sales", "Satışlar");
  await page.getByLabel("Tahsilat bekleyenler").uncheck();
  await page.getByRole("button", { name: "Uygula" }).click();
  await saleRow.waitFor();
  await editedRow.getByRole("button", { name: "Tahsilat kaydet" }).click();
  await dialog(page).getByText(/160,00/).waitFor();
  await dialog(page).getByRole("button", { name: "Tahsilatı kaydet" }).click();
  await editedRow.getByText("Tahsil edildi").waitFor();
  await editedRow.getByRole("button", { name: "Tam iade / iptal" }).click();
  await dialog(page).getByRole("button", { name: "İptali onayla" }).click();
  await editedRow.getByText("İptal", { exact: true }).waitFor();
  await navigate(page, "products", "Ürünler ve Stok");
  assert.equal((await coffeeStock.innerText()).trim(), "3", "Refund restores both corrected units");

  await page.route("**/api/workspace/*/customers?**", route => route.fulfill({
    status:503, contentType:"application/json", body:JSON.stringify({error:"Geçici bağlantı hatası"})
  }), {times:1});
  await page.locator('a[data-view="customers"]').click();
  await page.getByRole("button", {name:"Yeniden dene"}).click();
  await page.getByText("Bu görünümde müşteri yok.").waitFor();

  for (const [section, text] of [
    ["purchases", "Satın Alma"], ["customers", "Müşteriler"], ["invoices", "Faturalar"],
    ["tasks", "Görev ve Takvim"], ["branches", "İşletmeler"],
    ["settings", "Ayarlar"]
  ]) await navigate(page, section, text);
  await navigate(page, "employees", "Personel");
  await page.getByRole("link", { name: "Vardiyalar", exact: true }).click();
  await heading(page, "Vardiyalar");
  await loaded(page);
  await page.getByRole("button", { name: "+ Vardiya ekle", exact: true }).waitFor();
  await navigate(page, "settings", "Ayarlar");
  await page.getByRole("heading", { name: "Paket · Profesyonel" }).waitFor();
  await page.getByText(/bekleyen davet\./).waitFor();
  await page.getByRole("link", { name: "Aboneliği yönet" }).click();
  await page.getByText("Kartla 14 günlük deneme henüz açık değil.").waitFor();
  assert.equal(await page.locator("#billingForm").isVisible(), false);
  await page.goBack();
  await page.getByRole("heading", { name: "Paket · Profesyonel" }).waitFor();

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
  // Onboarding first: customers choose the physical POS and its sales program.
  await page.getByRole("button", { name: "Kasa ve yazılım seç" }).first().click();
  const guideDialog = dialog(page);
  await guideDialog.getByLabel("1. Kasa türü").selectOption("ynokc");
  await guideDialog.getByLabel("2. Yazarkasa POS markası").selectOption("worldline");
  await guideDialog.getByLabel("3. Satış / kasa yazılımı").selectOption("wolvox_fast");
  await guideDialog.getByLabel("Model (isteğe bağlı)").fill("Move/5000");
  await guideDialog.getByRole("button", { name: "Kurulum rehberini göster" }).click();
  await guideDialog.getByRole("heading", { name: "Size uygun bağlantı rehberi" }).waitFor();
  await guideDialog.getByText("Worldline / Ingenico · Move/5000 · AKINSOFT WOLVOX Hızlı Satış").waitFor();
  await guideDialog.getByRole("link", { name: "AKINSOFT Worldline ÖKC bilgisi" }).waitFor();
  await guideDialog.getByText(/hazır bir WOLVOX bağlayıcısı henüz sunulmuyor/).waitFor();
  await guideDialog.getByRole("button", { name: "API anahtarı oluştur" }).click();
  await guideDialog.getByRole("heading", { name: "Kasa bağlantısı oluştur" }).waitFor();
  await guideDialog.locator('[name="branchId"]').selectOption({ label: "İskele" });
  await guideDialog.getByRole("button", { name: "Kasaya geç" }).click();
  assert.match(await guideDialog.getByLabel("Bağlantı adı").inputValue(), /Worldline.*WOLVOX/);
  // The guided flow can create a token without depending on migration 0011.
  assert.equal(await guideDialog.locator('[name="brand"]').count(), 0);
  await guideDialog.getByRole("button", { name: "Vazgeç" }).click();
  await guideDialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "+ Bağlantı oluştur" }).click();
  await dialog(page).locator('[name="branchId"]').selectOption({ label: "İskele" });
  await dialog(page).getByRole("button", { name: "Kasaya geç" }).click();
  await dialog(page).getByLabel("Bağlantı adı").fill("Örnek kasa");
  await dialog(page).getByLabel(/Kasa markası/).fill("Örnek donanım");
  await dialog(page).getByLabel(/Satış yazılımı/).fill("Örnek yazılım 2");
  await dialog(page).getByRole("button", { name: "Şubeyi değiştir" }).click();
  assert.equal(await dialog(page).locator('[name="branchId"] option:checked').innerText(), "İskele");
  await dialog(page).getByRole("button", { name: "Kasaya geç" }).click();
  await dialog(page).getByLabel("İşlem kimliği").selectOption("reconcile");
  await dialog(page).getByRole("button", { name: "Kaydet", exact: true }).click();
  await dialog(page).getByRole("heading", { name: "Kasa bağlantı anahtarı" }).waitFor();
  const initialKey = await dialog(page).getByLabel("Kopyalanacak değer").inputValue();
  assert.match(initialKey, /^olvex_pos_[A-Za-z0-9_-]{43}$/);
  await dialog(page).getByRole("button", { name: "Kapat", exact: true }).last().click();
  const register = page.getByRole("row").filter({ hasText: "Örnek kasa" });
  await register.getByRole("cell", { name: "İskele", exact: true }).waitFor();
  await register.getByText("API aktarımı bekleniyor", { exact: true }).waitFor();
  await register.getByText("Örnek donanım · Örnek yazılım 2", { exact: true }).waitFor();
  const template = await page.request.get(local.url + "/assets/olvex-kasa-ornek.csv");
  assert.equal(template.ok(), true);
  assert.match(await template.text(), /^referans;tarih;sku;adet;birim_fiyat/);
  const unauthorized = await page.request.post(local.url + "/api/pos", { data: { action: "sale" } });
  assert.equal(unauthorized.status(), 401);
  await prepareScreenshot(page, "pos-guide.png");
  await register.getByRole("button", { name: "Kaynak kaydını eşleştir" }).click();
  await dialog(page).getByLabel("Kaynak belgedeki kalıcı konum").fill("journal-84/row-33");
  await dialog(page).getByLabel("Doğrulanan işlem referansı").fill("ISKELE-33");
  await dialog(page).getByRole("button", { name: "Kaydet", exact: true }).click();
  await dialog(page).waitFor({ state: "hidden" });
  await register.getByRole("button", { name: "Kaynak kaydını eşleştir" }).click();
  await dialog(page).getByLabel("Kaynak kaydının türü").selectOption("return");
  await dialog(page).getByLabel("Kaynak belgedeki kalıcı konum").fill("journal-84/row-34");
  await dialog(page).getByLabel("Doğrulanan işlem referansı").fill("ISKELE-34");
  await dialog(page).getByRole("button", { name: "Kaydet", exact: true }).click();
  await dialog(page).waitFor({ state: "hidden" });
  await register.getByRole("button", { name: "Anahtarı yenile" }).click();
  await dialog(page).getByRole("button", { name: "Yeni anahtar oluştur" }).click();
  await dialog(page).getByRole("heading", { name: "Yeni kasa bağlantı anahtarı" }).waitFor();
  const replacementKey = await dialog(page).getByLabel("Kopyalanacak değer").inputValue();
  assert.match(replacementKey, /^olvex_pos_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(replacementKey, initialKey);
  await dialog(page).getByRole("button", { name: "Kapat", exact: true }).last().click();

  const registerEvent = (data) => page.request.post(local.url + "/api/pos", {
    headers: { Authorization: "Bearer " + replacementKey }, data
  });
  const tillSale = { action: "sale", evidence: "journal-84/row-33", date, paid: false,
    lines: [{ sku: "KAHVE-01", quantity: 2, unit: 9000 }] };
  const firstReceipt = await registerEvent(tillSale);
  assert.equal(firstReceipt.status(), 201, await firstReceipt.text());
  const duplicateReceipt = await registerEvent(tillSale);
  assert.equal(duplicateReceipt.status(), 200, await duplicateReceipt.text());
  assert.equal((await firstReceipt.json()).id, (await duplicateReceipt.json()).id);
  const partialReturn = await registerEvent({ action: "return", evidence: "journal-84/row-34",
    saleEvidence: tillSale.evidence, date, lines: [{ sku: "KAHVE-01", quantity: 1 }] });
  assert.equal(partialReturn.status(), 201, await partialReturn.text());
  await page.getByRole("button", { name: "Durumu yenile" }).click();
  await loaded(page);
  await register.getByText("API aktarımı alındı", { exact: true }).waitFor();
  await register.getByText(/Son başarılı API aktarımı:/).waitFor();
  await navigate(page, "sales", "Satışlar");
  const tillRow = page.getByRole("row").filter({ hasText: "ISKELE-33" });
  await tillRow.getByText("Kısmi iade", { exact: true }).waitFor();
  assert.match(await tillRow.innerText(), /Örnek kasa/);
  assert.equal(await tillRow.getByRole("button", { name: "Düzenle", exact: true }).count(), 0);
  await tillRow.getByRole("button", { name: "Ayrıntı" }).click();
  await dialog(page).getByText("Kasa · Örnek kasa", { exact: true }).waitFor();
  const returnedLine = dialog(page).getByRole("row").filter({ hasText: "KAHVE-01" });
  assert.equal(await returnedLine.locator('[data-label="Satılan"]').innerText(), "2");
  assert.equal(await returnedLine.locator('[data-label="İade"]').innerText(), "1");
  assert.equal(await returnedLine.locator('[data-label="Kalan adet"]').innerText(), "1");
  await dialog(page).getByRole("button", { name: "Kapat", exact: true }).last().click();
  await tillRow.getByRole("button", { name: "Tahsilat kaydet" }).click();
  await dialog(page).getByText(/90,00/).waitFor();
  await dialog(page).getByRole("button", { name: "Tahsilatı kaydet" }).click();
  await tillRow.getByText("Tahsil edildi").waitFor();
  await navigate(page, "products", "Ürünler ve Stok");
  await coffee.getByRole("cell", { name: "1", exact: true }).waitFor();
  assert.equal(await coffee.locator('[data-label="İşletme stoku"]').innerText(), "4");

  // Join as a real member to verify the search uses the selected business role.
  const member = await safeContext({}, desktopEngine);
  try {
    const email = "member-browser@example.test";
    const secret = randomBytes(32).toString("base64url");
    const { termsVersion } = await (await member.request.get(local.url + "/api/public-info")).json();
    const memberPost = (path, data) => member.request.post(local.url + path, { headers: { Origin: local.url }, data });
    assert.equal((await memberPost("/api/auth/register", { fullName: "Ekip Üyesi",
      email, password: credentials.password, acceptedTerms: true, termsVersion })).status(), 202);
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
      await phone.goto(local.url + "/cookies.html");
      assert.equal(await fitsViewport(phone), true);
      await phone.getByRole("button", { name: "Tümünü reddet" }).tap();
      await phone.getByText("Panel tercihleri kapalı.").waitFor();
      await prepareScreenshot(phone, "cookies-webkit-mobile.png");
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
      await navigate(phone, "settings", "Ayarlar");
      await phone.getByRole("link", { name: "Kasa bağlantıları", exact: true }).tap();
      await heading(phone, "Kasa Bağlantıları");
      await loaded(phone);
      await phone.setViewportSize({width:320,height:550});
      assert.equal(await fitsViewport(phone), true);
      await phone.getByRole("button", { name: "+ Bağlantı oluştur" }).tap();
      await dialog(phone).getByLabel("Şube", {exact:true}).selectOption({label:"İskele"});
      await dialog(phone).getByRole("button", { name: "Kasaya geç" }).tap();
      await dialog(phone).getByLabel("Bağlantı adı").fill("Yerel kasa taslağı");
      await dialog(phone).getByRole("button", { name: "Vazgeç" }).tap();
      await dialog(phone).waitFor({state:"hidden"});
      await navigate(phone, "ai", "OLVEX AI");
      await phone.setViewportSize({width:390,height:760});
      await phone.getByRole("heading", { name: "İşletmen için ne yapabilirim?" }).waitFor();
      const lastSuggestion = await phone.getByRole("button", { name: "Bana öneriler ver" }).boundingBox();
      const transcriptBox = await phone.locator(".ai-scroll").boundingBox();
      assert.ok(lastSuggestion.y + lastSuggestion.height <= transcriptBox.y + transcriptBox.height);
      await prepareScreenshot(phone, "ai-webkit-welcome.png");
      const mobilePrompt = phone.getByRole("textbox", {name:"Mesaj",exact:true});
      await mobilePrompt.tap();
      await phone.setViewportSize({width:320,height:440});
      assert.equal(await fitsViewport(phone), true);
      const composerBox = await mobilePrompt.boundingBox();
      assert.ok(composerBox.y + composerBox.height <= 440);
      await mobilePrompt.fill("gider 10,25 kağıt");
      await phone.getByRole("button", { name: "Gönder", exact: true }).tap();
      await phone.locator(".ai-draft").getByRole("button", { name: "Onayla", exact: true }).tap();
      await dialog(phone).getByText(/10,25/).waitFor();
      assert.equal(await fitsViewport(phone), true);
      await prepareScreenshot(phone, "ai-webkit-onay.png");
      await dialog(phone).getByRole("button", { name: "Vazgeç" }).tap();
      await dialog(phone).waitFor({ state: "hidden" });
      await phone.locator(".ai-draft").getByRole("button", { name: "Reddet", exact: true }).tap();
      await dialog(phone).getByRole("button", { name: "Reddet", exact: true }).tap();
      await phone.locator(".ai-draft").getByText("Reddedildi", { exact: true }).waitFor();
      await phone.getByRole("button", { name: "Geçmiş", exact: true }).tap();
      await phone.getByRole("dialog", { name: "Sohbet geçmişi" }).getByText("gider 10,25 kağıt").waitFor();
      await prepareScreenshot(phone, "ai-webkit-history.png");
    } finally { await safari.close(); }
  }
  await local.query("UPDATE olvex_subscriptions SET paid_until = 1 WHERE business_id = '" + workspace + "'");
  await navigate(page, "overview", "Genel Bakış");
  await page.getByRole("heading", { name: "Aktif aboneliğiniz bulunmuyor" }).waitFor();
  await page.getByText(/OLVEX abonelik sistemi hazırlanıyor/).waitFor();
  assert.equal(await page.getByRole("link", { name: "Paketleri ve fiyatları gör" }).getAttribute("href"), "/#fiyatlandirma");
  assert.equal(await page.getByRole("link", { name: "Paket seçimine git" }).count(), 0);
  await navigate(page, "products", "Ürünler ve Stok");
  await page.getByText("Filtre kahve", { exact: true }).first().waitFor();

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
  if (desktopEngine !== browser) await desktopEngine.close();
  await browser.close();
  await local.close();
}
