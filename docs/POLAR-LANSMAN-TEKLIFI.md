# Profesyonel lansman teklifi ve Polar

| Aylık teklif | Deneme | İlk 3 ücretli dönem | 4. ücretli dönem ve sonrası |
| --- | --- | --- | --- |
| Profesyonel Standart | 14 gün, ödeme açıldığında | 999 TL/ay | 999 TL/ay |
| Profesyonel Lansman | Yok | 699 TL/ay | 999 TL/ay |

İki teklif de aynı Profesyonel paket yetkilerine karşılık gelir. İndirim 300 TL/ay, üç dönemde toplam 900 TL ve oranı yaklaşık %30’dur. Esnaf ve yıllık liste fiyatları bu kampanyanın dışındadır.

## Sitede gösterim

Cloudflare Pages Preview değişkenleri:

| Değişken | Değer |
| --- | --- |
| `OLVEX_LAUNCH_OFFER` | Yalnızca `on` kampanyayı gösterir. Varsayılan kapalıdır. |
| `OLVEX_LAUNCH_OFFER_STARTS_AT` | İsteğe bağlı, başlangıç dahil. UTC biçimi `YYYY-MM-DDTHH:mm:ssZ`. |
| `OLVEX_LAUNCH_OFFER_ENDS_AT` | İsteğe bağlı, bitiş hariç. Aynı UTC biçimi. |

Belirtilen bir tarih geçersizse veya tarih aralığı tersse OLVEX standart fiyatları gösterir. Ana sayfa güncel teklifi önbelleksiz `/api/public-info` yanıtından okur. Kampanya anahtarı yalnızca yeni teklifin gösterimini kontrol eder. Ödeme başlatmaz ve paket yetkisi vermez. `professional-launch-v1` koşullarını yeni bir kampanya için değiştirmek yerine yeni bir sürüm tanımlayın.

## Polar Sandbox doğrulaması

- Polar Checkout API şeması TRY para birimini listeler. Bir aylık Profesyonel ürünün sabit liste bedeli `99900` kuruş olmalı. Vergi sonrasında Türkiye’de müşteriye gösterilen ve tahsil edilen nihai tutarı checkout ve faturada doğrulayın. Türkiye’nin Polar ödeme aktarımı listesinde yer alması, OLVEX hesabının onaylandığı anlamına gelmez.
- Standart checkout aynı aylık üründe `allow_trial: true`, `trial_interval: "day"`, `trial_interval_count: 14` ve `allow_discount_codes: false` ile hazırlanabilir.
- Lansman checkout aynı aylık üründe `allow_trial: false`, `allow_discount_codes: false` ve sunucunun eşlediği `discount_id` ile hazırlanabilir. İndirimi yalnızca bu ürüne bağlayın. Polar’ın sabit tutarlı indiriminde `duration: "repeating"`, `duration_in_months: 3` ve `amounts: { "try": 30000 }` kullanılır. Kod alanı boş bırakılarak indirim yalnızca yetkili checkout üzerinden uygulanabilir.
- Polar belgeleri tekrar eden indirim süresini ay olarak tanımlar. Ay sonu, geciken/başarısız tahsilat ve yeniden deneme senaryolarında indirimin OLVEX’in **ilk üç ücretli dönem** taahhüdünü sağladığını gerçek sandbox aboneliğinde doğrulayın. Aynı aboneliğin dördüncü ücretli döneminde 999 TL tahsil edildiğini ve kampanya kapanınca önceden uygulanmış indirimin devam ettiğini doğrulayın. Tarih veya anahtar değişikliğinde mevcut aboneliklerden indirim kaldırmayın.
- Ödeme uygulaması sunucuda işletme sahibi ve ürün eşlemesini doğrulamalı. Yeni seçimde sunucu kampanya penceresini kontrol etmeli, sağlayıcı checkout ve abonelik kimliğini işletme ve kabul edilen teklif sürümüyle saklamalı. İstemciden yalnızca teklif seçimi alınmalı. Tutar, para birimi, deneme ve indirim sağlayıcıya sunucu tarafından gönderilmeli.
- Paket erişimi için imzalı Polar olayı ve sağlayıcı kaydı birlikte doğrulanmalı. `order.paid` olayındaki işletme eşlemesi, ürün, abonelik, dönem, para birimi ve fiyat kontrol edilmeli. Tutar karşılaştırması için vergi ve bakiye alanları ayrıştırılmalı. Tekrar eden olaylar ve siparişler aynı ücretli dönemi ikinci kez açmamalı. Sunucuda beklenen ücret için `professionalCharge` kullanılır. Standart denemeye erişim açılacağı zaman ayrı, süreli ve Polar tarafından doğrulanmış bir deneme kaydı uygulanmalı. Ücretli abonelik olarak kaydedilmemeli.
- Bu değişiklik fiyatlandırmayı ve sunucu teklif kurallarını hazırlar. Polar checkout, webhook, işletme eşlemesi ve deneme erişimi henüz bağlı değil. Bunlar sandbox’ta doğrulanıp canlı yayın onayı alındıktan sonra tahsilat etkinleştirilebilir.

[Polar indirimleri](https://polar.sh/docs/features/discounts) · [Polar denemeleri](https://polar.sh/docs/features/subscriptions/trials) · [Checkout oturumu](https://polar.sh/docs/features/checkout/session) · [Sandbox API şeması](https://sandbox-api.polar.sh/openapi.json) · [Desteklenen ülkeler](https://polar.sh/docs/merchant-of-record/supported-countries)
