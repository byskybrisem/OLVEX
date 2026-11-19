# OLVEX PR #6 doğrulama raporu

19 Kasım 2026. İnceleme `d207035` değişikliklerinden başladı. PR dalına gelen `8438104` ve ana dalın `63be88b` sürümü değerlendirmeye alındı. Test verileri yerel ve sentetiktir.

## 1. Bulunan hatalar

- Manuel satış ve alış ekranlarında şube seçimi yoktu. Ürün seçicisi işletmenin toplamını gösteriyordu. Birden çok şubeli işletmede şubesiz istek varsayılan şubeyi kullanabiliyordu.
- Transferin iki stok hareketini üreten D1 altyapısı vardı. Kullanıcının transferi oluşturacağı, tarih ve açıklama gireceği ve geçmişi göreceği API ile ekran eksikti.
- AI stok düzeltmesi için işletme toplamını denetliyor ve onay sırasında varsayılan şubeye yazıyordu. Hedef şube taslağın parçası değildi.
- Kritik stok denetimi işletme toplamına bakıyordu. Başka şubedeki yüksek bakiye, stoku sıfır olan şubeyi gizleyebiliyordu.
- Bütün kalemleri iade edilmiş ödenmemiş bir satış, sıfır tutarlı tahsilata hâlâ açıktı.
- POS uç noktasında başarısız anahtar denemeleri ve kasa trafiği için uygulama düzeyinde sınır yoktu. Manuel kayıtta hatalı ödeme alanı sessizce tahsil edilmemiş satış olarak yorumlanabiliyordu.

## 2. Düzeltilen hatalar

Manuel işlem, ürün kataloğu ve stok yazımı aynı işletme ve şube bağlamını kullanıyor. Yeni şubesiz istek çok şubeli işletmede reddediliyor. Tek şubeli eski istemcinin daha önce kaydettiği satış, ikinci şube açıldıktan sonra aynı içerikle tekrarlanabiliyor. İade ve iptal özgün satışın şubesini kullanıyor.

AI stok taslağı için kullanıcı açıkça şube seçiyor. Onayda işletme, şube, ürün, miktar farkı ve işlem gösteriliyor. Sunucu hedefi kayıtlı taslaktan alıyor ve işlem sırasında güncel işletme rolünü doğruluyor. Şube bilgisi olmayan eski taslak kapatılıp yeniden oluşturulabiliyor. Tamamı iade edilmiş ödenmemiş satış tahsilata kapalı kalıyor.

## 3. Değiştirilen dosyalar

| Alan | İlk PR sürümü üzerine yapılan revizyon |
| --- | --- |
| Şube, stok, AI ve raporlama | `functions/_lib/branches.js`, `inventory.js`, `register.js`, `ai.js`, `reports.js` |
| API ve sınırlar | `functions/api/workspace/[businessId]/[section].js`, `functions/api/pos.js`, `functions/api/auth/rate-limit.js` |
| Şema | `migrations/0007_transfer_history.sql` |
| Arayüz | `assets/orders.js`, `forms.js`, `views.js`, `app.js`, `dashboard.js`, `demo.js` |
| Test ve komutlar | `tests/api.test.mjs`, `branch-transactions.test.mjs`, `security.test.mjs`, `stock.test.mjs`, `ux.test.mjs`, `browser.mjs`, `browser-branches.mjs`, `local.mjs`, `package.json` |
| İşletim belgeleri | `README.md`, `docs/D1-GECIS-VE-GERI-DONUS.md`, bu rapor |

## 4. Yeni özellikler

**Transfer.** Ürünler ve Stok ekranındaki transfer formu çıkış şubesini, giriş şubesini, ürünü, adedi, tarihi ve açıklamayı alır. Aktör oturumdan belirlenir. D1 transfer başlığını ve her iki stok hareketini birlikte işler. Aynı istek kimliği tekrar kullanılırsa mevcut kayıt döner. Tarih, iki şube, ürün ve kullanıcı geçmişten izlenebilir.

