import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { plans } from "../functions/_lib/iyzico.js";

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
