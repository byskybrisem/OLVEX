import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plans } from "../functions/_lib/iyzico.js";
import { professionalCharge, publicPricing } from "../functions/_lib/pricing.js";
import { onRequestGet as publicInfo } from "../functions/api/public-info.js";

const root = new URL("../", import.meta.url);
const file = name => readFileSync(new URL(name, root), "utf8");

test("lansman paketleri tek kaynak ödeme tutarları ile eşleşiyor", () => {
  const home = file("index.html");
  const terms = file("subscription-terms.html");
  const selected = [
    ["esnaf-monthly", 49900, "499"],
    ["esnaf-yearly", 479040, "4.790,40"],
    ["profesyonel-monthly", 99900, "999"],
    ["profesyonel-yearly", 959040, "9.590,40"]
  ];
  for (const [id, amount, shown] of selected) {
    assert.equal(plans[id].amount, amount, id);
    assert.ok(terms.includes(shown + " TL"), "Subscription terms missing " + shown);
  }
  assert.match(home, /data-price="499"/);
  assert.match(home, /data-price="999"/);
  assert.match(home, /1 işletme, 1 şube/);
  assert.match(home, /1 işletme, 5 şubeye kadar/);
  assert.match(home, /İşletme sahibi dahil 2 kullanıcı/);
  assert.match(home, /İşletme sahibi dahil 10 kullanıcı/);
  assert.doesNotMatch(home, /Kesin paket kapsamı|Belirlenecek|kesinleşecektir/i);
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


test("Profesyonel aylık teklifler ve indirimli ücretli dönemler sunucuya ait", () => {
  const { professional } = publicPricing({ OLVEX_LAUNCH_OFFER: "on" });
  assert.deepEqual(professional.standard, { currency: "TRY", monthlyKurus: 99900, trialDays: 14 });
  assert.deepEqual(professional.launch, {
    id: "professional-launch-v1", currency: "TRY", monthlyKurus: 99900, trialDays: 0,
    discountedKurus: 69900, discountedPeriods: 3, savingsKurus: 90000, discountPercent: 30
  });
  assert.deepEqual([1, 2, 3, 4, 5].map(period => professionalCharge(professional.launch.id, period)), [
    { currency: "TRY", amountKurus: 69900 },
    { currency: "TRY", amountKurus: 69900 },
    { currency: "TRY", amountKurus: 69900 },
    { currency: "TRY", amountKurus: 99900 },
    { currency: "TRY", amountKurus: 99900 }
  ]);
  assert.deepEqual(professionalCharge("professional-standard-v1", 1), { currency: "TRY", amountKurus: 99900 });
  for (const period of [0, -1, "1", 1.5]) assert.equal(professionalCharge(professional.launch.id, period), null);
  assert.equal(professionalCharge("unknown", 1), null);
});

test("kampanya tarihleri yeni gösterimleri sınırlar, sürümlenmiş koşulları değiştirmez", () => {
  const start = "2031-07-01T09:00:00Z";
  const end = "2031-08-01T09:00:00Z";
  const env = { OLVEX_LAUNCH_OFFER: "on", OLVEX_LAUNCH_OFFER_STARTS_AT: start, OLVEX_LAUNCH_OFFER_ENDS_AT: end };
  const offer = (overrides, time) => publicPricing({ ...env, ...overrides }, time).professional.launch;
  assert.equal(offer({}, Date.parse(start) - 1), null);
  assert.equal(offer({}, Date.parse(start)).id, "professional-launch-v1");
  assert.ok(offer({}, Date.parse(end) - 1));
  assert.equal(offer({}, Date.parse(end)), null);
  assert.equal(offer({ OLVEX_LAUNCH_OFFER: "off" }, Date.parse(start)), null);
  assert.equal(offer({ OLVEX_LAUNCH_OFFER_STARTS_AT: end }, Date.parse(start)), null);
  for (const invalid of ["2031-02-29T09:00:00Z", "2031-07-01", "not-a-date"]) {
    assert.equal(offer({ OLVEX_LAUNCH_OFFER_STARTS_AT: invalid }, Date.parse(start)), null);
    assert.equal(offer({ OLVEX_LAUNCH_OFFER_ENDS_AT: invalid }, Date.parse(start)), null);
  }
  assert.equal(professionalCharge("professional-launch-v1", 2).amountKurus, 69900);
});

test("kamuya açık fiyat bilgisi önbelleğe alınmaz ve kampanya varsayılan olarak kapalıdır", async () => {
  const request = new Request("https://olvex.com.tr/api/public-info");
  const response = publicInfo({ request, env: {} });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { pricing } = await response.json();
  assert.equal(pricing.professional.launch, null);
  assert.equal(pricing.professional.standard.monthlyKurus, 99900);
});
