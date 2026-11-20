# OLVEX — 20 Kasım 2026 Tek Paket ve Kartlı Deneme Kararı

## Müşteriye görünen teklif
- **Tek abonelik paketi: Profesyonel.** Aylık **999 TL** veya yıllık **9.590,40 TL** (%20 indirim).
- **14 gün ücretsiz deneme**: yalnızca iyzico'nun güvenli kart doğrulaması tamamlanınca başlar, hesap kaydı tek başına deneme başlatmaz.
- Kullanıcı kartını iyzico Checkout Form üzerinde girer. OLVEX kart numarası/CVV saklamaz.
- Sağlayıcı kartı doğrulamak amacıyla geçici **1 TL çekip iade edebilir**. Deneme içinde abonelik bedeli alınmaz.
- Deneme süresi bitmeden abonelik iptal edilmezse **seçilen aylık veya yıllık abonelik tutarı** otomatik tahsil edilir. Başvuru öncesi açık onay alınır ve sunucuya kaydedilir.
- 1 işletme, 5 şube, 10 kullanıcı (işletme sahibi dahil). POS API/CSV/manual kayıt, transfer ve personel yetkileri mevcut backend'deki sınırlara tabidir. Kasa sağlayıcısına özel hazır bir bağlayıcı garanti edilmez; canlı AI sohbetinin pakete dahil olduğu iddia edilmez.
- Mevcut Esnaf kayıtları korunur ama **yeni Esnaf satışı açılmaz**. Eski aboneliklerin tutarı/tarihçesi değiştirilmez.

## Teknik uygulama
- `functions/_lib/iyzico.js`: yalnızca iki Profesyonel ödeme dönemi satılabilir; `legacyPlans` eski kayıtların güvenli doğrulanması içindir.
- `migrations/0015_professional_trial.sql`: deneme bitişi ve otomatik yenileme onay zamanı (additive schema).
- `functions/_lib/billing.js`: iyzico planının 14 gün / doğru fiyat / dönem koşullarını doğrulama, imzalı iyzico yanıtlarından deneme bitişini alma, ödemeli döneme geçiş ve iptal.
- `functions/_lib/entitlements.js`: aktif deneme veya ödenmiş dönemde Profesyonel yetkileri. Süre bitiminde ücret ödenmemişse erişim sona erer; kayıtlar saklanır.
- `functions/api/workspace/[businessId]/[section].js`: **yalnızca canlı ödeme yapılandırması açıkken** aktif aboneliği olmayan kullanıcıya yeni işleme izin verilmez; okuma/billing açık kalır. Yeni yazmalar veritabanı seviyesinde ayrıca sorgu korumasına tabidir. Mevcut müşterileri iyzico onayını beklerken kilitlememek için ödeme özelliği hâlâ kapalı.
- `billing.html`, `assets/billing.js`, `functions/api/billing/start.js`: işletme sahibi onayı ve sunucu üzerinden iyzico formu. Kart alanları OLVEX'te sunulmaz.

## Lansman ön koşulları — **tamamlandığı doğrulanmadan canlıya açmayın**
1. iyzico üye işyeri ve **Abonelik** özelliği canlı onaylanmalı; 2 Profesyonel fiyat planı iyzico panelinde `trialPeriodDays: 14` ile oluşturulmalı. Aylık/yıllık fiyatlar 999,00 / 9.590,40 TL ve tekrarlama sıklığı eşleşmeli.
2. Cloudflare D1 üretim veritabanına kontrollü migration `0015` uygulanmalı, yedek ve geri dönüşü planlanmalı.
3. Cloudflare secrets `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_MERCHANT_ID`; plain-text env `OLVEX_BILLING_ORIGIN` ve iki pro plan ref ayarlanmalı. Anahtarlar Git'e konmaz.
4. iyzico sandbox üzerinden gerçek Checkout Form yükleme/host CSP, kart 1 TL doğrulama, başlangıçta **0 TL abonelik ödemesi**, callback/webhook, 14 gün erişim, ilk tahsilat, yenileme, başarısız tahsilat, iptal ve tekrar deneme kötüye kullanım senaryoları test edilmeli.
5. Koşullar/ön bilgilendirme, vergi dahil tutar, fatura/muhasebe ve iptal/cayma/iade mevzuatı hukuk/mali müşavir tarafından kontrol edilmeli. Mesafeli hizmet sözleşmesi işlem öncesi saklanabilir ve doğrulanabilir onayla tamamlanmalı.
6. Tüm CI ve tarayıcı testleri geçmeli; gerçek kullanıcı, tarayıcı ve cihaz denetimi yapılmalı.
7. Yalnızca bunlar başarılı olunca `OLVEX_BILLING=live` ve kontrollü müşteri kaydı açılmalı.

**Not:** Bu dal canlı iyzico merchant hesabını aktive etmez. Üretimde mevcut ödeme kapalı uyarısı korunur.
