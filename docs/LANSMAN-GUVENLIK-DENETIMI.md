# OLVEX lansman güvenlik denetimi

Başlangıç sürümü `01c1ac1` ve PR #26 sonrası erişim kuralları. Kontroller sentetik kayıtlarla yerel Pages ve D1 üzerinde yürütülür. Üretim yapılandırması işletmeci tarafından ayrıca doğrulanır.

## Bulgular ve kontroller

| Öncelik | Alan | Sonuç |
| --- | --- | --- |
| Yüksek | Super Admin oturumu | Yönetici API’si artık oturumun bir saatten genç olmasını zorunlu tutar. Yeni yönetici oturumları en fazla bir saat sürer. Mevcut müşteri oturum süreleri korunur. |
| Yüksek | D1 geri yükleme | Yerel SQL dışa aktarımı, bağımlı tabloların yükleme sırası nedeniyle boş hedefe doğrudan aktarılamadı. Hazırlık betiği tablo ve indeksleri veriden önce, tetikleyicileri veriden sonra yükler. |
| Orta | Giriş deneme sınırı | IP ve IP/e-posta sınırına ek olarak normalize e-posta başına 15 dakikada 20 deneme uygulanır. Dağıtık denemeleri sınırlar. Bir hesabın geçici olarak giriş yapamaması mümkündür. Üretim izlemesinde 429 artışını takip edin. |
| Kontrol | Oturum, kurtarma ve CSRF | Token özetleri D1’de, oturum çerezi HttpOnly/Secure/SameSite=Lax olarak tutulur. Parola sıfırlama tek kullanımlıktır ve önceki oturumları kapatır. Cookie ile yetkilendirilen POST istekleri aynı kökeni gerektirir. Kasa ve sağlayıcı istekleri kendi anahtar/imza kontrollerini kullanır. |
| Kontrol | İzolasyon ve abonelik | Workspace üyeliği ve rolü sunucuda denetlenir. İncelenen dinamik sorgularda kullanıcı girdileri parametre olarak bağlanır. Yazımların ücretli abonelik koşulu D1 işleminde tekrar denetlenir. Yönetici kimliği normal işletme erişimini otomatik olarak açmaz. |
| Kontrol | XSS | İncelenen yönetici ve sohbet görünümleri kullanıcı kaynaklı metinleri kaçışlayarak işler. Statik sayfalarda CSP ve API yanıtlarında önbellek yasağı var. iyzico HTML içeriği uygulama DOM’una eklenmemeli. |

## Cloudflare Access ve MFA

1. Önce izole önizlemede bir self-hosted Access uygulaması hazırlayın. `/admin`, `/admin.html` ve `/api/admin/*` yollarını birlikte kapsayın. Yönetici API’sindeki OLVEX kimlik ve oturum denetimini koruyun. Müşteri oturumu, POS ve ödeme callback/webhook yollarını bu yönetici politikası kapsamına eklemeyin.
2. Yalnızca atanmış operatörün IdP kimliğine izin verin. IdP’de kimlik avına dayanıklı MFA (örneğin güvenlik anahtarı/passkey) zorunlu olsun. Access oturumunu en fazla bir saatle sınırlayın. Yönetici yollarında Bypass kuralı kullanmayın.
3. Özel alan adları, Pages varsayılan alan adı, dal takma adları ve eski dağıtım adreslerini envantere alın. Her yönetici giriş noktasının aynı korumadan geçtiğini doğrulayın. Bir giriş noktası Access ile korunamıyorsa üretim öncesi yönetici Functions için imzalı Access JWT doğrulamasını veya o giriş noktasını kapatmayı değerlendirin. Bir başlığın varlığı tek başına doğrulama sayılmaz.
4. İzole ortamda oturumsuz istek, Access izni olup OLVEX yönetici rolü olmayan kullanıcı ve MFA ile giriş yapan atanmış yönetici senaryolarını doğrulayın. Önizleme için ayrı D1 bağı, ayrı yönetici kimliği ve üretimden ayrı sağlayıcı ayarları kullanın. Geri dönüşte son çalışan Access politikasını geri yükleyin ve yönetici yollarını tekrar denetleyin. [Access uygulaması](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) · [Access politikaları](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)

## Kayıt ve üretime geçiş

- Pages Production ortamında mevcut `OLVEX_SIGNUPS=open` kararını koruyun. Ayar eksik veya tanınmayan bir değerdeyse kayıt kapalı kalır. `preview` yalnızca izole önizlemede kullanılmalı. Bu mod önizlemede e-posta doğrulaması aramaz.
- Kayıt akışının `open` ile çalışabilmesi için yayımlanabilir işletmeci, hizmet adresi ve iletişim e-postası, geçerli HTTPS kökeni ve çalışan posta sağlayıcısı gerekir. İzole dağıtımda `open` ve `closed` senaryoları için hem `GET /api/public-info` hem kayıt POST davranışını doğrulayın.
- [D1 prosedürünü](D1-GECIS-VE-GERI-DONUS.md) prova edin. Canlı Access kapsamı, MFA, yedek saklama süresi, Pages–D1 bağı ve üretim kayıt ayarı bu denetimde yerel kanıtla doğrulanamaz.
