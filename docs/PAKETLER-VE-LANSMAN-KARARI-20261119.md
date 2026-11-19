# OLVEX — 19.11.2026 paket ve lansman kararı

Bu belge pazarlama/fiyat kararı ile **gerçekte etkin teknik yetkileri** ayırır. Fiyatlar kaynak kodundaki `functions/_lib/iyzico.js` ile eşleşir.

## Kesinleşen iki paket

| | Esnaf | Profesyonel |
| --- | --- | --- |
| Aylık liste bedeli | 499 TL | 999 TL |
| Yıllık liste bedeli (%20 indirim) | 4.790,40 TL | 9.590,40 TL |
| İşletme sayısı | 1 | 1 |
| Şube sayısı | 1 | 5 |
| Kullanıcı sayısı (sahip dahil) | 2 | 10 |
| Ürün/stok ve toplu CSV ürün aktarımı | Evet | Evet |
| Manuel ve CSV satış aktarımı | Evet | Evet |
| Müşteri, tahsilat, finans, temel rapor | Evet | Evet |
| Şubeler arası transfer | Hayır | Evet |
| Personel/vardiya, ekip yetkileri | Hayır | Evet |
| Kasa API aktarım altyapısı | Hayır | Evet, **desteklenen bağlayıcı şartıyla** |
| Şube bazlı rapor | Hayır | Evet |

**Uygulama notu:** Bu tablo ilan edilen ticari kapsamdır; kayıt/şube/üye limitlerini ve modül farklarını uygulayan sunucu tarafı abonelik yetkilendirmesi henüz yoktur. **İyzico aktif edilip ödeme alınmadan önce bu eksik kapatılmalıdır.** Şimdilik herhangi bir satın alma/ücretli aktivasyon yapılmamalıdır.

**AI kararı:** Mevcut veriye dayalı analizler ayrı değerlendirilir. Canlı OpenAI sohbeti üretim ortamında doğrulanana, kullanım başına maliyet ve bütçe sınırı tanımlanana kadar ücretli paketin çalışan bir özelliği gibi taahhüt edilmez. Etkinleşirse her iki paketin kullanım kotaları ayrıca kod ve sözleşmede duyurulmalıdır.

**POS kararı:** YN ÖKC / AKINSOFT markası seçmek tek başına donanım veya program entegrasyonu sağlamaz. OLVEX API, CSV, manuel kaydı destekler. Sağlayıcıya göre API/CSV izinleri ve uçtan uca fiş, iade, iptal, çok kasa/şube testleri tamamlanmadan otomatik senkronizasyon garantisi verilmez.

## İyzico başvurusu sonrası gerçekleştirme sırası

1. İşletme ve fatura bilgileri, ödeme sözleşmesi, vergiler dahil nihai tahsilat tutarları muhasebe/hukuk açısından teyit edilir.
2. İyzico tarafından **abonelik** destekleyen canlı üye işyeri onayı ve gerçek ürün/plan referansları alınır.
3. Aylık/yıllık toplamların sırasıyla 499,00 / 4.790,40 / 999,00 / 9.590,40 TL olarak planlarla eşleşmesi test edilir. `iyzico.js` bu tutarları kuruş olarak doğrulamak üzere kodlanmıştır.
4. Üretim değişkenleri güvenli biçimde ayarlanır; sırlar GitHub dosyalarına yazılmaz. `OLVEX_BILLING=live` yalnızca canlı gereksinimler ve güvenlik denetimleri tamamlandıktan sonra kullanılır.
5. Sunucu tarafı ücretli abonelik kontrolü, plan bazlı yetkiler, şube/koltuk sınırı, abonelik süresi dolması, iptal ve iade sonrası erişim test edilir; arayüz de sunucuyla aynı yetkileri gösterir.
6. Gerçek ödeme, başarısız/tekrarlanan callback, webhook, iptal, dönem yenileme ve fatura süreçleri uçtan uca doğrulanır.
7. D1 şeması, yedek/geri dönüş ve son commit üzerinde testler yeniden kontrol edilir. E-posta ve AI özellikleri gerçek üretim servisleriyle ayrı doğrulanır.
8. Ücretli satış ancak bu maddeler başarıyla tamamlanınca açılır.

## Müşteriye gösterilen dil

- Ana sayfada güncel fiyatlar ve belirlenmiş paket kapsamı yer alır.
- Temsili verilerin gösterildiği ziyaretçi inceleme ekranında bunun gerçek müşteri kaydı olmadığı açıkça kalır.
- Mock / deneme amaçlı AI yanıtları gerçek canlı AI hizmeti gibi gösterilmez.
- YN ÖKC bağlantısı, sağlayıcı API/SDK/çıktı desteği ve doğrulanmış bağlayıcı gerektirir.
- Tahsilat kapalıyken müşteriye ödeme yapılabiliyormuş izlenimi verilmez.

Bu belge karar kaydıdır; üretim ödeme ve erişim testlerinin yerine geçmez.
