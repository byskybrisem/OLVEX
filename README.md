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

İşletmeler → Şubeler bölümünden şubeyi oluşturun. Ayarlar → Kasa bağlantıları bölümünde her fiziksel kasaya ayrı kayıt açın ve şubesini seçin. Anahtarı yenilerken aynı kasa kaydını kullanın. Şubenin stok bakiyesi ve işletmenin birleşik bakiyesi ürün ekranında görülebilir. Şubeler arası transfer modeli aynı işletmedeki iki şubeyi ve bir ürünü bağlar. Transfer kaydı iki stok hareketini birlikte oluşturur.

Kasa kaynağı kalıcı ve benzersiz işlem kimliği sağlıyorsa yönetici bunu kasa ayarında doğrulayabilir. Aynı kasa kimliği hem API hem CSV içe aktarımlarında kullanılır. Kasalar aynı fiş numarasını birbirinden bağımsız kullanabilir. Bir kasada günlük sıfırlanan fiş numarası tek başına yeterli olmaz. Üreticinin mali günlük kimliği ve kalıcı fiş sıra numarası birlikte özgünse adaptör bunları tek bir referans olarak gönderebilir.

`POST /api/pos` için `Authorization: Bearer olvex_pos_…` ve `Content-Type: application/json` başlıklarını gönderin. İşletme, şube ve kasa sunucudaki yetki kaydından alınır.

```json
{
  "action": "sale",
  "reference": "JOURNAL-724/FIS-001",
  "date": "2026-11-17",
  "paid": true,
  "lines": [{ "sku": "URUN-01", "quantity": 2, "unit": 12550 }]
}
```

`unit` kuruş, `quantity` tam adettir. Bir fişte en fazla 25 SKU olabilir. Satış, kalemler, stok ve varsa tahsilat aynı D1 işleminde kaydedilir. Yeni satış ve kısmi iade 201, aynı içeriğin tekrarı aynı kayıt kimliğiyle 200 döndürür. Aynı kimliğin farklı içerikle gönderilmesi 409 döndürür.

| İşlem | Örnek gövde |
| --- | --- |
| Bir adet iade | `{"action":"return","reference":"IADE-16","saleReference":"JOURNAL-724/FIS-001","date":"2026-11-18","lines":[{"sku":"URUN-01","quantity":1}]}` |
| Kalan satışı tümüyle iptal | `{"action":"void","reference":"JOURNAL-724/FIS-001","date":"2026-11-18"}` |

İade özgün satış kalemindeki fiyat ve maliyeti kullanır. Ödenmiş satışta iade tarihinde nakit çıkışı oluşur. Henüz tahsil edilmemiş satışta kalan alacak azalır. Kısmi iadeden sonraki iptal yalnızca kalan adet ve tutarı tersine çevirir.

**Çevrimdışı aktarım.** Kasa veya adaptör özgün işlemi, tarihini, kalemlerini ve kalıcı kimliğini yerel gönderim kuyruğunda saklamalıdır. Onay alınana kadar aynı kaydı gönderebilir. Ağ kesintisi veya geçici sunucu hatasında aynı kimlikle ve artan aralıklarla tekrar deneyin. İade satıştan önce gelirse 409 döner. Satışı aktardıktan sonra aynı iadeyi yeniden gönderin. Yetersiz şube stoğu, çelişen tarih veya farklı içerik de 409 döndürebilir. Bu durumlarda kaynak günlüğü ve bakiye kontrol edilmelidir.

**Uzlaştırma.** Kasa kalıcı kimlik sağlayamıyorsa yönetici, değişmez bir kaynak belgesindeki kayıt konumunu inceleyip bir kez eşleştirir. Örneğin değişmez bir kapanış dosyasının kimliği ve bu dosyadaki kalıcı fiş sırası kullanılabilir. Yönetici `POST /api/workspace/{businessId}/pos` üzerinden `action: "reconcile"`, UUID `requestId`, `registerId`, `eventKind` (`sale` veya `return`), `evidence` ve `reference` gönderir. Kasa bu modda `reference` yerine `evidence`, kısmi iadede ayrıca `saleReference` yerine `saleEvidence` gönderir. Eşleştirilmemiş kayıt stok ve ödeme oluşturmadan bekler. Ayırt edici bir kaynak kaydı bulunamayan fiş otomatik işlenemez.

**CSV.** Aktarımda fiziksel kasayı ve tahsilat durumunu seçin. Başlık `referans;tarih;sku;adet;birim_fiyat` biçimindedir. Fiyat TL cinsindendir. Bir fişin tüm satırlarında aynı referansı kullanın. Uzlaştırma modunda bu sütuna onaylı kaynak konumu yazılır. Aynı satış daha sonra aynı kasadan API üzerinden gelirse içerik eşleştiğinde mevcut satış kimliği döner.

**Geçiş.** Üretim geçişinde kasa ve stok yazımlarını duraklatıp D1 migrasyonlarını sırayla uygulayın, ardından yeni Pages sürümünü etkinleştirin. Eski işletme stoğu ve hareketleri o işletmenin yeni Merkez şubesine atanır. Eski kasa kimlikleri ve anahtarları korunur. Yöneticinin kaynağı doğrulamasına kadar bu kasalar uzlaştırma modundadır. Eski CSV kayıtlarında kasa bilgisi bulunmadığından yeni bir kasa kaydıyla çakışan referanslar incelemeye alınır. Yönetici kaynak günlüğünü doğruladığında `action: "link-csv"`, UUID `requestId`, `registerId`, `reference`, `evidence` ve `decision` gönderir. `same` aynı fişi, `distinct` bu kasanın ayrı satışını belirtir.

Zorunlu eşzamanlı satış testinin şube bakiyeleri, finans hesabı ve çalıştırma komutu test raporundadır. [Kasa testi](docs/KASA-TEST-RAPORU.md)

## Finans ve belge sınırları

Brüt kâr satış anındaki ürün maliyetini kullanır. Satın alma fiyatı alış kaydında saklanır. Ürün kartındaki maliyet, ürün düzenleme ekranından güncellenir. Tahsilat ve ödemeler kendi tarihlerinde nakit akışına girer.

Faturalar bölümü belge takibi sağlar. GİB e-Fatura ve e-Arşiv belgeleri için işletmenin yetkili sistemi kullanılır. Lansman paketleri bilgilendirme amaçlıdır. Ödeme altyapısı açılmadan abonelik tahsilatı yapılmaz.
