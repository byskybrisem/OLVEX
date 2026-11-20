import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium, devices, firefox, request, webkit } from "playwright-core";
import { localPages } from "./local.mjs";

const chromiumPath = process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const chrome = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" };
const edge = process.env.EDGE_PATH ? { executablePath: process.env.EDGE_PATH } : { channel: "msedge" };
const profiles = {
  chromium: { engine: chromium, launch: { executablePath: chromiumPath } },
  chrome: { engine: chromium, launch: chrome },
  android: { engine: chromium, launch: chrome, device: devices["Pixel 7"] },
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

async function runProfile(name, profile, storageState) {
  const business = (await read(await api.post("/api/businesses", { data: { name: "Şube testi " + name } }))).business.id;
  const path = `/api/workspace/${business}/`;
  const write = async (section, action, values) => read(await api.post(path + section, {
    data: { action, requestId: crypto.randomUUID(), ...values }
  }));
  const get = async (section, params = {}) => read(await api.get(path + section, { params }));
  const center = (await get("locations")).rows[0].id;
  const coast = (await write("locations", "create", { name: "Sahil" })).id;
  const cola = (await write("products", "save", { sku: "KOLA", name: "Kola", opening: 100, price: 300, cost: 100 })).id;
  const box = (await write("products", "save", { sku: "KUTU", name: "Kutu", opening: 100, price: 200, cost: 100 })).id;
  await write("stock", "adjust", { branchId: coast, productId: cola, delta: 50, note: "Şube açılışı" });
  await write("stock", "adjust", { branchId: coast, productId: box, delta: 20, note: "Şube açılışı" });

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
      locale: "tr-TR", storageState, ignoreHTTPSErrors: true
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
    async function navigate(section, cmd) {
      await page.goto(`/app.html?business=${business}#${section}`);
      await page.locator(`[data-cmd="${cmd}"]`).first().click();
      await fits();
    }
    await navigate("sales", "new-order");
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
    await form.getByLabel("Referans").fill("SAHIL-3");
    await submit.click();
    await modal.waitFor({ state: "hidden" });
    assert.deepEqual(await balances("KOLA"), [100, 47, 147]);
    await page.getByRole("row").filter({ hasText: "SAHIL-3" }).getByRole("button", { name: "Tam iade / iptal" }).click();
    await modal.getByText("Şube · Sahil").waitFor();
    await submit.click();
    await modal.waitFor({ state: "hidden" });
    assert.deepEqual(await balances("KOLA"), [100, 50, 150]);

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
    await runProfile(name, profiles[name], await api.storageState());
  }
} finally {
  await api.dispose();
  await local.close();
}
