# OLVEX

Cloudflare Pages Functions ve D1 üzerinde çalışan Türkçe işletme paneli. Mevcut kullanıcılar, işletmeler, oturumlar ve parola özetleri korunur.

## Geliştirme ve doğrulama

Node.js 22.13 veya üzeriyle çalıştırın.

```sh
npm ci
npm run build
npm test
npm run test:browser
```

Tarayıcı testi için Chromium gerekir. Sistem Chromium’u yoksa `npx playwright-core install chromium` çalıştırın veya `CHROMIUM_PATH` ile bir Chromium çalıştırılabilir dosyası seçin. Testler yerel bir Pages sunucusu ve yalıtılmış D1 veritabanı başlatır. AI testleri MOCK modundadır. E-posta teslimi veya gerçek OpenAI isteği yapılmaz.

`npm test` geçerli D1 şemasını ve eski kayıtların korunmasını, 10.000 deterministik stok işlemini ve HTTP üzerinden gerçek yerel Pages Functions akışlarını sınar. Tarayıcı testi kayıt, giriş, işletme kurma, kasa CSV’si, AI onayı, rapor indirme ve mobil gezinmeyi kapsar.

## Cloudflare Pages

| Alan | Değer |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Functions dizini | `functions/` |
| D1 binding adı | `DB` |

1. Ön izleme ortamında ayrı bir D1 veritabanı kullanın ve `migrations/` altındaki dosyaları sırayla uygulayın. Yayımdaki D1 için önce mevcut şemayı ve geri yükleme noktasını doğrulayın. İlk migrasyon, mevcut tabloları ve verilerini koruyan eklemeler kullanır.
2. Cloudflare Pages'te Preview ve Production için `DB` bağlarını kendi veritabanlarına yönlendirin. Üretimde güncel dal birleştirilmeden önce D1 migrasyonları uygulanmış olmalı.
3. Ön izleme ortamında `OLVEX_ENVIRONMENT=preview`, `OLVEX_SIGNUPS=preview` ve `OLVEX_AI_MODE=mock` ile kayıt ve AI akışlarını deneyin. Ön izlemeyi erişim kontrolüyle kısıtlamak için Pages projesinin Access ayarını kullanın.
4. Üretim açılışı için aşağıdaki servis değerlerini ekleyin. Tebligat ve iletişim bilgilerini doğrulayın, KVKK metnini gerçek barındırma ve veri aktarımı koşullarıyla karşılaştırın. Sonrasında `OLVEX_SIGNUPS=open` ile genel kaydı açın.

Migrasyonları Wrangler ile uygulamak için hedef D1 kimliğini ve `migrations_dir = "migrations"` yolunu içeren bir Wrangler yapılandırması kullanın. Ön izleme ve üretim komutlarında doğru yapılandırma dosyasını belirtin. [D1 migrasyon yönergesi](https://developers.cloudflare.com/d1/reference/migrations/)

| Pages ortam değişkeni | Kullanımı |
| --- | --- |
| `OLVEX_OPERATOR_NAME` | Kullanım şartları ve aydınlatma metninde gösterilecek hizmet sağlayıcı ve veri sorumlusu adı |
| `OLVEX_SERVICE_ADDRESS` | Yayınlanacak tebligat ve başvuru adresi |
| `OLVEX_CONTACT_EMAIL` | Çalıştığı doğrulanmış destek ve başvuru adresi |
| `OLVEX_SIGNUPS` | Üretimde `open`. Kayıt açılmadan önce yukarıdaki üç bilginin de sağlanması gerekir |
| `OLVEX_PUBLIC_ORIGIN` | Şifre sıfırlama bağlantısının alan adı. Varsayılan `https://olvex.com.tr` |
| `RESEND_API_KEY` | Şifre sıfırlama e-postası için Cloudflare secret |
| `OLVEX_FROM_EMAIL` | Resend’de doğrulanmış gönderici adresi |
| `OPENAI_API_KEY` | Canlı AI sohbeti için Cloudflare secret |
| `OPENAI_MODEL` | Yapılandırılmış yanıta uygun model. Varsayılan `gpt-4.1-mini` |
| `OLVEX_OPENAI_DAILY_LIMIT` | Tüm kurulum için günlük canlı AI isteği sınırı. Varsayılan 100. İşletme başına 20 |

OpenAI ve Resend anahtarları yalnızca sunucudan kullanılır. Şifre sıfırlama bağlantı özetleri 30 dakika geçerlidir ve şifre değiştirilince ilgili oturumlar kapatılır. [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create) · [Resend e-posta API’si](https://resend.com/docs/api-reference/emails/send-email)

## Yetkiler

| Rol | Erişim |
| --- | --- |
| İşletme sahibi | Tüm modüller, işletme adı, ekip daveti ve rol yönetimi |
| Yönetici | Satış, stok, satın alma, müşteri, finans, fatura, vardiya, görev, rapor, AI ve kasa bağlantıları |
| Ekip üyesi | Satış kaydı, ürün ve stok okuma, müşteri işlemleri, görevler ve bağlı işletmeler. Ürün maliyetleri yönetici rollerine ayrılır |

AI gider veya stok taslağı oluşturabilir. Kayda yalnızca taslağı oluşturan yetkili kullanıcı “Onayla ve uygula” dediğinde geçilir.

## Mevcut kasadan aktarım

Ayarlar → Kasa bağlantıları üzerinden sunucu anahtarı oluşturun. Kasa sağlayıcısının entegrasyonu `POST /api/pos` isteğini `Authorization: Bearer olvex_pos_…` ve `Content-Type: application/json` başlıklarıyla gönderir.

```json
{
  "action": "sale",
  "reference": "KASA-001",
  "date": "2026-11-17",
  "paid": true,
  "lines": [{ "sku": "URUN-01", "quantity": 2, "unit": 12550 }]
}
```

`unit` kuruş, `quantity` tam adettir. Bir satışta en fazla 25 ürün satırı olabilir. Kayıt ve stok düşümü aynı D1 işlemi içinde uygulanır. Aynı bağlantı aynı referansı aynı içerikle yeniden gönderirse önceki kayıt döner. Referansa bağlı içerik değişirse istek çakışma hatası döndürür.

Tam iade için aynı bağlantı ve referansla `{"action":"void","reference":"KASA-001","date":"2026-11-17"}` isteğini gönderin. Ödeme alınmışsa iade tutarı, iade tarihinde nakit çıkışı olarak görünür.

CSV aktarımı için başlık `referans;tarih;sku;adet;birim_fiyat` biçimindedir. Birim fiyat TL olarak verilir. Aynı fişin ürünlerini aynı referansla yazın. Dosya tekrar yüklenirse önceden kaydedilen fişler atlanır. Bir fişi CSV veya kasa bağlantısı üzerinden bir kez aktarın.

## Finans ve belge sınırları

Brüt kâr satış anındaki ürün maliyetini kullanır. Satın alma fiyatı alış kaydında saklanır. Ürün kartındaki maliyet, ürün düzenleme ekranından güncellenir. Tahsilat ve ödemeler kendi tarihlerinde nakit akışına girer.

Faturalar bölümü belge takibi sağlar. GİB e-Fatura ve e-Arşiv belgeleri için işletmenin yetkili sistemi kullanılır. Lansman paketleri bilgilendirme amaçlıdır. Ödeme altyapısı açılmadan abonelik tahsilatı yapılmaz.
