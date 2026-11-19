# Hukuki metinler ve tarayıcı depolaması

Ticaret Bakanlığının 2 Nisan 2026 tarihli mevzuat dizini 6502 sayılı Kanunu, Mesafeli Sözleşmeler Yönetmeliğini ve Abonelik Sözleşmeleri Yönetmeliğini birlikte listeliyor. Tüketiciye yönelik mesafeli hizmetlerde ön bilgilendirme, cayma ve istisnalar satın alma akışına göre değerlendirilir. OLVEX'in işletme odaklı olması tek başına her alıcının hukuki statüsünü belirlemez. [Mevzuat dizini](https://ticaret.gov.tr/tuketici/mevzuat/6502-sayili-tuketicinin-korunmasi-mevzuati) · [Bakanlığın mesafeli sözleşme rehberi](https://tuketici.ticaret.gov.tr/yayinlar/tuketici-bilgi-rehberi/mesafeli-sozlesmeler-hakkinda-bilgilendirme)

KVKK aydınlatmasında veri sorumlusu, amaç, hukuki sebep, toplama yöntemi, alıcılar ve başvuru hakları belirtilir. Yurt dışı aktarımı için 6698 sayılı Kanunun 9. maddesindeki koşullar kullanılan sağlayıcı ve işleme göre doğrulanmalıdır. KVKK'nın resmî rehber sayfası bu çalışma ortamından yanıt vermedi. [6698 sayılı Kanun](https://www.mevzuat.gov.tr/mevzuatmetin/1.5.6698.pdf) · [KVKK Kurumu](https://www.kvkk.gov.tr/)

## Yayın öncesi doğrulamalar

1. İşletmeci, tebligat ve başvuru kanallarını Pages üretim yapılandırmasından kontrol edin. Kullanım şartlarının sürümlenmesini ve veri sorumlusu başvuru yöntemlerini hukuk uzmanıyla gözden geçirin. Bulut, posta ve AI sağlayıcılarının saklama ve aktarım koşullarını yazılı olarak doğrulayın.
2. Ücretli satış açılmadan önce işlemin B2B veya tüketici niteliğini, sağlayıcıya özgü zorunlu bilgileri, vergi dahil bedeli, ifa, cayma, yenileme, fesih ve iade koşullarını onaylayın. Alıcının gördüğü ön bilgilendirme ve sözleşme sürümlerini siparişle ilişkilendirin ve kalıcı veri saklayıcısıyla iletin. Sipariş onayı ödeme yükümlülüğünü açıkça göstermeli. [iyzico altyapısı](IYZICO-ABONELIK.md)
3. Uygulama çerezleri ve Web Storage anahtarları çerez politikasında listelenir. Depoda üçüncü taraf tarayıcı betiği görülmedi. CDN güvenlik çerezleri duruma göre oluşturulabileceğinden Cloudflare bölge ayarları ve güvenlik kontrolleri yayın ortamında ayrıca doğrulanmalı. Reklam veya analitik eklenirse kategori, süre ve betik etkinleşme koşulları devreye almadan önce belgelenmeli.

Kasa anahtarı, kullanıcıya üreticinin bağlı olduğunu göstermez. Kasa markası veya yazılım API'sine erişim, yetkili bir bağlayıcıyla ayrı bir işletmede denenmelidir. Üretim stoklarını etkileyen bir test düğmesi eklenmedi.
