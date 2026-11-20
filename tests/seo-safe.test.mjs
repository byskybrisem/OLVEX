import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("SEO: canonical, sosyal kart, uygulama şeması ve güncel fiyat kartı birlikte bulunur", async () => {
  const page = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(page, /rel="canonical" href="https:\/\/olvex.com.tr\/"/);
  assert.match(page, /property="og:url" content="https:\/\/olvex.com.tr\/"/);
  assert.match(page, /meta name="twitter:card" content="summary_large_image"/);
  assert.match(page, /type="application\/ld\+json"/);
  assert.match(page, /id="monthly-price">999 TL/);
  assert.match(page, /id="pricing-cta"/);
  assert.match(page, /id="business-tools-title"/);
  assert.doesNotMatch(page, /id="payment-test-buy"/);
  assert.ok((await stat(new URL("../assets/olvex-preview.jpg",import.meta.url))).size > 10000);
});

test("SEO: robots, sitemap ve formların noindex uyarıları deploy dosyalarına dahildir", async () => {
  const robots = await readFile(new URL("../robots.txt",import.meta.url), "utf8");
  const build = await readFile(new URL("../scripts/build.mjs",import.meta.url), "utf8");
  const fixture = await readFile(new URL("./local.mjs",import.meta.url), "utf8");
  assert.match(robots,/Sitemap: https:\/\/olvex.com.tr\/sitemap.xml/);
  assert.match(build,/"robots.txt"/);
  assert.match(fixture,/"robots.txt"/);
  for (const name of ["login.html","register.html","setup.html"]) {
    const s = await readFile(new URL("../"+name,import.meta.url),"utf8");
    assert.match(s,/name="robots" content="noindex, nofollow"/);
  }
});
