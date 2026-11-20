import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium, devices, firefox, request, webkit } from "playwright-core";
import { sha256 } from "../functions/_lib/session.js";
import { localPages } from "./local.mjs";

const chromiumPath = process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const chrome = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" };
const edge = process.env.EDGE_PATH ? { executablePath: process.env.EDGE_PATH } : { channel: "msedge" };
const profiles = {
  chromium: { engine: chromium, launch: { executablePath: chromiumPath } },
  chrome: { engine: chromium, launch: chrome },
  android: { engine: chromium, launch: { executablePath: chromiumPath }, device: devices["Pixel 7"] },
  edge: { engine: chromium, launch: edge },
  firefox: { engine: firefox },
  webkit: { engine: webkit },
  iphone: { engine: webkit, device: devices["iPhone 13"] }
};
const names = (process.env.OLVEX_BROWSER_PROFILES || "chromium").split(",");
for (const name of names) assert.ok(Object.hasOwn(profiles, name), `Bilinmeyen tarayıcı profili ${name}`);
const local = await localPages({ professionalFixtures: true, https: true });
const api = await request.newContext({ baseURL: local.url, ignoreHTTPSErrors: true, extraHTTPHeaders: { Origin: local.url } });

async function read(response) {
  assert.ok(response.ok(), `${response.status()} ${await response.text()}`);
  return response.json();
}

