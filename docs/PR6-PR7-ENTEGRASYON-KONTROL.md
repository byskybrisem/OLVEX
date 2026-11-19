# OLVEX PR #6 + PR #7 — entegrasyon devir notu
Tarih: 19 Kasım 2026

## Kapsam ve dal
- Kaynaklar: PR #6 (`feature/branch-register-pos`) ve PR #7 (`release/launch-review`).
- Çalışma dalı: `integration/pr6-pr7-review`, PR #7 dalından üretildi.
- `main`, canlı Pages dağıtımı ve üretim D1 veritabanı değiştirilmedi.
- Bu dal **lansman için onaylanmış değildir**; bütün testler çalıştırılıp sonuçlar doğrulanmalıdır.

## Birleştirilen değişiklikler
1. Kasa/şube özellikleri: stok transferi ve geçmişi için servis, API, ekran/form; şube seçilerek manuel satış, stok ve AI taslak onayı.
2. Stok uyarıları: işletme toplamından bağımsız şube bazlı uyarı sorguları, panel ve AI veri akışı.
3. Kasa güvenliği: başarısız anahtar denemelerinin sınırlanması ve kasa başına dakikalık istek kotası.
4. Lansman özellikleri korundu: satış düzeltme/sürüm mantığı, kayıt ve şifre kurtarma değişiklikleri, yeni finans hesaplamaları, tasarım ve tanıtım sayfası.
5. Migrasyon sırası: PR #7'nin `0007_sale_edits.sql` dosyası durur; PR #6'daki `0007_transfer_history.sql` yeni dalda `0008_transfer_history.sql` olarak eklendi.
6. Yedekleme/geri dönüş yönergesi `docs/D1-GECIS-VE-GERI-DONUS.md` dosyasına aktarıldı.
7. Ek regresyonlar: `tests/branch-transactions.test.mjs`, `tests/browser-branches.mjs`, `tests/pos-security.test.mjs`; ayrıca API ve UX testlerine şube/AI senaryoları eklendi.

## Yapılan kontrol
- Değiştirilen 13 JavaScript dosyası, ESM `import/export` deyimleri ayıklanarak sözdizimi açısından ayrıştırıldı; hata görülmedi.
- **Bu kontrol derleme, test çalıştırma veya veri bütünlüğü doğrulaması değildir.**
- GitHub tarafında bu birleşik dal için doğrulanmış `npm test`, tarayıcı veya canlı D1 sonucu bulunmamaktadır.

## Birleştirme öncesi zorunlu doğrulama
```sh
npm ci
npm run build
npm test
npm run test:browser
npm run test:browser:branches
```
- Temiz D1'e `0001`–`0008` migrasyonlarını sırayla uygulayıp `PRAGMA foreign_key_check` ve `PRAGMA integrity_check` çalıştırın.
- Ayrı D1 kopyasında eski kullanıcı/işletme/oturum, şube, kasa, satış, iade, transfer ve ödeme kayıtlarının korunmasını kontrol edin.
- İki şubede manuel satış/satın alma, transfer, kasa API, tekrar fiş, kısmi iade, satış düzeltme ve AI taslağı senaryolarını birlikte test edin.
- POS rate-limit testleri ve üretim yük davranışını doğrulayın.
- Kaynak PR #6'daki `tests/stock.test.mjs` restore/transfer migrasyon senaryoları henüz bu dala tam taşınmadı; yeni `0008` adıyla uyarlanarak uygulanmalı.
- PR #7'nin birleşik tarayıcı, canlı e-posta teslimi, hukukî onay ve üretim geri dönüş noktası eksikleri hâlâ ayrı yayın engelleridir.

## Uygulama / yayın kapısı
- Bu dal önce PR #7'ye doğrulanarak aktarılmalı; sonra bütün kontroller geçilirse PR #7 `main` için değerlendirilmelidir.
- PR #6'nın bütün fonksiyonel değişiklikleri ve testleri doğrulanmadan PR #6'yı kapatmayın.
- Üretime D1 migrasyonu uygulamayın; Pages deploy, ödeme tahsilatı ve üyelik açılışı yapmayın.
- Farklı önizleme ortamında `0007_transfer_history.sql` zaten uygulandıysa migrasyon kaydını ve sırasını özel olarak uzlaştırın; dosyayı otomatik tekrar uygulamayın.
