# D1 geçişi, yedekleme ve geri dönüş

Bu prosedür OLVEX Pages sürümü ile ona ait D1 şemasını birlikte değiştirecek operatör içindir. Üretim adımları, sürümü onaylayan işletmecinin bakım penceresinde uygulanır. PR testleri yalıtılmış yerel D1 kopyalarını kullanır.

## 1. Hedefi ve geri dönüş noktasını belirle

1. İncelenen Git commit’ini, geçerli Pages dağıtım kimliğini, D1 hesap/veritabanı UUID’sini ve kurulu migrasyonları değişiklik kaydına yaz. Pages’in Production `DB` bağını aynı UUID ile karşılaştır. Örneklerde `cfg` operatörün o ortama özel Wrangler yapılandırmasının mutlak yolu, `db` bu yapılandırmadaki D1 adı ya da bağıdır. Kilit dosyasındaki sürümü `npm ci` ile kur.
2. API, CSV, manuel stok, AI onayı, transfer, kullanıcı ve oturum yazımlarını duraklat. Kasa cihazları bekleyen fişleri ve iadeleri özgün kaynak kimlikleriyle saklasın. Tüm yazıcılar durduğunda veri kesim saatini UTC olarak kaydet.
3. Yedekleri erişimi sınırlı, şifreli bir diskte oluştur. SQL dökümü müşteri kayıtları, parola ve oturum özetleri içerir. Makbuz referansları, SQL dosyaları ve üretim sorgu çıktıları erişimi sınırlı kalmalı.

```sh
umask 077
out=$(mktemp -d "$backup_root/olvex-XXXXXXXX")
w=./node_modules/.bin/wrangler
"$w" d1 info "$db" --config "$cfg"
"$w" d1 migrations list "$db" --remote --config "$cfg"
"$w" d1 time-travel info "$db" --config "$cfg" --json > "$out/time-travel.json"
"$w" d1 export "$db" --remote --config "$cfg" --output "$out/pre.sql"
(cd "$out" && sha256sum pre.sql > pre.sql.sha256 && sha256sum -c pre.sql.sha256)
```

