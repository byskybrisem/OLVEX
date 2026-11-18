# OLVEX ürün deneyimi · inceleme dosyası

## Başlangıç sürümü

İnceleme 18 Kasım 2026 tarihinde `bbae81235d7341e47dba812277b9015004e75477` üzerinden yapıldı. Bu sürüm önceki panel tasarımını ve mobil menü düzeltmesini içeriyor. İlk yerel Pages derlemesi, 21 Node testi ve Chromium/WebKit tarayıcı senaryoları geçti. Açılış sayfasında satış eğrisi ve AI örnekleri elle tanımlanmıştı. Mobil ziyaretçilere bölüm menüsü sunulmuyordu. Açıklama metninin ölçülen kontrastı 3,78:1 idi.

## Kod ve veri akışı

| Giriş noktası | Uygulamadaki karşılığı |
| --- | --- |
| `index.html`, `demo.html` | Herkese açık tanıtım ve tarayıcıda örnek kayıtlarla çalışan ürün turu. Demo, satış kaydetmek için D1'e bağlanmaz. |
| `register.html`, `login.html`, `setup.html`, `join.html`, `forgot-password.html` | Kayıt koşulları `/api/public-info` ile okunur. `functions/api/auth/` kayıt, giriş, çıkış ve oturum geçerliliğini yönetir. `/api/businesses` ilk işletmeyi kurar, `/api/join` daveti işler. |
| `app.html` → `assets/app.js` → `assets/views.js` | Oturum ve üyelik yüklenince URL'deki bölüm açılır. Navigasyon 16 işletme görünümüne ulaşır. Rolü yetersiz kullanıcı Genel Bakış'a yönlendirilir. |
| `functions/api/workspace/[businessId]/[section].js` | Her okuma ve yazma işlemi için rol listesi burada belirlenir. `workspace.js` oturumu ve işletme üyeliğini doğrular. Stok, alış, satış, tahsilat, görevler ve raporlar burada ilgili işleyiciye gider. |
| `migrations/0001_auth.sql`, `migrations/0002_workspace.sql` | Kullanıcı, oturum ve işletme üyelikleri ilk şemadadır. Sipariş satırları, ürünler ve stok hareketleri işletme anahtarını paylaşır. Stok ve iptal tetikleyicileri hareketleri işler. İşlem kimlikleri tekrar gelen yazma isteklerini ayırt eder. |
| `functions/_lib/ai.js`, `assets/forms.js` | Canlı sağlayıcı sunucu ayarına bağlıdır. Test modu yerel veya önizleme ortamına özeldir. Taslak, kullanıcı ve işletmeye bağlıdır. Ayrı onay isteğinde geçerlilik, bekleyen durum ve yetki denetlenir. |
| `_routes.json`, `_headers`, `scripts/build.mjs` | Pages statik dosyaları `dist` içinden sunar. Sadece `/api/*` isteklerini Functions karşılar. Betikler aynı kaynaktan yüklenir. Cloudflare proje ayarında üretim dalı `main`, diğer dallar için önizleme etkin ve önizlemenin `DB` bağı ayrıdır. |

Abonelik tahsilatı, yetkili GİB belge üretimi ve kasaya özel donanım sürücüleri ürün kapsamı dışında. Mevcut kasa aktarımı anahtarlı API ve CSV kullanıyor. Belgeler modülü fatura takibi sağlıyor. Bu sürüm D1 şema değişikliği gerektirmiyor.

## Görsel kararlar

Lusion v3'ün tek bir nesneyi net siluet ve stüdyo ışığıyla odakta tutması, metal çekirdeğin sanat yönetimine yön verdi. Catalyze AI'da başlık ile ürün görselinin ayrı alanlarda okunması, OLVEX'in tanıtımından çalışan demoya geçiş için örnek oldu. Çekirdek ve ürün görüntüleri OLVEX için üretildi. [Lusion v3](https://www.awwwards.com/sites/lusion-v3) · [Catalyze AI](https://www.awwwards.com/sites/catalyze-ai-saas-website)

3D kılavuzunun PDF dosyası eklerde bulunmuyordu. Uygulamada görev metnindeki geometri, malzeme, stüdyo aydınlatması ve kaydırma yönlendirmesi esas alındı. Sahne isteğe bağlı açılır. İşletme panelinin günlük akışları iki boyutludur.

## Değişikliklerin dosya haritası

| Dosyalar | Amaç |
| --- | --- |
| `index.html`, `assets/landing.css`, `assets/landing.js` | Mobil menü, kaydırılabilir tanıtım, klavye ile gezilen ürün turu, kayıt durumu, planlar ve bağlantılar. |
| `assets/product-overview.webp`, `assets/product-products.webp`, `assets/product-sales.webp` | Örnek işletmenin çalışan ekranlarından alınan ve ilgili sekmede yüklenen görüntüler. |
| `scene/core.js`, `assets/core.js`, `assets/core.webp`, `assets/core-small.webp` | Geometri, malzemeler, çevresel yansımalar, kamera, isteğe bağlı WebGL2, kaynak temizliği ve aynı modelden alınan sabit görseller. |
| `assets/tokens.css`, `assets/fonts/inter-tr.woff2`, `favicon.ico` | Ortak renk, yazı, yüzey, odak ve hareket değerleri. Inter'in mevcut OFL lisanslı yazı tipinden Türkçe karakterler ve lira işareti için 3.276 baytlık alt küme. |
| `app.html`, `demo.html`, `assets/app.css`, `assets/app.js`, `assets/navigation.js`, `assets/demo.js` | Ortak mobil menü, yetkiye göre bölüm araması ve salt okunur demoda kayıt ayrıntıları. |
| `assets/sales-chart.js`, `assets/views.js`, `assets/orders.js` | Satış grafiği için veri tablosu, AI soru önerisi, tahsilat, ödeme ve iptal için kayda özel onay özeti. |
| `login.html`, `register.html`, `setup.html`, `join.html`, `forgot-password.html`, `terms.html`, `privacy.html`, `contact.html`, `assets/public.css`, `assets/login.js`, `assets/register.js` | Hesap, kurulum, davet, parola ve yasal bilgi ekranlarında ortak tipografi, form ve doğrulama durumu stilleri. |
| `scripts/build.mjs`, `package.json`, `package-lock.json`, `tests/local.mjs` | Üretim paketine aynı kökenden isteğe bağlı Three.js modülünü dahil eden derleme, sabit bağımlılık sürümleri ve yerel Pages testi. |
| `tests/api.test.mjs`, `tests/browser.mjs`, `tests/landing.mjs` | AI taslağı ve yetki değişimi, modül erişimi, parasal işlemler, mobil arayüz, ürün turu ve WebGL yaşam döngüsü regresyonları. |
| `docs/INCELEME.md`, [docs/qa/experience](qa/experience/) | İnceleme kaydı, ekran görüntüleri ve her Lighthouse koşusunun sayısal sonuçları. |

