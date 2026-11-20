# OLVEX Profesyonel ve kartlı deneme

Yeni satış için aylık 999 TL veya yıllık 9.590,40 TL tutarında tek paket hazırlanmıştır. Yıllık indirim %20’dir. Esnaf satışa kapalıdır. Geçmiş Esnaf abonelikleri önceki tarife, dönem ve haklarıyla doğrulanır.

## Kart doğrulaması ve erişim

1. İşletme sahibi dönemi seçer ve yenileme koşullarını kabul eder. Sunucu fiyatı, TRY para birimini, ödeme sıklığını, tekrarlayan planı ve `trialPeriodDays = 14` değerini iyzico plan detayından kontrol eder. Doğrulanan plan referansı ve onay zamanı abonelik kaydındadır. [iyzico ödeme planı](https://docs.iyzico.com/urunler/abonelik/abonelik-entegrasyonu/odeme-plani)
2. Kart alanlarını iyzico Checkout Form sunar. iyzico kart doğrulaması için 1 TL çeker ve hemen iade eder. Deneme boyunca normal abonelik ücreti alınmaz. OLVEX kart numarası veya CVV saklamaz. [iyzico abonelik işlemleri](https://docs.iyzico.com/urunler/abonelik/abonelik-entegrasyonu/abonelik-islemleri)
3. Callback’teki belirtecin özeti D1’deki ödeme oturumuyla eşleşmelidir. Sunucu iyzico’dan form sonucunu ve abonelik detayını ayrı ayrı alır. İlgili müşteri, plan ve abonelik referansları, ACTIVE durumu ve tam 14 günlük sağlayıcı zaman aralığı doğrulanınca başlangıç ve bitiş kaydedilir. Tekrar gelen bildirim bu süreyi uzatamaz.
4. Yazma işlemleri D1 saatine göre geçerli denemeye veya doğrulanmış ödenmiş döneme bağlıdır. İlk tahsilat için webhook imzası kontrol edilir ve sipariş durumu, dönem, tutar ve para birimi sağlayıcıdan yeniden okunur. Ödeme gelmezse işletme kayıtları okunabilir. Deneme sırasında doğrulanmış iptalde kalan deneme süresi boyunca erişim korunur.
5. İşletme ve sahip için ikinci deneme kısıtlanır. Aynı kimlik numarası ve telefon ikilisinin farklı hesapla tekrar kullanılması, ortama özel gizli anahtarla üretilen HMAC ve D1 benzersizlik kısıtıyla denetlenir. Tek başına ortak telefon, IP veya isim eşleşmesi müşteriyi engellemez. Fatura bilgileri müşterinin beyanıdır. Bu kontrol farklı kimlik ve telefonlarla kaydı bütünüyle önlemez.
6. Kesin form başlatma hatası rezervasyonu serbest bırakır. Belirsiz veya yarım kalan işlemlerde destek, iyzico işlem kaydını uzlaştırmalıdır. Açık bir aboneliğin bulunmadığı doğrulanmadan yeni tahsilat akışı başlatılmaz. Eski müşterinin ücretli dönüşü de destek üzerinden ele alınır.

## iyzico onayından sonra

- Önce ayrı sandbox ürününde MONTHLY ve YEARLY olmak üzere iki yeni, süresiz RECURRING plan tanımlayın. Her ikisinde `paymentIntervalCount = 1`, `currencyCode = TRY`, `trialPeriodDays = 14` kullanın. Eski plan referanslarını veya fiyatlarını değiştirmeyin.
- Yalıtılmış test ortamında `OLVEX_BILLING=sandbox`, `OLVEX_ENVIRONMENT=preview`, tam HTTPS `OLVEX_BILLING_ORIGIN` ve iki `IYZICO_PROFESYONEL_*` plan referansı gerekir. API anahtarlarını, üye işyeri numarasını ve en az 32 karakterlik sabit, bağımsız `OLVEX_TRIAL_IDENTITY_SECRET` değerini gizli yapılandırmada tutun. HMAC anahtarının değişmesi önceki kimlik eşleşmelerini etkiler.
- Sağlayıcıda aynı ortama ait `/api/billing/webhook` adresini ve V3 imzalı abonelik bildirimlerini yapılandırın. Sandbox test kartıyla gerçek form/CSP, kart doğrulaması ve iade, ACTIVE detay tarihleri, iptal, ilk başarılı ve başarısız tahsilatı sınayın. Sağlayıcı hareketlerini ve D1 kayıtlarını karşılaştırın.
- Üretime geçişte D1 yedeğini ve migrasyon sırasını gözden geçirin. Ayrı, eklemeli `0015_professional_trial.sql` için yayın planı ve nihai sözleşme/onay metinleri gereklidir. Bu PR yalnız sandbox ortamında yeni abonelik açar. Canlı satış için sandbox kanıtı ve iyzico onayından sonra ayrı bir kod incelemesi ve yayın kararı gerekir.
