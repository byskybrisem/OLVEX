# Geçmiş iyzico abonelikleri

Yeni satışların ödeme sağlayıcısı Polar olarak belirlendi. [Güncel OLVEX aboneliği ve Polar lansman rehberi](./POLAR-LANSMAN-TEKLIFI.md).

iyzico plan tutarları, geçmiş ödeme dönemlerinin doğrulanması için aşağıda kayıtlıdır. Önceki planlarda yeni checkout başlatılmaz. Mevcut işlemlerin dönüş, yenileme ve iptal yolları ile mevcut aylık checkout sözleşmesi korunur.

| Paket | Aylık | Yıllık ödeme (%20 indirim) |
| --- | ---: | ---: |
| Esnaf | 499,00 TL | 4.790,40 TL |
| Profesyonel | 999,00 TL | 9.590,40 TL |

Fiyat ve plan eşleşmesini sunucu belirler. Checkout başlamadan önce iyzico planının TL fiyatı, aylık/yıllık periyodu, tek periyot aralığı, tekrarlayan ödeme tipi ve deneme süresi kontrol edilir. Ücretsiz kayıt ve mevcut modüller ödeme yapılandırmasına bağlı değildir. Abonelik API’sinin verdiği katman işletmeye aittir. Süresi dolmamış ve tutarı doğrulanmış bir ödeme dönemiyle etkinleşir. İptal doğrulanınca, ödeme başarısız olduğunda veya dönem bittiğinde ücretsiz katman döner. Geçmiş aboneliklerin kendi dönemleri ve paket limitleriyle doğrulanması sürer.

## API ve hata davranışı

- Paket erişiminde doğrulanmış abonelik durumu ve ödenmiş dönem sonu esas alınır. Bir sandbox aboneliği yalnızca sandbox önizlemesinde paket erişimi sağlar. Canlı onayı, ayrı ödeme sayfası ve uçtan uca doğrulama tamamlanıncaya kadar üretimde tahsilat kapalı kalmalıdır.
- İşletme sahibi `GET /api/workspace/{businessId}/billing` ile durum alabilir. Aynı yola yapılan POST için işlemler `checkout`, `refresh` ve `cancel` değerleridir. Yazma istekleri normal oturum ve aynı köken denetiminden geçer.
- Checkout, istemci tarafından oluşturulan UUID `requestId`, plan kodu, ad, soyad, telefon, kimlik numarası, fatura adresi ve il alır. E-posta oturumdan alınır. Kart verisi iyzico formunda girilir. Bu müşteri alanları ve kart bilgileri OLVEX D1’de saklanmaz.
- `checkoutFormContent` iyzico’nun HTML/JavaScript içeriğidir. Yayın öncesinde ana uygulamanın oturum ve DOM erişiminden ayrılmış bir ödeme sayfasında barındırılması ve gerçek sağlama/3D Secure dönüşleriyle sınanması gerekir. OLVEX’in mevcut fiyat kartları ücretli satın alma başlatmaz.
- Dönüş POST’u, yerel checkout kimliğini ve iyzico form token’ını eşleştirir. Ödeme sonucu ve abonelik detayı imzalı sunucu istekleriyle alınır. Webhook, `X-IYZ-SIGNATURE-V3` imzasını doğrular ve ödeme dönemini aynı işletmeye ait sağlayıcı kaydından yeniden okur.
- İşletme başına bir açık checkout veya abonelik vardır. Aynı istek kimliği yeniden form başlatmaz. İlk yanıt kaybolursa tekrar isteği yalnızca durum döndürür. Zaman aşımında yeni ödeme oturumu üretmeden önce iyzico panelinde `conversationId` veya abonelik referansıyla mutabakat gerekir. İlk ödeme reddinden sonra da aynı sağlayıcı token’ı tekrar doğrulanabilir.
- İptal, iyzico'nun etkin abonelik iptal işlemini çağırır. Sonuç belirsizse tekrar istek sadece sağlayıcı durumunu okur. Yeni iptal çağrısı için operasyonel mutabakat gerekir. İade, dönem sonunda iptal, kart güncelleme ve plan geçişi bu akışta sunulmuyor.

## Mevcut ortamın yapılandırması

Bu ayarlar önceki iyzico kurulumlarına aittir.

| Cloudflare Pages ayarı | Değer |
| --- | --- |
| `OLVEX_BILLING` | Varsayılan kapalı. Ayrı test ortamı için `sandbox`, canlı açılışta `live` |
| `IYZICO_API_KEY`, `IYZICO_SECRET_KEY` | İlgili ortamın Cloudflare secrets değerleri |
| `IYZICO_MERCHANT_ID` | V3 imzada kullanılan iyzico üye işyeri numarası |
| `OLVEX_BILLING_ORIGIN` | Callback’in alınacağı HTTPS kökeni |
| `IYZICO_ESNAF_MONTHLY`, `IYZICO_ESNAF_YEARLY` | Esnaf aylık/yıllık sağlayıcı plan referansları |
| `IYZICO_PROFESYONEL_MONTHLY`, `IYZICO_PROFESYONEL_YEARLY` | Profesyonel aylık/yıllık sağlayıcı plan referansları |

[Üye işyeri başvurusu](https://www.iyzico.com/isim-icin/sanal-pos) · [Yardım merkezi](https://www.iyzico.com/destek/yardim-merkezi) · [Abonelik işlemleri](https://docs.iyzico.com/urunler/abonelik/abonelik-entegrasyonu/abonelik-islemleri) · [Ödeme planı](https://docs.iyzico.com/urunler/abonelik/abonelik-entegrasyonu/odeme-plani) · [IYZWSv2](https://docs.iyzico.com/en/getting-started/preliminaries/authentication/hmacsha256-auth) · [Webhook V3](https://docs.iyzico.com/en/advanced/webhook)
