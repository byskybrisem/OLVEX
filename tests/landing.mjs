import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { webkit } from "playwright-core";
import { checkCoreFrames, checkCoreLoading } from "./core-browser.mjs";

export const widths = [320, 360, 375, 390, 430, 768, 1024, 1440, 1920];

async function checkWidth(page, width) {
  const bounds = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth
  }));
  assert.equal(bounds.viewport, width, "Mobile viewport metadata");
  assert.ok(bounds.document <= width, JSON.stringify({ width, ...bounds }));
}

async function snapshot(page, directory, filename) {
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, filename), animations: "disabled" });
}

async function checkStaticPage(page, url) {
  await page.goto(url);
  await page.getByRole("heading", { name: "İşletmenizin tüm gücü, tek merkezde.", level: 1 }).waitFor();
  const poster = page.locator("#core-stage img");
  await poster.waitFor();
  assert.ok(await poster.evaluate(async image => {
    await image.decode();
    return image.naturalWidth > 0;
  }));
  const missingTargets = await page.locator('a[href^="#"]').evaluateAll(links =>
    links.map(link => link.hash.slice(1)).filter(id => id && !document.getElementById(decodeURIComponent(id))));
  assert.deepEqual(missingTargets, []);
  await page.getByRole("link", {name: "Ücretsiz Hesap Oluştur", exact: true}).first().waitFor();
}

