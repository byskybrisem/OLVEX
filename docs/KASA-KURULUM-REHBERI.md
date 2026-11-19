# OLVEX — Kasa ve satış yazılımı seçim rehberi

## Amaç
Kasa Bağlantıları sayfasında müşterinin önce **kasa türünü**, sonra varsa **cihaz markasını/modelini**, ardından **satış yazılımını** seçmesi ve sonucunda hangi teknik bilgilerin gerekli olduğunu anlaması. Bu rehber tek başına cihazı OLVEX'e bağlamaz ve otomatik satış veya mali fiş oluşturmaz.

## İlk desteklenen rehber profilleri
- **Yeni nesil yazarkasa POS (YN ÖKC)**: Beko/Token, Worldline/Ingenico, Profilo/Propay, Hugin, Paygo, diğer/bilinmiyor. Marka seçimi, resmi belgelerden doğrulanmış tam bir cihaz/API uyumluluk listesi değildir.
- **Satış yazılımı**: AKINSOFT WOLVOX Hızlı Satış, WOLVOX Restoran, diğer WOLVOX; diğer yazılım; kasanın kendi programı; bilinmiyor.
- **Bilgisayarlı barkodlu kasa** veya başka/emin değilim seçenekleri.

## YN ÖKC + AKINSOFT
1. Cihazın modelini, kurulu WOLVOX sürümünü ve ilgili şubeyi belirleyin.
2. AKINSOFT bayiniz/servisiniz ile **cihaz → WOLVOX** bağlantısının GMP-3 ve cihaz üreticisi kısıtlarına uygunluğunu doğrulayın. Bu **OLVEX** bağlantısı değildir.
3. AKINSOFT destek ekibinden WOLVOX satışlarını güvenli ve izinli olarak dışa aktarmak veya belgelenmiş API ile okumak mümkün mü öğrenin. Yalnızca yazılımın yazarkasa ile entegre çalışması OLVEX'e veri aktarabileceği anlamına gelmez.
4. Fiş bazında benzersiz referans, tarih, ürün SKU, miktar, fiyat ve iade/iptal verileri gerekiyorsa doğru biçimi talep edin. Aynı fişin iki kasada benzer numaralarla üretilebileceğini hesaba katın.
5. Onaylanan veri erişimi varsa sunucu tarafı bağlayıcı **POST /api/pos** çağırabilir. Değilse CSV şablonuna dönüştürüp manuel içe aktarım kullanın. Örnek: `assets/olvex-kasa-ornek.csv`.

## YN ÖKC, AKINSOFT olmadan
1. Cihazın marka, model, fiş/jurnal kayıt erişimi ve yazılım bilgilerini servis/üretici ile kontrol edin.
2. Üreticinin izinli API veya satışları dışa aktarma desteğini doğrulayın; olmayabilir.
3. Varsa veriyi OLVEX CSV şablonuna dönüştürün veya onaylanmış bağlayıcı kurun. Yoksa OLVEX manuel satış özelliği kullanılabilir.

## API anahtarı
- Sadece doğrulanmış bağlayıcı veya teknik ekip varsa oluşturun.
- Anahtarı tarayıcı JavaScript'inde, cihazın herkese açık ekranlarında veya destekte paylaşmayın; sunucu tarafı gizli ayara yazın.
- **Tek başına API anahtarı satışları otomatik aktarmaya başlamaz.** Bağlayıcı, fiziksel/kurulu yazılımı ve kaynak kayıtları okumak zorundadır.
- OLVEX'te kaynak kasa/şube ayrı tanımlanır. Satış, iade/iptal ve idempotent fiş kimlikleri korunur.
- `0011_pos_connection_details.sql` üretim ortamına uygulanmadığı sürece ayrıntılı marka ve sürüm sütunları kaydedilemez. Rehber üzerinden açılan kasa oluşturma akışı bu bilgiyi **bağlantı adında özetler**, ayrı sütunlara yazmaz. Mevcut altyapının eski şemayla uyumlu kullanımını sürdürmek için bilinçli tercih edilmiştir. Üretim migrasyonunu açık onay olmadan çalıştırmayın.

## Resmî kaynaklar
- GİB Yeni Nesil ÖKC SSS: https://ynokc.gib.gov.tr/Home/SSS
- AKINSOFT WOLVOX Yazarkasa Otomasyonu: https://www.akinsoft.com.tr/programlar/detay/wolvox-yazarkasa-otomasyonu--wyz9
- AKINSOFT Worldline entegrasyonu: https://www.akinsoft.com.tr/okc-entegrasyonu/worldline
- AKINSOFT Profilo entegrasyonu: https://www.akinsoft.com.tr/okc-entegrasyonu/profilo

## Kabul kriterleri
- Kasa → yazılım seçiminde YN ÖKC markası zorunlu, diğer türlerde gereksizse gizli.
- YN ÖKC + WOLVOX kombinasyonu ilgili servis, GMP-3, izinli kaynak erişimi ve OLVEX bağlayıcısı farkını doğru anlatsın.
- Başka marka/program seçiminde yanlış uyumluluk sözü verilmesin.
- Rehberde CSV ve API yolları gösterilsin; gerçek bağlantı yalnızca ayrıca konfigüre edilen aktarım sayesinde mümkün olsun.
- İleri düzey API anahtarı oluşturma çalışmaya devam etsin; şube/fiş/şirket izolasyonu ve önceki kayıtlar etkilenmesin.
- iPhone Safari ve masaüstü tarayıcıda rehber okunabilsin.