## Doğrulama

- `npm ci` ve `npm run build` yeni bir çalışma dizininde çalıştırıldı.
- `npm test` yerel D1 ve Functions ile 22 testi geçti. Eski kayıtlar, işletmeler arası erişim, roller, oturum çerezi, stok, finans ve AI taslak onayı kontrol edildi. Yetkisi düşürülen yöneticinin bekleyen taslağı finans kaydı oluşturamadı.
- `OLVEX_WEBKIT=1 npm run test:browser` Chromium ve Linux WebKit ile çalıştırıldı. Dokuz genişlik 320, 360, 375, 390, 430, 768, 1024, 1440 ve 1920 CSS pikseliydi. Testler kayıt, giriş, çıkış, işletme kurulumu, korumalı rotalar, rol bazlı arama, 16 panel görünümü, hata sonrası yeniden deneme, boş veri, form ve grafik etkileşimi içeriyor. Mobil WebKit için ayrıca 440 × 956 dokunmatik profil kullanıldı.
- Chromium'da gerçek WebGL2 çizim çağrısı ve kaydırma sonrası yeniden çizim gözlendi. Sahne kapatılıp yeniden açıldı, bağlam kaybında sabit görsele dönüldü. JavaScript kapalı, WebGL2 kapalı ve azaltılmış hareket senaryoları ayrıca çalıştırıldı.
- axe-core 4.14.1 ile WCAG A/AA kuralları tarandı. Masaüstü ve mobil açılış, demo, giriş, kayıt, parola yenileme, gizlilik ve oturumlu Genel Bakış, Ürünler ve AI örneğinde otomatik ihlal raporlanmadı. Bu tarama klavye ve odak kontrolleriyle tamamlandı. VoiceOver/TalkBack denemesi ve tam WCAG uygunluk denetimi yapılmadı.
- `npm audit` taramasında bağımlılıklar için kayıtlı güvenlik bildirimi sayısı 0 idi. Kimlik doğrulama, Functions, CSP ve SQL şeması önceki sürümü kullanıyor.

## Performans

Aynı makinede yerel Cloudflare Pages, Chromium ve Lighthouse 13.6 mobil simülasyonu kullanıldı. Açılış için üç soğuk ziyaretin medyanı, demo için sürüm başına tek ölçüm veriliyor. [Koşu bazında ölçümler ve simülasyon ayarları](qa/experience/lighthouse.json)

| Sayfa ve sürüm | LCP | CLS | TBT | Aktarım | Performans | Erişilebilirlik |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Açılış · önce | 1,01 sn | 0 | 0 ms | 22.081 B | 100 | 98 |
| Açılış · aday | 1,61 sn | 0,001 | 53 ms | 90.851 B | 100 | 100 |
| Demo · önce | 2,16 sn | 0,063 | 0 ms | 183.414 B | 98 | 100 |
| Demo · aday | 0,97 sn | 0,003 | 158 ms | 101.886 B | 98 | 100 |

Açılış adayında performans puanı koşular arasında 96–100, TBT 0–201 ms arasında değişti. Yeni görsel ve yerel fontlar açılışa yaklaşık 69 KB ekledi. Telefonda küçük poster seçiliyor. Gerçek zamanlı sahne, kullanıcı açtığında 134.424 bayt sıkıştırılmış JavaScript indirdi. Tek bir masaüstü yazılım GPU ölçümünde düğme tıklamasından ilk çizimin gönderilmesine 370 ms, bunu izleyen iki animasyon karesine 1,41 sn geçti. Bu değerler fiziksel bir GPU'nun FPS ölçümü değildir. Saha INP, fiziksel iPhone Safari ve Android Chrome performansı ölçülmedi.

## İnceleme bağlantıları ve sınırlar

[Masaüstü önce](qa/experience/before-1440.webp) · [Masaüstü sonra](qa/experience/after-1440.webp) · [Mobil önce](qa/experience/before-390.webp) · [Mobil sonra](qa/experience/after-390.webp) · [Çekirdek katmanları](qa/experience/live-desktop.webp) · [İşletme paneli](qa/experience/workspace-desktop.webp) · [Mobil bölüm araması](qa/experience/module-search-webkit.webp)

Oturumlu iş akışları yalıtılmış yerel D1 verisiyle doğrulandı. Canlı AI sağlayıcısı, e-posta teslimatı, fiziksel kasa bağlantısı ve gerçek cihaz klavyesi bu doğrulama kapsamında çalıştırılmadı. Üretim için birleştirme ve yayımlama kararı ürün sahibine aittir.
