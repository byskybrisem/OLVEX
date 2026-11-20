# OLVEX Polar aboneliği

| Aylık teklif | Deneme | İlk 3 ücretli dönem | 4. ücretli dönem ve sonrası |
| --- | --- | --- | --- |
| Standart | Ödeme kartıyla 14 gün | 999 TL/ay | 999 TL/ay |
| Lansman | Yok | 700 TL/ay | 999 TL/ay |

Her iki teklif aynı OLVEX yetkilerini verir. İndirim ayda 299 TL ve toplam 897 TL’dir. Checkout ve portal işletme sahibinin panelinde **Ayarlar → Aboneliği yönet** altında görünür. Başarı dönüşü yalnızca durumu gösterir. Standart deneme, doğrulanmış checkout ve sağlayıcıdaki 14 günlük deneme kaydıyla erişim açar. Ücretli erişim doğrulanmış sipariş ve dönem eşlemesiyle açılır.

## İzole Cloudflare Pages önizlemesi

- Üretimden ayrı bir D1 kullanın ve `0017_polar_billing.sql` dahil tüm ilgili migrasyonları yalnızca test D1’e uygulayın. Mevcut iyzico tabloları korunur. Bu migrasyon yeni tablo ve erişim görünümü ekler.
- Polar Sandbox organizasyonunda iki TRY fiyat tanımlayın. Liste bedelleri 99900 kuruş, sıklık ayda bir, vergi davranışı **inclusive** olmalı. Standartta 14 günlük kartlı deneme ve deneme kötüye kullanım korumasını etkinleştirin. Lansmana deneme eklemeyin. Yalnız lansman ürününe bağlı, kod girişi kapalı, üç ay tekrarlayan sabit 29900 TRY kuruş indirim oluşturun.
- Aşağıdaki ayarları yalnızca HTTPS önizleme ortamına girin. Dönüş ve webhook isteklerinde köken bu ayarla eşleşmelidir.

| Ayar | Önizleme değeri |
| --- | --- |
| `OLVEX_ENVIRONMENT` | `preview` |
| `OLVEX_POLAR` | `sandbox`. Varsayılan kapalı. |
| `OLVEX_POLAR_ORIGIN` | Sabit HTTPS önizleme kökeni, sona eğik çizgi eklemeyin |
| `POLAR_STANDARD_PRODUCT_ID`, `POLAR_LAUNCH_PRODUCT_ID`, `POLAR_LAUNCH_DISCOUNT_ID` | Sandbox ürün ve indirim kimlikleri |
| `POLAR_ACCESS_TOKEN` | Cloudflare Secret. Sandbox checkout ve müşteri oturumu yazma, checkout/abonelik/sipariş okuma yetkilerine sahip organizasyon anahtarı |
| `POLAR_WEBHOOK_SECRET` | Cloudflare Secret. Sandbox webhook uç noktasında kullanılan imzalama sırrı |
| `OLVEX_LAUNCH_OFFER` | `on` OLVEX lansman teklifine yeni başvuruları açar. |
| `OLVEX_LAUNCH_OFFER_STARTS_AT`, `OLVEX_LAUNCH_OFFER_ENDS_AT` | İsteğe bağlı UTC `YYYY-MM-DDTHH:mm:ssZ`. Başlangıç dahil, bitiş hariç. Polar indirim penceresiyle eşleştirin. |

- Polar webhook adresi `<önizleme kökeni>/api/polar/webhook` ve API sürümü `2026-10` olmalı. `checkout.updated`, `checkout.expired`, `subscription.created`, `subscription.updated`, `subscription.active`, `subscription.cycled`, `subscription.canceled`, `subscription.uncanceled`, `subscription.revoked`, `subscription.past_due`, `subscription.paused`, `subscription.resumed`, `order.created`, `order.updated`, `order.paid`, `order.refunded`, `refund.created` ve `refund.updated` olaylarını seçin.
- Test hesabıyla işletme açın. İki teklifi ayrı test işletmelerinde Stripe test kartıyla yürütün. Standart akışta kart, doğrulanmış deneme, deneme sonu ve ilk 999 TL siparişi kontrol edin. Lansmanda 700 TL × 3 ve ardından 999 TL sıralamasını, başarısız ödeme ve yeniden denemeler dahil doğrulayın. Polar ay bazında indirim tanımlar. Hatalı veya beklenmeyen tutar OLVEX’te erişim açmaz. Geç ödeme ve ay sonu davranışı için gerçek sandbox kanıtı gerekir.
- İptal, iade, başarısız yenileme, webhook tekrar teslimi, yabancı işletme ve doğrudan başarı sayfası ziyareti senaryolarını doğrulayın. Polar teslim geçmişindeki 2xx yanıtların karşılığını test D1’de `olvex_polar_events` ve `olvex_polar_checkouts` üzerinden kontrol edin. Başarısız webhook’u Polar’dan yeniden teslim edin.

## İşletim

Polar katalog okumasında iki ürünün 99900 TRY kuruş aylık fiyatı, standart denemenin 14 gün olduğu ve lansmanın 29900 kuruşluk üç aylık indirimi doğrulandı. İki fiyatın vergi davranışı ürün kayıtlarında açıkça ayarlanmamış, lansman indiriminin tarih alanları boş. Sandbox sonrasında checkout yanıtında `inclusive` davranışı doğrulanmalı.

OLVEX yalnızca kendi sunucusunun oluşturduğu, işletme kimliği ve yerel checkout kaydıyla eşleşen Polar aboneliklerini işler. Harici hazır ödeme bağlantıları ayrı işlem yaratabilir. Aktif müşterileri eşleştirmeden ve ayrı onay almadan bu bağlantıları değiştirmeyin.

Checkout çağrısı sağlayıcıda oluşup yanıt kaybolursa D1 rezervasyonu ikinci checkout’u engeller. Operatör, Polar’da işletme dış kimliği ve `olvex_checkout` metadatasıyla işlemi uzlaştırmadan rezervasyonu açmamalıdır. İşlemde ilk veya sonraki ücret belirtilen fiyatla uyuşmazsa erişim durumu kontrol edilip gerçek tahsilat Polar’dan uzlaştırılır.

Sandbox doğrulaması ve açık yayın onayı tamamlandıktan sonra üretime özel D1 migrasyonu, Polar ürün/indirim kimlikleri, token, webhook sırrı ve izinli canlı köken ayarlanabilir. Canlı mod `OLVEX_POLAR=live` ile açılır. Kodun varsayılanı kapalıdır. Payout otomasyonu bu akışın kapsamı dışındadır.

[Polar denemeleri](https://polar.sh/docs/features/subscriptions/trials) · [Polar indirimleri](https://polar.sh/docs/features/discounts) · [Checkout oturumu](https://polar.sh/docs/features/checkout/session) · [Sandbox API şeması](https://sandbox-api.polar.sh/openapi.json)
