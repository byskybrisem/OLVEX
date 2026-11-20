# OLVEX aylık aboneliği ve Polar

| Teklif | Deneme | İlk 3 ücretli dönem | 4. ücretli dönem ve sonrası |
| --- | --- | --- | --- |
| Standart | Kart ile 14 gün | 999 TL/ay | 999 TL/ay |
| Lansman | Yok | 700 TL/ay | 999 TL/ay |

Her iki teklif aynı OLVEX abonelik haklarına karşılık gelir. Lansman indirimi 299 TL/ay ve toplam 897 TL’dir.

## Sitede gösterim

| Cloudflare Pages Preview değişkeni | Değer |
| --- | --- |
| `OLVEX_LAUNCH_OFFER` | `on` kampanyayı gösterir. Varsayılan kapalıdır. |
| `OLVEX_LAUNCH_OFFER_STARTS_AT` | İsteğe bağlı, başlangıç dahil. UTC biçimi `YYYY-MM-DDTHH:mm:ssZ`. |
| `OLVEX_LAUNCH_OFFER_ENDS_AT` | İsteğe bağlı, bitiş hariç. Aynı UTC biçimi. |

Geçersiz veya ters tarih aralığında OLVEX standart fiyatı gösterir. Sayfa güncel teklifi önbelleksiz `/api/public-info` üzerinden okur. Gösterim ayarı ödeme başlatmaz veya paket yetkisi vermez. Kullanıma alındıktan sonra `olvex-monthly-launch-v1` koşulları sabit kalır. Yeni koşullar için yeni bir teklif sürümü tanımlanır.

## Polar’da okunarak doğrulananlar

- OLVEX organizasyonunda mevcut iki aylık ödeme bağlantısının ürün bedeli `99900` TRY kuruştur. İkisi aynı OLVEX paketi olarak eşlenmelidir. Standart bağlantının ürününde ve bağlantı ayarında 14 günlük deneme vardır. Polar denemeyi başlatırken ödeme bilgisi alır ve deneme bitiminde ilk tahsilatı yapar.
- Lansman ürünü ve bağlantısında deneme süresi tanımlı değildir. Lansman bağlantısında yalnız bu ürüne bağlı `29900` TRY kuruşluk, üç ay tekrarlayan sabit indirim seçilidir. İndirim kodu boş ve harici kod girişi kapalıdır. Polar indiriminde başlangıç veya bitiş tarihi henüz tanımlı değildir.
- OLVEX organizasyonunun durumu `created` ve webhook listesi boştur. Uygulama bağlantıları ödeme başlatmaz. Bu kontrol bir ödeme veya deneme işlemiyle uçtan uca doğrulama içermez.

## Tahsilatı açmadan önce

1. Polar organizasyonunun onayını ve tahsilat koşullarını tamamlayın. 999 TL ve 700 TL tutarlarının Türkiye’de checkout ve faturada vergiler ve bakiye hesaba katıldığında doğru göründüğünü sandbox’ta doğrulayın.
2. Kampanya başlangıç ve bitişini Polar ile OLVEX’te eşleştirin. Yeni lansman checkout’larını pencere dışında reddedin ve eskiden uygulanmış indirimleri aboneliklerden kaldırmayın. Sandbox’ta ay sonu, başarısız ödeme ve yeniden deneme dahil ilk üç **ücretli** dönemin 700 TL, dördüncünün 999 TL olduğunu kontrol edin. Polar’ın ay bazında tekrar ayarı tek başına bu senaryoları kanıtlamaz.
3. Checkout’u sunucuda işletme sahibine ve doğrulanmış ürün/teklif kimliğine bağlayın. Standart checkout için `allow_trial: true`, `trial_interval: "day"` ve `trial_interval_count: 14` kullanılır. Lansman checkout’unda `allow_trial: false` ve doğrulanmış `discount_id` kullanılır. Her ikisinde `allow_discount_codes: false` olmalıdır. Checkout yönlendirmesi erişim açmaz.
4. Polar webhook’u yapılandırıp imzalı olay ve sağlayıcı kaydıyla işletme, ürün, ödeme, süre ve para birimini doğrulayın. Tekrarlanan olayları ve siparişleri idempotent işleyin. Ödenmiş dönem tutarı için `launchCharge` kullanılabilir. Standart deneme için Polar tarafından doğrulanmış, süreli bir erişim kaydı gerekir. Dönüş sayfası, iptal, iade ve yenileme senaryolarını test edin.
5. Sandbox doğrulaması ve ayrı yayın onayından sonra canlı tahsilatı etkinleştirin. Polar sırlarını sunucu ortamında tutun.

[Polar denemeleri](https://polar.sh/docs/features/subscriptions/trials) · [Polar indirimleri](https://polar.sh/docs/features/discounts) · [Checkout oturumu](https://polar.sh/docs/features/checkout/session) · [Sandbox API şeması](https://sandbox-api.polar.sh/openapi.json)
