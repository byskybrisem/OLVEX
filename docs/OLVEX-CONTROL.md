# OLVEX Control — Super Admin

Bu panel işletme sahibi yönetiminden **bağımsızdır**. Platforma ait gelir/gider kayıtları müşterilerin satış veya nakit kayıtlarıyla birleştirilmez.

## Güvenlik

- `/admin.html` statik bir giriş kabuğudur. Her veri isteği `/api/admin/{section}` üzerinden sunucuda yeniden yetkilendirilir.
- `OLVEX_SUPER_ADMIN_USER_ID` yalnızca **yetkilendirmek istediğiniz mevcut kullanıcının tam `users.id` değeri** olmalıdır. Bu ayar bulunmadığında API 503 ile kapalıdır.
- Normal `owner`, `admin`, `member` işletme rolleri **platform yöneticisi yapmaz**.
- Kimlik bir e-posta adresinden, URL parametresinden, istemci tarafı değişkenden veya işletme rolünden çıkarılmaz. Hash'i doğrulanmış ve süresi dolmamış `olvex_session` oturumu gerekir.
- POST işlemlerinde same-origin kontrolü ve sunucu veri doğrulaması uygulanır.
- API yanıtları `no-store` ve güvenli içerik başlıklarıyla döner. Özel kullanıcı girdileri HTML'e kaçışlanarak işlenir.
- Gelir/giderler fiziksel olarak silinmez; iptal bilgisi ve değiştirilemez SQL trigger audit olayı saklanır.
- İlk sürüm müşteri işletmelerini veya kullanıcı hesaplarını **sadece okur**. Başkalarının finansal işlem detaylarını veya AI sohbet içeriklerini görüntüleme yetkisi vermez.
- **Bu sürüm tek başına MFA değildir.** Canlıya açmadan önce yönetici hesabı için ek koruma (Cloudflare Access ve uygun MFA politikası) kurulmalıdır.
- Tanımlı yönetici kullanıcı kimliği bir erişim anahtarı değildir; yine de yanlış hesapla eşleşmemesi için doğru kullanıcıdan alınmalıdır. İki farklı hesaba yetki verilmez.

## Yayına alma

1. CI ve tarayıcı kontrolleri geçmeden PR'ı birleştirmeyin.
2. Canlı D1'in geri dönüş noktası/yedeği doğrulanıp `0013_platform_admin.sql` geçişi **açık onayla** uygulanmalı. Bu geçiş yalnızca yeni tablolar, indeksler ve tetikleyiciler ekler.
3. Yönetici olarak giriş yapılan hesabın `/api/auth/me` yanıtındaki `user.id` değerini doğrulayın; Cloudflare Pages **Production** değişkeni `OLVEX_SUPER_ADMIN_USER_ID` olarak ekleyin.
4. Yalnızca bu hesapta `/admin.html` açıp yetki testini tamamlayın. Başka bir kullanıcıyla 403 ve oturumsuz 401 aldığını doğrulayın.
5. Finans kayıtları oluşturma, idempotent tekrar, iptal ve denetim geçmişini kontrol edin.
6. Yönetici sayfasını site menüsünde veya arama motorunda tanıtmayın. Güvenlik yalnızca URL gizliliğine dayanmaz.

## Bölümler

- Genel Bakış: toplam işletme, kullanıcı, oturumlu hesap, aktif kasa, bugün AI isteği ve dönemde manuel kaydedilen platform gelir/gideri.
- İşletmeler / Kullanıcılar: sayfalanmış kimlik ve üyelik özetleri; müşteri satış satırlarına erişilmez.
- Gelir/Gider: onaylı tarih aralığında kuruş hassasiyetli, denetimli OLVEX platform defteri; grafik ve tablo, güvenli iptal.
- Abonelikler: iyzico abonelik **durumları**, canlı ve sandbox ayrımı. Durum/ödemesi geleceğe uzanan abonelik satırları nakit tahsilatı kanıtlamaz.
- AI Kullanımı: model ve güne göre istek/token metrikleri, mesaj içeriği yok.
- Sistem: son D1 migrasyonu, defter denetim geçmişi.

**Finansal gerçeklik:** İyzico abonelik tabloları ödeme dönemi ve durumunu tutsa da doğrulanmış ödeme dökümü, iade, komisyon ve gider defterini tutmaz. Bu nedenle yönetici gelir toplamı, ancak bu ekrana manuel girilmiş **OLVEX platform kayıtlarından** hesaplanır. Otomatik abonelik tahsilat mutabakatı ayrı bir geliştirme ve muhasebesel doğrulama gerektirir.

## Test

```sh
npm ci
npm run build
npm test
npm run test:browser
npm run test:browser:branches
```

`tests/admin.test.mjs` her çalıştırmada ayrı yerel D1 ile kimlik doğrulama, başka tenant'a erişim engeli, CSRF, doğru kuruş hesabı, tekrar eden istek ve iptal denetimini kontrol eder.

## Tasarım

`assets/admin.css` proje renk değişkenleri üzerinden koyu mor/teal cam kartlar, yönetici menüsü, grafikler, responsive tablo ve iPhone güvenli alan desteği sunar. Yönetici uygulaması ayrı `admin.html` + `assets/admin.js` dosyalarında tutulur; normal işletme panelinin kaynaklarını değiştirmez.