`backup_root` mevcut güvenli dizin olmalıdır. Time Travel çıktısındaki `bookmark` değerini ve hesabın geçerli saklama süresini doğrula. Komutun başarıyla bitmesi ve dosya özetinin eşleşmesi, geri yükleme provasının ilk iki kontrolüdür. [Cloudflare Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) · [D1 içe ve dışa aktarım](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

## 2. Kayıt ve bakiye karşılaştırmasını hazırla

Aşağıdaki SQL’i `$out/temel.sql` olarak kaydet. Başlangıç şeması en az `0002_workspace.sql` olmalıdır. Dondurulmuş kaynak, geri yüklenen kopya ve yükseltilmiş kaynak için aynı sorguları çalıştır. `ORDER BY` ile sıralanan çıktılar işletme ve ürün bazındaki farkı da gösterir.

```sql
SELECT COUNT(*) AS kullanici FROM users;
SELECT COUNT(*) AS oturum FROM user_sessions;
SELECT id, name FROM businesses ORDER BY id;
SELECT business_id, role, COUNT(*) AS uyelik FROM business_members GROUP BY business_id, role ORDER BY business_id, role;
SELECT business_id, id, sku, stock FROM olvex_products ORDER BY business_id, id;
SELECT business_id, product_id, COUNT(*) AS hareket, SUM(delta) AS net FROM olvex_stock_movements
  GROUP BY business_id, product_id ORDER BY business_id, product_id;
SELECT business_id, source, kind, status, COUNT(*) AS belge FROM olvex_orders
  GROUP BY business_id, source, kind, status ORDER BY business_id, source, kind, status;
SELECT business_id, COUNT(*) AS kalem, SUM(quantity * unit_minor) AS brut_kurus FROM olvex_order_items
  GROUP BY business_id ORDER BY business_id;
SELECT business_id, id, revoked_at FROM olvex_pos_connections ORDER BY business_id, id;
SELECT business_id, action, COUNT(*) AS islem FROM olvex_operations
  GROUP BY business_id, action ORDER BY business_id, action;
PRAGMA foreign_key_check;
```

```sh
"$w" d1 execute "$db" --remote --config "$cfg" --command "$(cat "$out/temel.sql")" --json > "$out/oncesi.json"
jq -S 'map(.results)' "$out/oncesi.json" > "$out/oncesi.sonuclar"
```

Büyük kataloglarda ürün ve hareket sorgularını işletmeye ve ürün kimliği aralıklarına bölerek her parçanın çıktısını sakla. `foreign_key_check` boş sonuç vermelidir.

## 3. Yedeği bağımsız hedefte aç ve geçişi prova et

`recovery_cfg`, üretimden ayrı bir Wrangler yapılandırmasıdır. Yerel prova için DB bağının ismini `DB` olarak tanımla. Boş bir yerel dizin kullan ve tüm komutlarda aynı dizini belirt.

```sh
drill=$(mktemp -d "$backup_root/olvex-prova-XXXXXXXX")
(cd "$out" && sha256sum -c pre.sql.sha256)
node scripts/prepare-d1-restore.mjs "$out/pre.sql" "$out/restore.sql"
(cd "$out" && sha256sum restore.sql > restore.sql.sha256 && sha256sum -c restore.sql.sha256)
"$w" d1 execute DB --local --config "$recovery_cfg" --persist-to "$drill" --file "$out/restore.sql"
"$w" d1 execute DB --local --config "$recovery_cfg" --persist-to "$drill" --command "$(cat "$out/temel.sql")" --json > "$out/prova.json"
jq -S 'map(.results)' "$out/prova.json" > "$out/prova.sonuclar"
diff -u "$out/oncesi.sonuclar" "$out/prova.sonuclar"
"$w" d1 migrations apply DB --local --config "$recovery_cfg" --persist-to "$drill"
"$w" d1 migrations apply DB --local --config "$recovery_cfg" --persist-to "$drill"
"$w" d1 migrations list DB --local --config "$recovery_cfg" --persist-to "$drill"
```

Ham yedeği ve sağlama toplamını sakla. Hazırlık betiği şemayı veriden önce kurar, stok ve ödeme tetikleyicilerini veri yüklendikten sonra ekler. Hazırlanan kopyanın sağlama toplamını da kaydet. Betik standart ve belleğe sığan D1 SQL dışa aktarımlarını işler. Betik veya prova hata verirse devam etme.

İlk uygulama yalnız bekleyen dosyaları, ikincisi sıfır dosyayı işlemelidir. İkinci adımdaki karşılaştırmayı yükseltilmiş kopyada tekrarla. Yerel uygulamadan bir mevcut kullanıcının girişini, bir eski POS fişinin tekrarlı yanıtını ve bir kasa/şube stok sorgusunu sınamak için sentetik veri kullan. Gerçek müşteri kopyasını cihazlara veya canlı entegrasyonlara bağlama.

## 4. Onaylı geçişi uygula ve açılışı doğrula

Operatör, yedekten geri dönüş provasının fark üretmediğini, kesimden sonra yazım yapılmadığını ve hedef UUID’yi doğruladıktan sonra migrasyonları Wrangler’ın sürüm kaydı üzerinden uygular.

```sh
"$w" d1 migrations apply "$db" --remote --config "$cfg"
"$w" d1 migrations list "$db" --remote --config "$cfg"
"$w" d1 execute "$db" --remote --config "$cfg" --command "$(cat "$out/temel.sql")" --json > "$out/sonrasi.json"
jq -S 'map(.results)' "$out/sonrasi.json" > "$out/sonrasi.sonuclar"
diff -u "$out/oncesi.sonuclar" "$out/sonrasi.sonuclar"
```

Şube stoğunun işletme toplamına eşitliğini ve kasa bağlantılarını ayrıca denetle. İlk iki sorgunun boş dönmesi gerekir. Yeni POS modlarını inceleyerek eski kasaların `reconcile` ile başladığını doğrula.

```sql
SELECT p.business_id, p.id FROM olvex_products p LEFT JOIN olvex_branch_stock s
  ON s.business_id=p.business_id AND s.product_id=p.id
  GROUP BY p.business_id, p.id HAVING p.stock <> COALESCE(SUM(s.stock),0);
SELECT c.business_id, c.id FROM olvex_pos_connections c LEFT JOIN olvex_branches b
  ON b.business_id=c.business_id AND b.id=c.branch_id WHERE b.id IS NULL;
SELECT business_id, identity_mode, COUNT(*) AS kasa FROM olvex_pos_connections
  GROUP BY business_id, identity_mode ORDER BY business_id, identity_mode;
SELECT business_id, kind, COUNT(*) AS kayit, SUM(amount_minor) AS kurus FROM olvex_order_payments
  GROUP BY business_id, kind ORDER BY business_id, kind;
```

Geçiş öncesi ödenmiş siparişler için kalemlerin miktar × birim fiyat toplamını `payment` kayıtlarıyla, iptal edilmiş ödenmiş siparişlerin toplamını `refund` kayıtlarıyla karşılaştır. Yeni Pages sürümünü doğru D1 bağıyla etkinleştir. Mevcut bir hesabın oturum ve üyeliğini denetle. Geçmiş bir kasa fişini uzlaştırırken kaynak belgesini ve önceki referansı kullan. Kimlikler üreticide kalıcıysa yönetici kasayı `native` moda alabilir. Stok, fiş ve ödeme kontrolleri bitince yazımı aç ve bekleyen kasa iletilerini özgün referanslarıyla gönder.

## 5. Geri dön

1. Migrasyon hatası, beklenmeyen bakiye farkı veya oturum sorunu görüldüğünde yazım kapalı kalsın. D1 her migrasyonu ayrı izler. Korunan migrasyon listesini, başarısız dosyayı ve tamamlananları kaydet.
2. Yazım tekrar açılmışsa kesimden sonra oluşan satış, iade, üyelik, oturum ve diğer kayıtları ayrıca dışa aktar, kaynak günlükleriyle karşılaştır ve kurtarma planını işletmeciyle doğrula. Bir bookmark’a dönüş, o andan sonraki yazımları aktif veritabanının dışına çıkarır.
3. Saklama süresi içindeki doğrulanmış kesim bookmark’ını kullan. Hedef UUID, zaman ve bookmark doğrulandıktan sonra aşağıdaki geri yüklemeyi yetkili operatör başlatır. Wrangler’ın döndürdüğü geri alma bookmark’ını da kaydet.

```sh
"$w" d1 time-travel restore "$db" --config "$cfg" --bookmark "$cutover_bookmark"
"$w" d1 migrations list "$db" --config "$cfg" --remote
```

4. Bookmark kullanılamıyorsa doğrulanmış SQL dışa aktarımını **yeni, boş ve erişimi sınırlandırılmış** bir D1 veritabanına aktar. Hazırlanan `restore.sql` kopyasını ve sağlama toplamını doğrula. Kurtarma yapılandırmasının bağını ve UUID’sini kontrol et. `"$w" d1 execute DB --remote --config "$fresh_recovery_cfg" --file "$out/restore.sql"` komutundan sonra temel SQL ile kesim anındaki çıktıyı yeniden karşılaştır. Başarılı kontrollerin ardından eski Pages sürümünün Production `DB` bağını kurtarılan UUID’ye yönlendir.
5. Kesim öncesindeki uyumlu Pages dağıtımını ve D1 bağını birlikte geri getir. Oturum, üyelik, POS kimliği, stok ve ödeme kontrollerini tekrarla. Kesimden sonraki cihaz kuyruğunu ve diğer değişiklikleri kontrollü uzlaştırdıktan sonra yazımı aç. Geri yüklenen eski sürümün desteklemediği şube, transfer veya kısmi iade işlemleri için kaynak günlüklerini koru.

## Lansman öncesi yerel prova ve güvenlik olayı

Sentetik veriyle tekrarlanabilir prova için `node --test tests/d1-recovery.test.mjs` çalıştır. Prova güncel migrasyonları yerel kaynağa uygular, SQL dışa aktarımını boş bir hedefe yükler ve üyelik, şube stoku, ödeme tutarı, migrasyon kaydı ve yabancı anahtar bütünlüğünü karşılaştırır. Kesimden sonraki örnek yazım kaynakta kalır. Yerel prova, üretimdeki Time Travel bookmark’ını veya Pages bağ değişimini doğrulamaz.

Bir güvenlik olayı sonrası geri dönüşten önce kesimden bu yana yapılan parola değişikliklerini, oturum iptallerini ve kullanılmış kurtarma bağlantılarını belirle. Eski bir görüntü bunları eski durumuna döndürebilir. Yazımı kapalı tut ve erişimi yeniden açmadan önce geri gelen oturumların ve kurtarma bağlantılarının iptalini olay müdahalesinin parçası olarak onaylatıp uygula. Şüpheli parola özetleri için etkilenen hesapların güvenli kurtarma akışını işlet. Satış ve stok kayıtlarına ait kesim sonrası yazımları ayrı bir kaynakta uzlaştır.
