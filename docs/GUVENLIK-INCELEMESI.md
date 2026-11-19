# OLVEX güvenlik incelemesi

İnceleme `8db476e` tabanlı lansman dalındaki Pages Functions, D1 şeması, oturum ve hesap ekranları, işletme modülleri, statik yayın listesi ve HTTP başlıklarını kapsar. Kaynak kod incelemesi, yalıtılmış yerel D1 akışları ve bağımlılık taraması kullanıldı. İncelenen kapsamda açık kritik veya yüksek önem dereceli bir bulgu saptanmadı. Üretim altyapısının bağımsız sızma testi ve servis sağlayıcılarının denetimi bu çalışmanın kapsamı dışındadır.

## Bulgular

| Önem | Bulgu | Durum ve kanıt |
| --- | --- | --- |
| Orta | Açık kayıt, e-posta adresine bağlı bir hesap olup olmadığını HTTP durumu ve hata mesajıyla açıklıyordu. | Giderildi. Geçerli ilk ve tekrar başvurusu aynı 202 yanıtını üretir. Kimlik, parola ve sözleşme kaydı sadece yeni kullanıcı için yazılır. Yerel D1 testinde eski kullanıcı adı, parola ve onay durumu korundu. |
| Orta | İkinci faktör sunulmayan hesaplarda yeni parola için sekiz karakter yeterliydi. | Yeni kayıt ve yenilemede 15 karakter alt sınırı uygulandı. Girişte eski parolanın doğrulaması ve parola yöneticisi desteği korunuyor. Sunucu doğrulama testi uzunluk sınırlarını, Unicode karakter sayımını ve eski parola özetini kapsıyor. |
| Düşük | Hatalı yapılandırılmış kurtarma kökeni sıfırlama bağlantılarında kullanılabiliyordu. | Giderildi. Posta gönderimi için yapılandırılan kökenin HTTPS kullanması ve yol, kullanıcı bilgisi, sorgu veya fragment içermemesi gerekir. Geçersiz ayarda kurtarma erişilebilirliği kapalı görünür, istek 503 döner ve e-posta işi başlamaz. Yayın sahibi ayrıca doğru alan adını doğrulamalı. |
| Düşük | Statik sayfa başlıkları Functions yanıtlarını kapsamıyordu. Sayfa CSP'si satır içi stil bloklarına geniş izin veriyordu. | JSON yanıtları ve hatalar ortak `no-store`, `nosniff` ve kapalı CSP ile döner. Sayfalarda stil dosyaları aynı kökenle sınırlı. Grafik konumlandırması için gereken öğe stil öznitelikleri desteklenir. |
| Orta · açık | Saklanan parola özetlerinde PBKDF2-HMAC-SHA-256 için 100.000 yineleme kullanılıyor. Bu iş faktörü OWASP'ın güncel 600.000 tavsiyesinin altında. | Her kullanıcı için 16 bayt rastgele tuz ve sabit uzunluklu karşılaştırma var. Yayımdaki Workers çalışma süresi ve CPU bütçesiyle uyumlu, sürümlü bir yükseltme ve başarılı girişte yeniden özetleme ayrıca doğrulanmalı. [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) |

## Kontrol edilen sınırlar

- **Oturum ve hesap kurtarma.** Oturum ve sıfırlama belirteçleri 32 rastgele bayttan türetiliyor. D1'de SHA-256 özetleri tutuluyor. Oturum çerezi `Secure`, `HttpOnly`, `SameSite=Lax` ve ana makine kapsamlı. Sıfırlama bağlantısı 30 dakika geçerli. Parola sıfırlandığında kullanıcının tüm oturumları ve sıfırlama kayıtları aynı işlemde kaldırılıyor. Çıkış işlemi mevcut oturumu iptal ediyor.
- **Rol ve işletme sınırı.** Oturumdan alınan kullanıcı ile URL'deki işletmenin üyeliği, her bölüm ve işlem için sunucuda denetleniyor. İşletme kayıtlarını yazan toplu işlemler rolü yazma anında da doğruluyor. Yerel senaryolarda üyelik, üyelere maliyet alanlarının dönmemesi, işletmeler arası ayrım, iptal edilen kasa anahtarı ve AI taslağı onayında yetki değişimi kontrol edildi.
- **CSRF ve kötüye kullanım.** Tarayıcı çerezine bağlı yazma uçları aynı kökeni kontrol ediyor. JSON içerik türü ve gövde boyutu sınırlı. Kasa API'si ayrı bir Bearer anahtarı kullanıyor. Kayıt, giriş, davet kabulü ve parola sıfırlama limitleri sunucuda. Ters vekil tarafında istemci IP bilgisinin Cloudflare'dan gelmesi ve platform maliyet alarmlarının izlenmesi operasyonel bağımlılıklar.
- **Enjeksiyon ve hata yanıtları.** İşletme verileri SQL'e parametrelerle bağlanıyor. Dinamik tablo ve sütun adlarının incelenen çağıranları kod içi alan listeleri kullanıyor. Kullanıcı metni için panelde HTML kaçışı veya DOM metin yöntemleri uygulanıyor. Beklenmeyen hatalar istemciye genel ileti döndürüyor. Resend/OpenAI anahtarları sunucu bağlarından okunuyor. Derleme yalnızca izin verilen statik dosyaları yayımlıyor.
- **Denetim ve bütünlük.** İşletme işlemlerinde kullanıcı, işlem adı, istek kimliği ve içerik özeti tutuluyor. Sipariş ile stok değişiklikleri D1 toplu işlemi içinde yürütülüyor. Yeni satış düzeltmelerinin sürümü ayrı kayıtla ilişkilendiriliyor. Güvenlik olaylarını uzun süre saklayan merkezi bir günlük sistemi ayrıca doğrulanmadı.

## Yedekleme ve kanıt

İki ayrı **yerel** Wrangler D1 bağı kullanıldı. İlkine migrasyonlar ve sentetik kullanıcı, işletme ve üyelik kaydı uygulandı. `wrangler d1 export SOURCE --local --output export.sql` çıktısı ikinci bağa `wrangler d1 execute RESTORED --local --file export.sql` ile aktarıldı. Geri yüklenen bağda kullanıcı–üyelik–işletme sorgusu bir kayıt döndürdü. Her iki yerel SQLite dosyasının salt okunur kontrolünde `foreign_key_check` sıfır satır, `integrity_check` ise `ok` döndürdü. Tatbikat özgün müşteri verisi içermedi.

Üretim için gerçek D1 bağının kimliği, kurtarma penceresi, erişim yetkilisi ve kabul edilebilir veri kaybı süresi kayıt açılmadan önce yayın sahibiyle doğrulanmalı. Canlı veritabanına geri yükleme yapılmadı. [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

## Yeniden doğrulama

- `node --test tests/api.test.mjs tests/security.test.mjs` oturum, kayıt, yetki, kurtarma ve HTTP yanıtlarını denetler.
- `npm audit --json` bu kilit dosyası için sıfır bildirilen bağımlılık açığı döndürdü.
- Canlı posta alımı, sağlayıcı anahtarlarının rotasyonu, hesap e-postasının sahiplik doğrulaması ve MFA ayrı açık konulardır. Davet kabulünde hem geçerli davet belirteci hem de davetteki adresle eşleşen bir oturum gerekir.