async function runProfile(name, profile, credentials, esnaf = false) {
  const business = (await read(await api.post("/api/businesses", { data: { name: "Şube testi " + name } }))).business.id;
  const path = `/api/workspace/${business}/`;
  const write = async (section, action, values) => read(await api.post(path + section, {
    data: { action, requestId: crypto.randomUUID(), ...values }
  }));
  const get = async (section, params = {}) => read(await api.get(path + section, { params }));
  if (esnaf) {
    await local.query(`UPDATE olvex_subscriptions SET plan = 'esnaf-monthly' WHERE business_id = '${business}'`);
  }
  const center = (await get("locations")).rows[0].id;
  let coast = center;
  if (!esnaf) {
    coast = (await write("locations", "create", { name: "Sahil" })).id;
    for (const location of ["Kuzey", "Güney", "Depo"]) await write("locations", "create", { name: location });
  }
  const plan = await get("package");
  assert.equal(plan.tier, esnaf ? "esnaf" : "profesyonel");
  assert.equal(plan.counts.branches, esnaf ? 1 : 5);
  const cola = (await write("products", "save", { sku: "KOLA", name: "Kola", opening: 100, price: 300, cost: 100 })).id;
  const box = (await write("products", "save", { sku: "KUTU", name: "Kutu", opening: 100, price: 200, cost: 100 })).id;
  if (!esnaf) {
    await write("stock", "adjust", { branchId: coast, productId: cola, delta: 50, note: "Şube açılışı" });
    await write("stock", "adjust", { branchId: coast, productId: box, delta: 20, note: "Şube açılışı" });
  }

  async function balances(sku) {
    return Promise.all([center, coast, ""].map(async branchId => {
      const result = await get("catalog", branchId ? { q: sku, branchId } : { q: sku });
      return result.rows.find(row => row.sku === sku).stock;
    }));
  }

  const browser = await profile.engine.launch(profile.launch);
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 }, ...profile.device, baseURL: local.url,
      locale: "tr-TR", ignoreHTTPSErrors: true
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(90_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const modal = page.locator("#editor");
    const form = modal.locator("#editor-form");
    const submit = modal.locator("#editor-submit");
    async function fits() {
      assert.equal(await modal.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1 &&
          el.scrollWidth <= el.clientWidth + 1 && el.querySelector("form").scrollWidth <= el.clientWidth + 1;
      }), true, name + " form genişliği");
    }
    const ready = () => page.locator('#content[aria-busy="false"]').waitFor();
    const button = label => page.getByRole("button", { name: label, exact: true });
    const noOverflow = async section => assert.equal(await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, name + " · " + section);
    const menu = button("Menüyü aç");
    async function visit(section) {
      if (await menu.isVisible()) await menu.click();
      await page.locator(`#sidebar nav [data-view="${section}"]`).click();
      await page.waitForURL(new RegExp("#" + section + "$"));
      await ready();
      await noOverflow(section);
      assert.equal(await page.getByText("Yeniden dene", { exact: true }).count(), 0);
      if (await menu.isVisible()) assert.equal(await page.locator("#sidebar").isVisible(), false);
    }
    async function navigate(section, cmd) {
      await page.goto(`/app.html?business=${business}#${section}`);
      await ready();
      await page.locator(`[data-cmd="${cmd}"]`).first().click();
      await fits();
    }
    await page.goto("/login.html");
    await page.locator("#email").fill(credentials.email);
    await page.locator("#password").fill(credentials.password);
    await page.locator("#submitButton").click();
    await page.waitForURL(/\/app(?:\.html)?(?:\?|#|$)/);
    await ready();
    await page.getByRole("heading", { name: "Genel Bakış", exact: true }).waitFor();
    const preferences = page.getByRole("button", { name: "Tümünü reddet" });
    if (await preferences.isVisible()) await preferences.click();
    await noOverflow("overview");
    await visit("products");
    await page.getByText("Kola", { exact: true }).waitFor();

    let releaseFinance;
    const financeReady = new Promise(resolve => { releaseFinance = resolve; });
    await page.route("**/api/workspace/*/finance?**", async route => {
      await financeReady;
      await route.fulfill({ status: 502, contentType: "text/html", body: "Yerel test yanıtı" });
    }, { times: 1 });
    if (await menu.isVisible()) await menu.click();
    await page.locator('#sidebar nav [data-view="finance"]').click();
    await page.locator(".loading-panel").waitFor();
    releaseFinance();
    await button("Yeniden dene").click();
    await ready();
    await page.getByRole("heading", { name: "Finans", exact: true }).waitFor();
    await noOverflow("finance");
    assert.equal(await button("Yeniden dene").count(), 0);
    await page.reload();
    await ready();
    await page.getByRole("heading", { name: "Finans", exact: true }).waitFor();
    await page.goBack();
    await page.waitForURL(/#products$/);
    await ready();
    await page.getByText("Kola", { exact: true }).waitFor();

    await visit("ai");
    const prompt = page.getByRole("textbox", { name: "Mesaj", exact: true });
    await prompt.fill("gider 10,25 kağıt");
    await button("Gönder").click();
    await page.locator(".ai-draft").waitFor();
    await noOverflow("ai");
    await page.reload();
    await ready();
    await button("Geçmiş").click();
    await page.getByRole("dialog", { name: "Sohbet geçmişi" }).getByText("gider 10,25 kağıt").waitFor();
    await page.getByRole("dialog", { name: "Sohbet geçmişi" }).getByRole("button", { name: "Kapat", exact: true }).click();
    async function expireSession() {
      const session = (await ctx.cookies()).find(cookie => cookie.name === "olvex_session");
      assert.ok(session);
      await local.query(`UPDATE user_sessions SET expires_at = '2000-01-01T00:00:00Z' WHERE token_hash = '${await sha256(session.value)}'`);
      const denied = page.waitForResponse(response => response.url().includes("/api/workspace/") && response.status() === 401);
      if (await menu.isVisible()) await menu.click();
      await page.locator('#sidebar nav [data-view="products"]').click();
      await denied;
      await page.waitForURL(/\/login(?:\.html)?$/);
    }
    if (esnaf) {
      await page.locator('#sidebar nav [data-view="sales"]').click();
      await ready();
      await page.locator('#actions [data-cmd="new-order"]').click();
      await form.locator('[name="branchId"]').locator('option:checked').filter({ hasText: "Merkez" }).waitFor({ state: "attached" });
      await form.getByLabel("Kayıtlı ürünü seç").selectOption("KOLA");
      await form.getByLabel("Tahsil edildi").uncheck();
      await form.getByLabel("Referans").fill("ESNAF-1");
      await submit.click();
      await modal.waitFor({ state: "hidden" });
      assert.deepEqual(await balances("KOLA"), [99, 99, 99]);
      const row = page.getByRole("row").filter({ hasText: "ESNAF-1" });
      await row.getByRole("button", { name: "Tahsilat kaydet", exact: true }).click();
      await submit.click();
      await modal.waitFor({ state: "hidden" });
      assert.equal((await get("overview")).totals.revenue, 300);
      await expireSession();
      assert.deepEqual(errors, []);
      console.log("Esnaf · tek şube, giriş, ürünler, finans ve AI.");
      return;
    }

    await visit("sales");
    await page.locator('#actions [data-cmd="new-order"]').click();
    await fits();
    const branch = form.locator('[name="branchId"]');
    const sku = form.getByLabel("Kayıtlı ürünü seç");
    assert.equal(await branch.inputValue(), "");
    assert.equal(await branch.evaluate(el => el.validity.valueMissing), true);
    assert.equal(await sku.isDisabled(), true);
    await branch.selectOption(center);
    await sku.locator("option").filter({ hasText: "şube stoku: 100" }).first().waitFor({ state: "attached" });
    await branch.selectOption(coast);
    await sku.locator("option").filter({ hasText: "şube stoku: 50" }).waitFor({ state: "attached" });
    await sku.selectOption("KOLA");
    await form.getByLabel("Adet", { exact: true }).fill("3");
    const saleReference = "SAHIL-3-" + "X".repeat(92);
    await form.getByLabel("Referans").fill(saleReference);
    await page.route("**/api/workspace/*/sales", route =>
      route.fulfill({ status: 200, json: [] }), { times: 1 });
    await submit.click();
    await modal.locator("#editor-message").getByText(/Bağlantı kurulamadı/).waitFor({ timeout: 5000 });
    assert.deepEqual(await balances("KOLA"), [100, 50, 150]);
    await submit.click();
    await modal.waitFor({ state: "hidden" });
    assert.deepEqual(await balances("KOLA"), [100, 47, 147]);
    assert.equal((await get("reports")).totals.revenue, 900);
    const saleRow = page.getByRole("row").filter({ hasText: saleReference });
    if (profile.device) await page.setViewportSize({ width: 320, height: 450 });
    await saleRow.getByRole("button", { name: "Tam iade / iptal" }).click();
    await modal.getByText("Şube · Sahil").waitFor();
    await fits();
    assert.equal(await modal.locator("#editor-content").evaluate(el => el.scrollWidth <= el.clientWidth + 1),
      true, name + " · uzun fiş referansı");
    if (profile.device) {
      const buttonBox = await submit.boundingBox();
      assert.ok(buttonBox.y + buttonBox.height <= page.viewportSize().height, "İptal butonu kısa ekrana sığmalı");
    }
    await submit.click();
    await modal.waitFor({ state: "hidden" });
    assert.deepEqual(await balances("KOLA"), [100, 50, 150]);
    const { totals } = await get("reports");
    assert.deepEqual([totals.sales, totals.revenue, totals.spending], [0, 900, 900]);
    if (profile.device) await page.setViewportSize(profile.device.viewport);

    await navigate("purchases", "new-order");
    await branch.selectOption(coast);
    await sku.selectOption("KOLA");
    await form.getByLabel("Tedarikçi").fill("Toptancı");
    await form.getByLabel("Adet", { exact: true }).fill("4");
    await submit.click();
    await modal.waitFor({ state: "hidden" });
    assert.deepEqual(await balances("KOLA"), [100, 54, 154]);

    await navigate("transfers", "create-transfer");
    await form.locator('[name="sourceBranchId"]').selectOption(center);
    await form.locator('[name="destinationBranchId"]').selectOption(coast);
    await form.locator('[name="productId"]').selectOption(box);
    await form.locator('[name="quantity"]').fill("101");
    await form.locator('[name="note"]').fill("Şubeler arası sevkiyat");
    await submit.click();
    await modal.locator("#editor-message").getByText(/stok/i).waitFor();
    assert.deepEqual(await balances("KUTU"), [100, 20, 120]);
    await form.locator('[name="quantity"]').fill("30");
    await submit.click();
    await modal.waitFor({ state: "hidden" });
    const entry = page.getByRole("row").filter({ hasText: "Şubeler arası sevkiyat" });
    for (const text of ["Merkez", "Sahil", "30", "Tarayıcı Testi"]) await entry.getByText(text, { exact: true }).waitFor();
    assert.deepEqual(await balances("KUTU"), [70, 50, 120]);
    await page.goto(local.url + "/app.html#reports");
    const reportBranch = page.getByLabel("Rapor şubesi");
    await reportBranch.selectOption(coast);
    await page.waitForFunction(id => document.querySelector("[data-report-branch]")?.value === id &&
      document.querySelector("#content")?.getAttribute("aria-busy") === "false", coast);
    await expireSession();
    assert.deepEqual(errors, []);
    console.log(`${name} ${browser.version()} (${page.viewportSize().width}px): satış 100/47, iptal 100/50, alış 100/54, transfer 70/50; toplam 120.`);
  } finally {
    await browser.close();
  }
}

try {
  const { termsVersion } = await read(await api.get("/api/public-info"));
  for (const name of names) {
    const credentials = { email: "branch-browser-" + name + "@example.test", password: "Branch-fixture-2026!" };
    await read(await api.post("/api/auth/register", { data: {
      ...credentials, termsVersion, fullName: "Tarayıcı Testi", acceptedTerms: true
    } }));
    await read(await api.post("/api/auth/login", { data: credentials }));
    await runProfile(name, profiles[name], credentials);
    if (name === "chromium") {
      const esnaf = { ...credentials, email: "esnaf-browser@example.test" };
      await read(await api.post("/api/auth/register", { data: {
        ...esnaf, termsVersion, fullName: "Tarayıcı Testi", acceptedTerms: true
      } }));
      await read(await api.post("/api/auth/login", { data: esnaf }));
      await runProfile(name, profiles[name], esnaf, true);
    }
  }
} finally {
  await api.dispose();
  await local.close();
}
