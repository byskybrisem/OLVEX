import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { plans } from "../functions/_lib/iyzico.js";

const root = new URL("../", import.meta.url);
const file = name => readFileSync(new URL(name, root), "utf8");

test("tek Profesyonel paketin iki faturalama dönemi ve kartlı 14 günlük denemesi", () => {
  const home = file("index.html");
  const terms = file("subscription-terms.html");
  const checkout = file("billing.html");
  assert.deepEqual(Object.keys(plans).sort(), ["profesyonel-monthly", "profesyonel-yearly"]);
  assert.equal(plans["profesyonel-monthly"].amount, 99900);
  assert.equal(plans["profesyonel-yearly"].amount, 959040);
  assert.match(home, /14 gün/);
  assert.match(home, /data-price="999"/);
  assert.doesNotMatch(home, /data-price="499"|<h3>Esnaf<\\/h3>/);
  assert.match(home, /1 işletme, 5 şubeye kadar/);
  assert.match(home, /İşletme sahibi dahil 10 kullanıcı/);
  assert.match(terms, /999 TL/);
  assert.match(terms, /9\\.590,40 TL/);
  assert.match(terms, /14 günlük deneme/);
  assert.match(checkout, /acceptedBillingTerms/);
  assert.match(checkout, /iyzico/);
  assert.doesNotMatch(home, /Kesin paket kapsamı|Belirlenecek|kesinleşecektir/i);
  assert.match(home, /abonelik tahsilatı ve kart doğrulamalı deneme henüz açık değildir/);
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
