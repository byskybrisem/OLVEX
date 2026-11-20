# OLVEX hukuki lansman kontrolü

Kullanım şartları, KVKK ve gizlilik metni, çerez politikası, ön bilgilendirme, mesafeli hizmet sözleşmesi ve abonelik koşulları uzman incelemesi için taslaktır.

## Yayın yapılandırması

| Ayar | Doğrulanacak bilgi |
| --- | --- |
| OLVEX_OPERATOR_NAME | Gerçek kişi adı soyadı veya sicildeki eksiksiz şirket unvanı |
| OLVEX_OPERATOR_KIND | Gerçek kişi için person, tüzel kişi için company |
| OLVEX_SERVICE_ADDRESS | Kullanılabilir tebligat adresi, varsa doğrulanmış posta kodu |
| OLVEX_CONTACT_EMAIL ve OLVEX_CONTACT_PHONE | İzlenen destek adresi ve uluslararası biçimde telefon |
| OLVEX_KVKK_EMAIL | İzlenen KVKK başvuru iletişimi. Bu alan tek başına bir adresi KEP yapmaz. |
| OLVEX_COMPANY_TAX_OFFICE, OLVEX_COMPANY_TAX_ID, OLVEX_TRADE_REGISTRY | Şirket için doğrulanmış vergi dairesi, 10 haneli şirket vergi numarası ve sicil bilgisi |
| OLVEX_PAID_LEGAL_REVIEW | Uzman incelemesi ve gerçek yayın onayı tamamlanınca approved |

Eksik veya biçimi hatalı alanlar canlı iyzico checkout başlatmayı engeller. Mevcut aboneliğin durumu, yenileme bildirimi ve iptal işlemleri kendi kontrolleriyle çalışmaya devam eder. Önizleme için ayrı D1 ve sağlayıcı sandbox’ı kullanın. Gerçek kişi için kimlik numarası veya kişisel vergi tanımlayıcısını bu alanlara koymayın. Gerektiğinde MERSİS, KEP, meslek kuralları ve gösterilecek ek kimlik alanlarını uzmanla belirleyin. Yapılandırma denetimi alanların varlığını ve biçimini kontrol eder. Bilginin gerçekliğini işletmeci doğrular.

## Hukuk ve muhasebe incelemesi

- Önce işlemin B2B veya tüketici işlemi niteliğini belirleyin. Ücret ve vergiler, ödeme yükümlülüğü, yenileme periyodu ve tutarı, fesih, cayma, istisnalar, iade ve uyuşmazlık yollarını işleme özel onaydan önce doğrulayın. Saklanabilir sözleşme ve ön bilgilendirmenin alıcıya iletilmesini, fatura düzenlenmesini ve gerçek iyzico yenileme/iptal akışını sınayın.
- KVKK bakımından veri sorumlusu ve işleyen rollerini, her veri kategorisinin dayanağını ve saklama süresini, yurt dışı aktarım mekanizmasını, sağlayıcı sözleşmelerini, yedekleri ve imha/anonimleştirme yöntemini onaylayın. Kullanıcı sözleşmesi kabulü ile aydınlatma ve isteğe bağlı çerez tercihini ayrı tutun.
- Hesap kapatmada kişisel oturum ve işletme sahipliği farklı sonuçlar doğurur. Üyelikler, ekip erişimi, açık abonelik, POS anahtarları, bekleyen ödeme/iade, mali belgeler, denetim kayıtları ve yedekler için hukuk ve muhasebe kararı alın. Saklanması gereken mali kayıtları ayırın. [6698 sayılı Kanun](https://www.mevzuat.gov.tr/mevzuatmetin/1.5.6698.pdf) · [6502 sayılı Kanun](https://www.mevzuat.gov.tr/mevzuatmetin/1.5.6502.pdf)

## Talebi işleme

1. Oturum açan kullanıcı talep türünü seçer ve takip referansı alır. Hesap kapatma ayrıca onaylanır. Hesaba erişemeyenler için iletişim sayfasındaki doğrulanmış kanalları açık tutun.
2. Yetkili operatör OLVEX Control içindeki Hesap ve veri talepleri kuyruğunu düzenli takip eder. Başvurunun alındığı tarihi korur, gerekli kimlik ve işletme temsil yetkisini güvenli kanaldan doğrular ve mevzuata uygun yanıt sürelerini izler. Parola, kimlik belgesi ve ekler bu formda toplanmaz.
3. Talep kapsamını, erişimi veya kapanışı ve varsa istisna gerekçesini inceleyip güvenli yöntemle yanıtlayın. Hesap/abonelik üzerinde işlem gerekiyorsa ayrı onaylı süreçten ilerleyin. Ardından panelde Yanıtı kaydet seçeneğini kullanın. İşlem, yanıtın kaydedildiği tarih ve operatörü izler.
4. Dağıtımdan önce 0015_account_rights_requests.sql migrasyonunu izole D1’de doğrulayın. Üretim uygulamasından önce yedek ve operatör incelemesi gerekir.