**Şube uyarıları.** Dashboard özetine ve AI işletme özetine şube bakiyesi, işletme toplamı ve eşik ayrı alanlarla gelir. Ayrıntılı uyarı ekranı aranabilir ve sayfalanabilir. Şubede ilk stok hareketi henüz yoksa bakiye sıfır kabul edilir.

## 5. Çalıştırılan komutlar

Bağımlılık kilidi temiz bir dizinde `npm ci` ile kuruldu. Uygulama için `npm run build`, `npm test`, tarayıcı senaryoları için `npm run test:browser` ve `npm run test:browser:branches` kullanıldı. Paket denetimi `npm audit --json` ile yapıldı. Geliştirme sırasında ayrıca aşağıdaki odaklı koşular çalıştırıldı.

```sh
node --test tests/security.test.mjs
node --test tests/branch-transactions.test.mjs
node --test tests/stock.test.mjs
node --test tests/ux.test.mjs
```

## 6. Başarılı testler

Son tam koşuda **43 test geçti, 0 hata ve 0 atlama** kaydedildi. Test paketi 582 saniye sürdü. Satış yükü, aktarım ve yetki kontrolleri yerel Pages uç noktaları ile yalıtılmış D1 veritabanlarını kullandı. 10.000 deterministik stok işlemi de güncel şemada doğrulandı.

| Senaryo | Doğrulanan sonuç |
| --- | --- |
| Manuel satış, alış ve iptal | Merkez 100 ve Sahil 50 iken Sahil’de üç kola satıldı. Merkez 100, Sahil 47 kaldı. İptal Sahil’i 50’ye geri getirdi. |
| Şubeler arası transfer | 100/20 açılıştan 30 adet transfer sonucu 70/50 oldu. Toplam 120 kaldı. Aynı isteğin eşzamanlı tekrarı yalnızca −30 ve +30 hareketi üretti. |
| Eşzamanlı yazımlar | Manuel satış ile POS satışı, satış ile transfer ve iki transfer aynı şube bakiyesi üzerinde sınandı. Stok her başarılı işlem kadar değişti, yetersiz stokta işlem geri alındı. |
| POS ve finans | İki şube, beş kasa, 1.000 satış ve 1.000 tekrar. Aynı numaralı fişler farklı kasalarda ayrı işlendi. 100 kısmi iade, 50 iptal ve tekrarlarından sonra 28.750,00 TL brüt, 2.687,50 TL geri ödeme, **26.062,50 TL net** elde edildi. Son A/B stokları Merkez 920/430, Sahil 480/420. |
| Bağlantı kesintisi | Yerel aracı sunucu ilk başarılı yanıtı istemciye ulaşmadan kesti. Aynı fişle yeniden deneme tek stok hareketi ve tek tahsilat bıraktı. API/CSV tekrarı, eski CSV eşleştirmesi ve kasa anahtarı yenilemesi de sınandı. |
| İade ve tahsilat | Kısmi iade sonrası iptal yalnızca kalanı tersine çevirdi. Tamamı iade edilen ödenmemiş satışta tahsilat isteği 409 döndürdü, ödeme kaydı oluşmadı. |
| AI onayı | Şubesiz ve şubesi değiştirilmiş onaylar, başka işletmenin şubesi ve yetkisi geri alınmış kişi stok yazamadı. Geçerli onayın tekrarı ikinci hareket oluşturmadı. |
| Kritik stok | Merkez 500, Sahil 0 ve eşik 10 iken Sahil uyarı listesindeydi. Sahil 10 olduğunda uyarı sürdü, 11 olduğunda kalktı. |
| Migrasyon ve geçmiş | 0001–0007 boş D1’e kuruldu. Yedi migrasyonun ikinci uygulaması kayıtları değiştirmedi. Dolu 0002 sürümünün SQL yedeği ayrı bir D1’e geri yüklendi. Eski ve yükseltilmiş verilerde kullanıcı/oturum/üyelik, kasa, iki fiş, iki kalem, dört stok hareketi ve üç işlem kaydı karşılaştırıldı. Stok 18 adet, net tahsilat 25,00 TL kaldı. Yabancı anahtar ihlali 0. 0003 SQL dosyasının elle tekrar uygulanması kontrollü hata verdi, karşılaştırılan değerler korundu. |

