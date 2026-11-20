# OLVEX hesap e-postası doğrulaması

Kayıt ve parola kurtarma aynı Pages Functions göndericisini kullanır. Resend yanıtı isteğin kabul edildiğini gösterir. Gelen kutusuna teslim ayrı doğrulanır.

## Cloudflare Pages ve Resend

- Doğru Pages ortamında `OLVEX_MAIL_PROVIDER=resend` veya varsayılan sağlayıcıyı kullanın. `RESEND_API_KEY` değerini yalnızca Cloudflare Secret olarak saklayın. OLVEX gönderici alan adıyla sınırlı bir gönderim anahtarı kullanın. `OLVEX_FROM_EMAIL` doğrulanmış Resend alanında olmalı. `OLVEX_PUBLIC_ORIGIN` gerçek uygulamanın HTTPS kökeni olmalı.
- Resend’deki doğrulanmış alanın DNS tablosunu Cloudflare DNS ile karşılaştırın. Resend’in verdiği DKIM TXT kaydını, dönüş zarfı alt alanına ait SPF TXT kaydını ve ilgili MX kaydını doğrulayın. Aynı DNS adı altında birden fazla SPF kaydı yayımlamayın. Mevcut gelen posta MX kayıtlarını koruyun. DMARC TXT kaydını From alan adında veya geçerli üst alan politikasında kontrol edin. Test iletisinde SPF/DKIM sonucuyla birlikte DMARC hizalamasını doğrulayın. [Resend alan adı](https://resend.com/docs/dashboard/domains/introduction) · [DMARC](https://resend.com/docs/dashboard/domains/dmarc)
- Doğrulama ve kurtarma linklerini yeniden yazmaması için işlem e-postası alanında tıklama ve açılma izlemeyi kapalı tutun. Bağlantı parçası olan tek kullanımlık kodları günlük, ekran görüntüsü veya destek kaydına koymayın. [İzleme ayarları](https://resend.com/docs/dashboard/domains/tracking)

## İzinli gerçek teslimat provası

1. İzole Pages önizleme ortamını, ayrı D1 veritabanını, kendi HTTPS kökenini ve kullanılmasına izin verilmiş test posta kutularını hazırlayın. `preview` kayıt modu e-posta doğrulamasını atlar. E-posta provası için izole hedefte `OLVEX_SIGNUPS=open` ve gerekli yasal iletişim yapılandırmasını kullanın. Üretimde mevcut `OLVEX_SIGNUPS=open` ayarını koruyun.
2. Gerçek Resend gönderimini izinli test posta kutusunda kayıt doğrulama ve şifre sıfırlama için ayrı ayrı kontrol edin. Gelen kutusu ve spam konumunu kaydedin. Resend panelinde kabul, teslim veya geri dönüş durumunu inceleyin. İletinin Authentication-Results başlığında SPF, DKIM ve DMARC sonucunu kontrol edin.
3. Mobil posta uygulamasında Türkçe başlık, okunabilir gövde ve dokunulabilir düğmeyi, düz metin istemcisinde de bağlantıyı açın. Bağlantının OLVEX’in doğru HTTPS adresine gittiğini, kodun URL parçasında kaldığını ve formu başarıyla tamamladığını doğrulayın. Bağlantı tekrar kullanılamamalı ve 30 dakika sonra geçersiz olmalı. Parola sıfırlamadan önce açılmış oturumun sonraki isteği reddedilmeli.
4. Teslim görünmüyorsa Pages günlüklerinde `OLVEX_ACCOUNT_MAIL` olaylarını inceleyin. `address_rate_limit` ve `ip_rate_limit` sağlayıcıya gitmeyen istekleri, `provider_accepted` kabulü, reddetme veya zaman aşımı olayları gönderim sorunlarını gösterir. Kayıt ve kurtarma yanıtları hesap durumunu ve teslim sonucunu açıklamaz. İzinli test adresiyle yeniden denemeden önce 30 dakikalık adres penceresini ve IP sınırını dikkate alın.

Bu PR’ın otomatik testleri izole D1 ve taklit sağlayıcıyla çalışır. Gerçek posta teslimi ve üretim DNS/Resend yapılandırması bu testlerin dışındadır.
