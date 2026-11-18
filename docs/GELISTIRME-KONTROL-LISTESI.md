# OLVEX — kontrollü geliştirme ve yayın kontrolü

Bu dosya, OLVEX'in mevcut test dalı üzerindeki çalışmalarını ve yayın öncesi açık işleri gösterir. Bu liste test sonucu yerine geçmez.

## Bu dalda hazırlananlar

- [x] Satış ve satın alma formlarında kayıtlı ürünü ada/SKU'ya göre arama ve seçme (assets/orders.js).
- [x] Seçilen ürün için SKU doldurma ve stok bilgisi; satışta kayıtlı fiyatı gösterme.
- [x] Satışta mevcut kayıtlı fiyat veya elle girilmiş fiyat üzerinden tahmini sepet toplamı. Gerçek kayıt tutarı yine sunucuda hesaplanır.
- [x] Mobil satış formuna özel düzenleme (assets/app.css).
- [x] OpenAI anahtarı bulunmadığında bile satış, stok ve tahsilat üzerine ücretsiz, kurallara dayalı analiz kartları (assets/views.js). Bu özellik generatif AI değildir.
- [x] Tarayıcı testi senaryoları genişletildi; Node regresyon testleri eklendi.
- [x] Cloudflare Pages preview build ve deploy başarıyla tamamlandı.
- [ ] npm test ve npm run test:browser tam çalıştırılmalı, hataları incelenmeli.
- [ ] Gerçek iPhone Safari, Android Chrome ve masaüstü ekran incelemesi yapılmalı.
- [ ] Kullanıcı onayı olmadan main dalına birleştirme yapılmayacak.

## Canlıya almadan önce senaryolar

1. Yalıtılmış ön izleme D1 üzerinde yeni işletme kur. Üretim veritabanını kullanma.
2. Ürün ekle; SKU, satış fiyatı, maliyet ve açılış stoğunun doğru kaydedildiğini doğrula.
3. Satış formunda ürün adını ara, seç ve miktarı değiştir. Tahmini toplamı doğrula.
4. Satışı kaydet; stok azalışını, satış kaydını, finans ve rapor etkisini kontrol et.
5. Yetersiz stokta satışın atomik olarak reddedildiğini doğrula.
6. Satışı iptal et; stok ve nakit akışı etkisini kontrol et.
7. Satın alma yap; ürün maliyeti/satın alma fiyatı ayrımını ve stok artışını kontrol et.
8. Müşteri, faturalar (yalnızca belge takibi), personel, görev ve rapor ekranlarını mobilde incele.
9. AI sayfasını OpenAI kapalıyken ve ayrı güvenli test ortamında mock modda kontrol et. Gerçek API anahtarlarını tarayıcıya koyma.
10. GitHub Actions veya Codespaces ortamında testleri çalıştır; görsel ekran görüntülerini kontrol et.

## Bilinen sınırlamalar

- Gerçek kasa entegrasyonu: OLVEX'te bir HTTP API ve CSV aktarımı vardır; herhangi bir fiziksel POS'a otomatik bağlantı sağlandığı varsayılmamalı.
- Resmî e-Fatura/e-Arşiv: Mevcut faturalar modülü belge takibidir, GİB belgesi kesmez.
- OLVEX AI: Canlı sohbet için sunucuda OPENAI_API_KEY ve uygun model gerekir; kullanım ücretli olabilir. Ücretsiz analiz kartları gerçek işletme verilerinden kural tabanlı oluşturulur.
- Grafik tasarımı: Kullanıcının isteğiyle en sona bırakıldı. Önceki canlı sitede grafiğin görünmemesi sorunu ayrıca incelenecek. İncelemede .chart varlığı doğrulandı; .chart svg kontrolü ve görsel regresyon testi hâlâ açık.
- Kayıt ve yasal metinler: Genel üye kaydını açmadan önce gerçek işletmeci/iletişim ve tebligat bilgileri ile KVKK şartları doğrulanmalı.
- Fonlama/yatırım: OLVEX lansman hazırlıklarının sonunda, kullanıcı isterse ayrıca değerlendirilecek.

## Yayın güvenliği

- Yalnızca kullanıcı açıkça istediğinde main dalına alınır.
- Önce veritabanı yedeği ve geri dönüş planı hazırlanır.
- Testlerin çalıştırılmamış olması, derleme başarılı olsa bile, hatasız veya tamamlandı denmesine izin vermez.