**Tarayıcılar.** Genel regresyon kayıt/giriş, satış, CSV, AI onayı, rapor, kasa ve oturum kapatma akışlarını geçti. Şube ve transfer testi aşağıdaki altı profilin her birinde aynı 100/47, 100/50, 100/54 ve 70/50 bakiyelerini doğruladı. Formların ekran sınırlarına sığması da ölçüldü.

| Profil | Çalıştırılan tarayıcı veya motor | Genişlik |
| --- | --- | ---: |
| Masaüstü Chrome | Google Chrome 158.0.8127.36 | 1280 px |
| Android Chrome | Aynı Chrome, Pixel 7 emülasyonu | 412 px |
| Masaüstü Edge | Microsoft Edge 157.0.4341.60 | 1280 px |
| Masaüstü Firefox | Playwright Firefox 153.0 | 1280 px |
| Masaüstü Safari kapsamı | Linux üzerinde Playwright WebKit 26.5 | 1280 px |
| iPhone Safari kapsamı | Aynı WebKit, iPhone 13 emülasyonu | 390 px |

Altı profili tekrar çalıştırmak için Chrome ve Edge kurulu olmalı ya da yürütülebilir dosyalar `CHROME_PATH` ve `EDGE_PATH` ile verilmelidir. Playwright Firefox, WebKit ve bunların sistem kütüphaneleri de gerekir.

```sh
OLVEX_BROWSER_PROFILES=chrome,android,edge,firefox,webkit,iphone npm run test:browser:branches
```

## 7. Başarısız testler ve yeniden koşular

İlk paralel transfer koşusunda yerel Pages hazırlık süresini aştı. Test altyapısının bekleme süresi düzeltildi. Bir ilk migrasyon koşusunda eksik fixture sorgu sabitleri, eski veri kurulumu sırasında da Wrangler zaman aşımı görüldü. Ana daldan gelen build artık `sitemap.xml` beklediği için bu dosya geçici Pages kopyasına eklendi. Bu ilk koşular başarı sayımına dahil edilmedi.

WebKit ilk açılışta eksik Linux kütüphanesi nedeniyle başlamadı. Kütüphaneler hazırlandıktan sonraki bir koşuda arayüzün hazır olmasını bekleyen adım zaman aşımına uğradı. Son altı-profil koşusunda ve genel tarayıcı regresyonunda bütün senaryolar tamamlandı. Son test paketinde açık başarısızlık kalmadı.

## 8. Güvenlik bulguları

