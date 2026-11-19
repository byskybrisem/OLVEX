# OLVEX — Resmî lansman kontrol ve devir kaydı

**Tarih:** 19 Kasım 2026  
**Hedef:** Beta etiketi olmadan, gerçek müşterilerin güvenli şekilde kullanabileceği resmî lansman.

## Tamamlanan / doğrulanan

- PR #8, PR #7 dalına birleşti. PR #7 hâlâ açık; `main` dalına birleştirilmedi.
- GitHub Actions Node 22 ile derleme, seri API/güvenlik/D1 ve Chromium genel + şube/kasa/transfer tarayıcı testlerini çalıştırıyor. Geçerli son koşunun yeşil olması yayımlama ön şartıdır.
- `migrations/0001`–`0008` izole bir **gerçek Cloudflare D1** veritabanına sırasıyla, hata alınmadan uygulandı. 26 `olvex_*` tablo, 23 `olvex_*` tetikleyici, sıfır FK ihlali doğrulandı. Deneme veritabanları silindi.
- İki ücretli planın (Esnaf **499 TL/ay**; Profesyonel **999 TL/ay**) gösterimi ve yıllık %20 indirim hesabı hazırlandı. Bunlar şu an **tahsil edilebilen veya sunucuda yetkisi uygulanan abonelikler değildir**.
- `support@olvex.com.tr` Cloudflare Email Routing'de doğrulanmış mevcut yönlendirme hedefiyle etkinleştirildi ve iletişim sayfasına eklendi. Preview/Production `OLVEX_CONTACT_EMAIL` tanımlandı; mevcut D1 bağları ve kayıt kapalı ayarı korundu.

## Lansman öncesi zorunlu engeller

1. **Önizleme ve üretim D1 geçişleri:** Her iki Pages D1 bağı şu anda yalnızca `0001_auth.sql` ve `0002_workspace.sql` düzeyinde. Veritabanı taşımadan önce SQL dışa aktarımı kalıcı, erişimi sınırlandırılmış bir konumda saklanmalı, checksum ve boş olmayan veritabanı geri yükleme provası bitmeli. Uygulama sırası `0003`–`0008`; sürüm kayıtları Wrangler'ın `d1 migrations apply` mekanizmasıyla yazılmalı. Cloudflare Time Travel bookmark tek başına kalıcı harici yedek değildir.
2. **Gerçek ödeme:** İyzico'da uygun onaylı üye işyeri ve abonelik ürünü; üretim API yetkileri, iyzico ürün/plan referansları, callback doğrulaması, başarısız/tekrarlanan ödeme, iptal ve iade testleri gerekli. Müşteriye erişimi ödeme durumuna göre sınırlandıran sunucu yetkilendirmesi ve fiyat/kapsam kararı yok. Sadece fiyat kartları tahsilat sistemi değildir. Merchant onayı olmadan ücretli kayıt açılmamalı.
3. **E-posta:** Gelen `support@` alias yönlendirmesi etkin. Dışarıya güvenilir şifre sıfırlama e-postası gönderimi için `RESEND_API_KEY` ve doğrulanmış `OLVEX_FROM_EMAIL` henüz ayarlanmadı / gerçek gönderim testi yapılmadı.
4. **OpenAI:** `OPENAI_API_KEY`, bütçe sınırı ve üretim AI çağrısı etkin/gerçek maliyetli test doğrulanmadı; MOCK testlerini canlı OpenAI sanmayın.
5. **Hukuk ve işletmeci:** `OLVEX_OPERATOR_NAME`, `OLVEX_SERVICE_ADDRESS`, KVKK aydınlatma, hizmet şartları, mesafeli hizmet satış/iade şartları ve fatura düzeni gerçek işletmeci koşullarına göre tamamlanmalı. İşletmeci adı/adresi tahmin edilip kamuya yayımlanmamalı.
6. **Son yayın:** Tarayıcı, mobil ve API kontrolleri son commit üzerinde yeşil; canlı D1 doğru migrasyon seviyesinde; ödeme ve parola sıfırlama başarılı; yedek/geri dönüş testi onaylı olduğunda PR #7 `main` dalına alınabilir. Sonrasında gerçek yeni hesap, işlem, ödeme ve iptal akışı denetlenip `OLVEX_SIGNUPS=open` yapılabilir. Şu an `closed` kalmalıdır.

## Sıra ve geri dönüş

Ayrıntılı prosedür: [D1-GECIS-VE-GERI-DONUS.md](./D1-GECIS-VE-GERI-DONUS.md). Kod geçişi/operasyonlar: [PR6-PR7-ENTEGRASYON-KONTROL.md](./PR6-PR7-ENTEGRASYON-KONTROL.md).

**Bu dosyanın varlığı yayın veya ödeme onayı değildir.** Her adımın çalıştırılan sonucu ve canlı ortam değişiklikleri ayrı olarak teyit edilmelidir.
