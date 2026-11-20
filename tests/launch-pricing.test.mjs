import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plans } from "../functions/_lib/iyzico.js";
import { launchCharge, publicPricing } from "../functions/_lib/pricing.js";
import { onRequestGet as publicInfo } from "../functions/api/public-info.js";

const root = new URL("../", import.meta.url);
const file = name => readFileSync(new URL(name, root), "utf8");

test("kamuya açık sayfalarda tek OLVEX aboneliği ve doğru standart fiyat gösteriliyor", () => {
  const home = file("index.html");
  const terms = file("subscription-terms.html");
  for (const page of [home, terms, file("pre-information.html"), file("distance-service-agreement.html")]) {
    assert.doesNotMatch(page, /Esnaf|\b499\b|4\.790|9\.590|yıllık abonelik|id="annual"/i);
  }
  const olvex = publicPricing({}).olvex;
  assert.equal(plans["profesyonel-monthly"].amount, olvex.standard.monthlyKurus);
  assert.match(home, /id="monthly-price">999 TL</);
  assert.equal((home.match(/class="plan-card"/g) ?? []).length, 1);
  assert.match(terms, /999 TL\/ay/);
  assert.match(home, /1 işletme, 5 şubeye kadar/);
  assert.match(home, /İşletme sahibi dahil 10 kullanıcı/);
  assert.match(home, /Deneme için ödeme kartı gerekecek/);
  assert.match(home, /Ücretli abonelik tahsilatı şu anda kapalıdır/);
});

test("müşteri ürün yükleme ve gerçek kasa güvenliği ifadeleri korunuyor", () => {
  const importer = file("assets/product-import.js");
  const pos = file("assets/pos-onboarding.js");
  const view = file("assets/views.js");
  assert.match(importer, /CSV şablonunu indir/);
  assert.match(view, /Toplu Ürün Ekle/);
  assert.match(pos, /tak-çalıştır entegrasyon bulunmuyor/);
});

test("temsili verili inceleme ekranı gerçek kayıt gibi gösterilmiyor", () => {
  const demo = file("demo.html");
  const home = file("index.html");
  assert.match(demo, /Değişiklikler kaydedilmez/);
  assert.match(home, /temsili kayıtlar gösterir/);
});


test("OLVEX aylık teklifleri ve indirimli ücretli dönemler sunucuya ait", () => {
  const { olvex } = publicPricing({ OLVEX_LAUNCH_OFFER: "on" });
  assert.deepEqual(olvex.standard, { currency: "TRY", monthlyKurus: 99900, trialDays: 14 });
  assert.deepEqual(olvex.launch, {
    id: "olvex-monthly-launch-v1", currency: "TRY", monthlyKurus: 99900, trialDays: 0,
    discountedKurus: 70000, discountedPeriods: 3
  });
  assert.deepEqual([1, 2, 3, 4, 5].map(period => launchCharge(olvex.launch.id, period)), [
    { currency: "TRY", amountKurus: 70000 },
    { currency: "TRY", amountKurus: 70000 },
    { currency: "TRY", amountKurus: 70000 },
    { currency: "TRY", amountKurus: 99900 },
    { currency: "TRY", amountKurus: 99900 }
  ]);
  for (const period of [0, -1, "1", 1.5]) assert.equal(launchCharge(olvex.launch.id, period), null);
  assert.equal(launchCharge("unknown", 1), null);
});

test("kampanya tarihleri yeni gösterimleri sınırlar, sürümlenmiş koşulları değiştirmez", () => {
  const start = "2031-07-01T09:00:00Z";
  const end = "2031-08-01T09:00:00Z";
  const env = { OLVEX_LAUNCH_OFFER: "on", OLVEX_LAUNCH_OFFER_STARTS_AT: start, OLVEX_LAUNCH_OFFER_ENDS_AT: end };
  const offer = (overrides, time) => publicPricing({ ...env, ...overrides }, time).olvex.launch;
  assert.equal(offer({}, Date.parse(start) - 1), null);
  assert.equal(offer({}, Date.parse(start)).id, "olvex-monthly-launch-v1");
  assert.ok(offer({}, Date.parse(end) - 1));
  assert.equal(offer({}, Date.parse(end)), null);
  assert.equal(offer({ OLVEX_LAUNCH_OFFER: "off" }, Date.parse(start)), null);
  assert.equal(offer({ OLVEX_LAUNCH_OFFER_STARTS_AT: end }, Date.parse(start)), null);
  for (const invalid of ["2031-02-29T09:00:00Z", "2031-07-01", "not-a-date"]) {
    assert.equal(offer({ OLVEX_LAUNCH_OFFER_STARTS_AT: invalid }, Date.parse(start)), null);
    assert.equal(offer({ OLVEX_LAUNCH_OFFER_ENDS_AT: invalid }, Date.parse(start)), null);
  }
  assert.equal(launchCharge("olvex-monthly-launch-v1", 2).amountKurus, 70000);
});

test("kamuya açık fiyat bilgisi önbelleğe alınmaz ve kampanya varsayılan olarak kapalıdır", async () => {
  const request = new Request("https://olvex.com.tr/api/public-info");
  const response = publicInfo({ request, env: {} });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { pricing } = await response.json();
  assert.equal(pricing.olvex.launch, null);
  assert.equal(pricing.olvex.standard.monthlyKurus, 99900);
});