export async function landingChecks({ safeContext, url, snapshots }) {
  const errors = [];
  const desktop = await safeContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await desktop.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const requests = [];
    page.on("request", request => requests.push(new URL(request.url()).pathname));
    page.on("response", response => {
      if (response.status() >= 400) errors.push(response.status() + " " + response.url());
    });
    // Count actual WebGL draws. Network completion alone does not prove that the model renders.
    await page.addInitScript(() => {
      window.olvexDraws = 0;
      if (!window.WebGL2RenderingContext) return;
      for (const method of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
        const original = WebGL2RenderingContext.prototype[method];
        WebGL2RenderingContext.prototype[method] = function(...args) {
          ++window.olvexDraws;
          return original.apply(this, args);
        };
      }
    });
    await checkStaticPage(page, url);
    // A first-time visitor must see preferences before opening an account.
    const cookieBanner = page.locator("#site-cookie-banner");
    await cookieBanner.waitFor({ state: "visible" });
    await cookieBanner.getByRole("button", { name: "Tümünü reddet" }).click();
    await cookieBanner.waitFor({ state: "hidden" });
    await page.goto(`${url}/login.html`);
    assert.equal(await page.locator("#site-cookie-banner").isVisible(), false,
      "The preference decision must carry across public pages");
    await page.goto(`${url}/cookies.html#browser-preferences`);
    await page.locator("#browser-preferences").getByRole("button", { name: "Tümünü kabul et" }).click();
    await checkStaticPage(page, url);
    assert.equal(await page.locator("#site-cookie-banner").isVisible(), false,
      "The policy page must update the same preference used by the landing page");
    await page.evaluate(() => document.fonts.ready);
    await snapshot(page, snapshots, "landing-desktop.png");
    for (const width of widths) {
      await page.setViewportSize({ width, height: 850 });
      await checkWidth(page, width);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await snapshot(page, snapshots, "landing-mobile.png");
    const menu = page.locator("#site-menu");
    await menu.locator("summary").click();
    await checkWidth(page, 390);
    const link = menu.locator('a[href="#moduller"]');
    await link.click();
    assert.equal(new URL(page.url()).hash, "#moduller");
    assert.equal(await menu.evaluate(node => node.open), false);

    for (const name of ["products", "sales", "overview"]) {
      const tab = page.locator("#tour-" + name + "-tab");
      await tab.click();
      assert.equal(await tab.getAttribute("aria-selected"), "true");
      await page.locator("#tour-" + name).waitFor();
    }
    const overviewTab = page.locator("#tour-overview-tab");
    await overviewTab.focus();
    await overviewTab.press("ArrowRight");
    assert.equal(await page.locator("#tour-products-tab").getAttribute("aria-selected"), "true");
    const pricing = page.getByRole("region", { name: "Fiyatlandırma" });
    const plan = pricing.getByRole("article", { name: "OLVEX" });
    const launch = plan.locator("#launch-badge");
    await launch.waitFor();
    assert.equal(await pricing.getByRole("article").count(), 1);
    assert.equal(await plan.locator("del").textContent(), "999 TL/ay");
    assert.equal(await plan.locator("#monthly-price").textContent(), "700 TL");
    await plan.getByText(/Sınırlı süreli teklif.*İlk 3 ücretli ay 700 TL\/ay, sonrasında 999 TL\/ay.*deneme yoktur/).waitFor();
    await plan.getByText("14 gün ücretsiz deneme", { exact: true }).waitFor();
    await plan.getByText(/Deneme için ödeme kartı gerekecek/).waitFor();
    assert.equal(await plan.getByRole("button").count(), 0);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await plan.evaluate(card => {
        const rect = card.getBoundingClientRect();
        const section = card.parentElement.getBoundingClientRect();
        return {
          overflow: card.scrollWidth > card.clientWidth || document.documentElement.scrollWidth > document.documentElement.clientWidth,
          left: rect.left, right: rect.right, width: rect.width, sectionWidth: section.width,
          background: getComputedStyle(card).backgroundImage
        };
      });
      assert.equal(layout.overflow, false, `Horizontal overflow at ${width}px`);
      assert.ok(Math.abs(layout.left - (width - layout.right)) <= 1, `Card not centered at ${width}px`);
      assert.ok(Math.abs(layout.width - Math.min(layout.sectionWidth, 620)) <= 1, `Unexpected card width at ${width}px`);
      assert.notEqual(layout.background, "none");
      if (snapshots && [390, 768, 1440].includes(width)) {
        await page.evaluate(() => document.fonts.ready);
        await plan.screenshot({ path: join(snapshots, `single-pricing-${width}.png`), animations: "disabled" });
      }
    }
    const termsLink = plan.getByRole("link", { name: "Abonelik koşullarını incele" });
    assert.equal(await termsLink.getAttribute("href"), "/subscription-terms.html");
    const terms = await desktop.request.get(new URL(await termsLink.getAttribute("href"), url).href);
    assert.equal(terms.status(), 200);
    assert.match(await terms.text(), /999 TL\/ay/);
    assert.equal(requests.some(path => path.endsWith("/core-scene.js")), false,
      "The WebGL bundle must be deferred until activation");

    await page.setViewportSize({ width: 1024, height: 768 });
    const toggle = page.locator("#core-toggle");
    await checkCoreLoading(page);
    await toggle.click();
    await page.waitForFunction(() => document.querySelector("#core-toggle").getAttribute("aria-pressed") === "true");
    const canvas = page.locator("#core-canvas");
    await canvas.waitFor();
    assert.equal(await toggle.textContent(), "2B görünüme dön");
    await checkCoreFrames(page);
    await page.waitForFunction(() => window.olvexDraws > 0);
    const draws = await page.evaluate(() => {
      const count = window.olvexDraws;
      const story = document.querySelector("#core-story");
      window.scrollTo({ top: story.offsetTop + story.clientHeight / 3, behavior: "instant" });
      return count;
    });
    await page.waitForFunction(previous => window.olvexDraws > previous, draws);
    assert.ok(requests.some(path => path.endsWith("/core-scene.js")));
    await snapshot(page, snapshots, "landing-live.png");
    await toggle.click();
    await page.locator('#core-stage[data-core-state="idle"]').waitFor();
    assert.equal(await canvas.isVisible(), false);
    await toggle.click();
    await page.locator('#core-stage[data-core-state="live"]').waitFor();
    await canvas.evaluate(element => element.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext());
    await page.locator('#core-stage[data-core-state="unavailable"]').waitFor();
    await page.locator("#core-stage img").waitFor();
    await page.getByRole("link", { name: "Paneli incele", exact: true }).click();
    await page.getByRole("heading", { name: "Genel Bakış", exact: true, level: 1 }).waitFor();
    await page.locator("#module-search-open").click();
    await page.locator("#module-query").fill("satışlar");
    await page.locator('#module-search a[href="#sales"]').click();
    const unpaidFilter = page.locator('[data-filter] [name="unpaid"]');
    await unpaidFilter.check();
    await page.locator('[data-filter] button[type="submit"]').click();
    assert.ok(await unpaidFilter.isChecked());
    assert.equal(await page.locator("tbody tr").count(), 1);
    const detail = page.getByRole("button", { name: "Ayrıntı", exact: true });
    await detail.click();
    const order = page.getByRole("dialog", { name: "Satış ayrıntısı" });
    await order.getByText(/DEMO-1000/).waitFor();
    await order.getByRole("button", { name: "Kapat", exact: true }).last().click();
    assert.equal(await page.locator("#core-canvas").count(), 0);
  } finally { await desktop.close(); }

  const noJS = await safeContext({ javaScriptEnabled: false, viewport: { width: 320, height: 700 } });
  try {
    const page = await noJS.newPage();
    await checkStaticPage(page, url);
    await checkWidth(page, 320);
    const plan = page.getByRole("region", { name: "Fiyatlandırma" }).getByRole("article");
    assert.equal(await plan.locator("#monthly-price").textContent(), "999 TL");
    assert.equal(await plan.locator("#launch-badge").isVisible(), false);
    await page.locator("#site-menu summary").click();
    await page.locator('#site-menu a[href="#moduller"]').click();
    assert.equal(new URL(page.url()).hash, "#moduller");
    await page.getByRole("link", {name: "Ücretsiz Hesap Oluştur", exact: true}).first().click();
    await page.getByText("Hesap kaydı için tarayıcınızda JavaScript’i etkinleştirin.").waitFor();
    assert.equal(await page.locator("#registerForm").isVisible(), false);
  } finally { await noJS.close(); }

  const fallback = await safeContext();
  try {
    const page = await fallback.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return type === "webgl2" ? null : getContext.call(this, type, ...args);
      };
    });
    await checkStaticPage(page, url);
    await page.locator("#core-toggle").click();
    await page.locator('#core-stage[data-core-state="unavailable"]').waitFor();
    assert.ok(await page.locator("#core-toggle").isDisabled());
    assert.notEqual(await page.locator("#core-toggle").getAttribute("aria-pressed"), "true");
    await page.locator("#core-stage img").waitFor();
  } finally { await fallback.close(); }

  const reduced = await safeContext({ reducedMotion: "reduce" });
  try {
    const page = await reduced.newPage();
    const scripts = [];
    const campaignClosed = await reduced.request.get(url + "/api/public-info");
    const info = await campaignClosed.json();
    info.pricing.olvex.launch = null;
    await page.route("**/api/public-info", route => route.fulfill({ json: info }));
    page.on("request", request => scripts.push(new URL(request.url()).pathname));
    await checkStaticPage(page, url);
    await page.locator('#core-stage[data-core-state="reduced"]').waitFor();
    assert.ok(await page.locator("#core-toggle").isDisabled());
    await page.locator("#baslayin").scrollIntoViewIfNeeded();
    await page.locator("#trial-title").waitFor();
    assert.equal(await page.locator("#launch-badge").isVisible(), false);
    assert.equal(await page.locator("#regular-price").isVisible(), false);
    assert.equal(await page.locator("#monthly-price").textContent(), "999 TL");
    assert.equal(await page.locator(".plan-card:visible").count(), 1);
    assert.equal(await page.locator("#core-canvas").isVisible(), false);
    assert.equal(scripts.some(path => path.endsWith("/core-scene.js")), false);
  } finally { await reduced.close(); }

  if (process.env.OLVEX_WEBKIT) {
    const engine = await webkit.launch();
    try {
      const context = await safeContext({ viewport: { width: 440, height: 956 }, isMobile: true,
        hasTouch: true, deviceScaleFactor: 3, reducedMotion: "reduce" }, engine);
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await checkStaticPage(page, url);
      await checkWidth(page, 440);
      await snapshot(page, snapshots, "landing-webkit.png");
      const plan = page.getByRole("region", { name: "Fiyatlandırma" }).getByRole("article");
      await plan.locator("#launch-badge").waitFor();
      assert.equal(await plan.locator("#monthly-price").textContent(), "700 TL");
      if (snapshots) {
        await page.evaluate(() => document.fonts.ready);
        await plan.screenshot({ path: join(snapshots, "single-pricing-webkit.png"), animations: "disabled" });
      }
      await page.locator("#site-menu summary").tap();
      await page.locator('#site-menu a[href="#moduller"]').tap();
      await page.locator("#tour-products-tab").tap();
      await page.locator("#tour-products").waitFor();
      await checkWidth(page, 440);
    } finally { await engine.close(); }
  }
  assert.deepEqual(errors, []);
  console.log("Açılış sayfası doğrulandı: dokuz genişlik, mobil menü, ürün turu, planlar ve lansman teklifi, JavaScript kapalı, 3B ve statik görsel.");
}
