# Kasa entegrasyonu yük testi

18 Kasım 2026 tarihinde yerel Cloudflare Pages ve D1 ortamında 1.000 eşzamanlı satış, 1.000 satış tekrarı, 100 kısmi iade, 50 tam iptal ve bu 150 işlemin tekrarları doğrulandı. Test geçti. Net satış tutarı **26.062,50 TL**, işletmenin kapanış stoğu A ürününde **1.400**, B ürününde **850** adetti.

## Senaryo

Bir işletmenin Merkez şubesinde üç, Sahil şubesinde iki kasa açıldı. Her kasa fiş numaralarını 0–199 aralığında bağımsız olarak kullandı. Bütün fişlerin içeriği ve satış tarihi aynıydı. Bir fiş, birim fiyatı 12,50 TL olan iki A ürünü ile birim fiyatı 3,75 TL olan bir B ürünü içeriyordu. Beş kasadan gelen 1.000 HTTP isteği, ilk yanıt beklenmeden başlatıldı. Satış tarihi aktarım gününden yedi gün önceydi.

| Şube | Kasa | Satış | Açılış A / B | Satış ve tekrar sonrası A / B | İade, iptal ve tekrar sonrası A / B |
| --- | ---: | ---: | ---: | ---: | ---: |
| Merkez | 3 | 600 | 2.000 / 1.000 | 800 / 400 | 920 / 430 |
| Sahil | 2 | 400 | 1.200 / 800 | 400 / 400 | 480 / 420 |
| İşletme toplamı | 5 | 1.000 | 3.200 / 1.800 | 1.200 / 800 | **1.400 / 850** |

Her kasada ilk 20 fişten birer A ürünü iade edildi. Sonraki 10 fiş tamamen iptal edildi. Böylece stoğa 200 adet A ve 50 adet B döndü. Ayrı bir işletmenin aynı SKU’larda açılan 7’şer adetlik stoğu her aşamada doğrulandı.

## Finans ve kayıt sayıları

| İşlem | Hesap | D1 sonucu |
| --- | --- | ---: |
| Brüt satış ve tahsilat | 1.000 × 28,75 TL | 28.750,00 TL |
| Kısmi iade | 100 × 12,50 TL | 1.250,00 TL |
| Tam iptal | 50 × 28,75 TL | 1.437,50 TL |
| Toplam geri ödeme | 1.250,00 + 1.437,50 TL | **2.687,50 TL** |
| Net satış ve net tahsilat | 28.750,00 − 2.687,50 TL | **26.062,50 TL** |
| İade ve iptal sonrası satılan mal maliyeti | 1.000 × 9,00 − 100 × 4,00 − 50 × 9,00 TL | 8.150,00 TL |

D1 sorgularında kasa başına 200 satış, toplam 2.000 satış kalemi, 1.000 tahsilat ve 150 geri ödeme kaydı bulundu. Stok defterindeki 2.204 hareketin dördü açılış ve şube stok girişi, 2.000’i satış, 100’ü kısmi iade, 100’ü iptal kalemiydi. Her şube ve SKU için hareketlerden hesaplanan bakiye, ürün API’sindeki stokla eşleşti. Yabancı anahtar denetimi sıfır ihlal döndürdü.

Satış, iade ve iptal tekrarlarının her biri ilk işlemle aynı sunucu kimliğini ve `repeated: true` sonucunu döndürdü. Satış günü raporunda 28.750,00 TL brüt satış, iade ve iptal günü raporunda −2.687,50 TL satış etkisi ve 2.687,50 TL nakit çıkışı görüldü.

## Hata ve yetki kontrolleri

- Kasa isteğinde başka bir işletme, şube veya kasa kimliği gönderildiğinde API her üç isteği de HTTP 403 ile reddetti.
- Asıl satıştan önce ulaşan iade HTTP 409 aldı. Satış aktarıldıktan sonra aynı iade kimliği başarıyla işlendi.
- Mevcut satış veya iade kimliğinin farklı miktarla gönderilmesi ve kalan adedi aşan yeni bir iade HTTP 409 aldı.
- Bir satışın ikinci kalemi için işletmenin toplam stoğu yeterliyken kasanın şubesinde bir adet eksik vardı. HTTP 409 sonrasında her iki kalemin stoğu, satış ve ödeme kayıt sayıları önceki değerleriyle eşleşti.

## Geçiş ve kullanıcı akışları

- Önceki şemadan taşınan kasa satışını ve iptalini aynı kimliklerle tekrar gönderen test geçti. Eski oturum çalıştı. Hem şube hem işletme bakiyesi 18 adet, net tahsilat 25,00 TL kaldı.
- Tahsil edilmemiş bir satışta eşzamanlı iadeler kalan adetle sınırlandı. Sonraki 4,92 TL tahsilat, 1,23 TL kısmi iade ve 3,69 TL iptal birbirini dengeledi. Stok başlangıçtaki 10 adede döndü.
- Şubeler arası beş adetlik transfer iki karşılıklı hareket üretti. 12 adetlik toplamın yedisi kaynakta, beşi hedefte kaldı. Aynı transfer kimliğiyle tekrar, kaynağın bakiyesini aşan transfer ve başka işletmeye transfer reddedildi.
- Güncel şemada 10.000 stok işlemi testi geçti. Kayıt, giriş, parola sıfırlama, oturum kapatma ve önceki sürümden kalan oturum testleri de geçti. Chromium masaüstü ve mobil akışlarında kasaya bağlı CSV aktarımı, şube stoğu, uzlaştırma ve anahtar yenileme doğrulandı.

## Tekrar çalıştırma

Proje kökünde bağımlılıkları yükleyip testi çalıştırın.

```sh
npm ci
node --test tests/pos-load.test.mjs
```

Ölçülen koşuda Node.js 24.22.1 ve projenin sabitlediği Wrangler 4.164.0 kullanıldı. Test geçici bir veritabanına güncel şemayı oluşturan migrasyonları uyguladı, gerçek `/api/pos` ve işletme uç noktalarından istek gönderdi ve dört aşamada sonuçları D1 sorgularıyla karşılaştırdı. Son koşuda yük testi 60,98 saniye sürdü. Test paketinin tamamında 28 test geçti, hata veya atlama kaydedilmedi. Bu yerel simülasyon, aynı anda başlatılan istekler D1 tarafından sıralandığında kayıtların doğruluğunu ölçer. Üretim D1 kapasitesi, ağ gecikmesi ve fiziksel kasa üreticisinin işlem kimliği garantisi ayrı koşullarda doğrulanır.