| Denetim | Sonuç |
| --- | --- |
| Kimlik ve oturum | Parola özetleri ve eski oturumlar geçiş testinde doğrulandı. Uygulama oturum belirtecini `HttpOnly; Secure; SameSite=Lax` çerezinde taşır. Süre dolumu, parola sıfırlama ve çıkış akışları mevcut denetimleri kullanır. |
| Yetki ve nesne erişimi | İşletme üyeliği sunucuda doğrulanır. Sahip ve yönetici transfer oluşturabilir. Üye geçmişi okuyabilir, doğrudan stok düzeltemez veya transfer oluşturamaz. Başka işletmeye ait ürün ve şube reddedilir. İnsan kullanıcıların yetki alanı işletme üyeliğidir. POS anahtarı tek fiziksel kasa ve onun şubesiyle sınırlıdır. |
| CSRF, SQL ve HTML | Çerezle yazılan isteklerde Origin denetlenir. Yeni sorgularda kullanıcı değerleri parametre olarak bağlanır. Yeni arayüz alanları metin düğümleri veya HTML kaçış işlevi kullanır. Stok ve ürün adlarının güvenli gösterimi regresyonda sınandı. |
| POS anahtarları ve istek sınırları | Anahtarlar özet olarak saklanır. POS liste yanıtında anahtar, anahtar özeti veya oturum bilgisi bulunmadığı kontrol edildi. Bir IP’den 60 saniyede 20 hatalı anahtar denemesi ve varsayılan olarak etkin kasa başına dakikada 6.000 istek sınırı vardır. Yetkili sınır ayarı `OLVEX_POS_REQUESTS_PER_MINUTE` ile yapılır. 429 sonrası aynı fiş yeni ödeme üretmez. |
| Girdi ve hata yanıtları | Geçersiz ödeme türü, işlem adı ve yol ile çelişen işletme kimliği reddedilir. Beklenmeyen sunucu hataları istemciye genel mesajla döner. OpenAI/Resend anahtarları sunucu bağlarında kullanılır. POS anahtarı yetkili yöneticinin oluşturma/yenileme ekranında bir kez gösterilir. |
| Tekrar, yarış ve bağımlılıklar | D1 UNIQUE anahtarları, işlem içerik özetleri, stok tetikleyicileri ve atomik batch doğrulandı. Kilit dosyasının npm denetiminde bildirilen güvenlik açığı sayısı 0 oldu. |

## 9. Migrasyon ve veri kaybı riskleri

0007 eski transferlere tarih ve açıklama desteği ekler. Eski transferlerde geçmiş ekranı kayıt zamanını kullanır. Geçmişte hangi şubeden geldiği kaydedilmemiş stoklar ilgili işletmenin Merkez şubesine taşınır. Eski POS bağlantıları uzlaştırma modunda açılır. Kaynak kimliklerinin doğrulanması ve eski CSV fişlerinin doğru kasayla eşlenmesi saha bilgisini gerektirir. Yedek geri yüklendiğinde kesim sonrası yazımların kaybolma riski vardır. [D1 geçiş ve geri dönüş prosedürü](D1-GECIS-VE-GERI-DONUS.md)

## 10. Kalan eksikler ve doğrulama sınırları

Testler yerel Pages Functions ve D1 üzerinde yürütüldü. Canlı D1 kapasitesi ve gecikmesi, gerçek kasa üreticisinin ID garantisi, fiziksel cihaz bağlantısı, canlı e-posta ve ücretli AI servisi bu çalışmada ölçülmedi. AI senaryolarında model yanıtı yerel test modundaydı. Taslak, yetki, stok, onay ve ödeme akışları gerçek yerel veritabanında çalıştı. Apple Safari ve Android için cihaz ile motor/emülasyon ayrımı bölüm 6’da belirtilmiştir.

## 11. Birleştirme değerlendirmesi

**PR #6, teknik inceleme ve kullanıcının birleştirme onayına hazır.** Son kodda derleme, otomatik testler ve tarayıcı senaryoları geçti. Üretimde yazma ve fiziksel kasa doğrulaması operasyon onayına tabidir.

## 12. Üretim öncesi manuel işler

1. Operatör hedef D1 kimliğini ve Pages bağını doğrular. Önizlemede aynı migrasyon zincirini dener ve kullanacağı gerçek kasanın benzersiz fiş kimliğini örneklerle doğrular.
2. Bakım penceresinde yazımlar duraklatılır. SQL yedeği doğrulanır, bağımsız geri yükleme provası ve Time Travel geri dönüş noktası kaydedilir.
3. Onaylanan sürümün migrasyonları uygulanır. Veriler, yabancı anahtarlar, defter ve bakiyeler karşılaştırılır. Ardından eşleşen uygulama sürümü açılır.
4. Operatör kayıt/giriş, iki şube arasında bir satış, transfer ve kasa tekrarını kontrol eder. Bekleyen fişler özgün kasa/işlem kimlikleriyle aktarılır. Fark halinde yazımlar kapalı tutulup belgelenmiş geri dönüş uygulanır.
