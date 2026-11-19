# OLVEX AI

## Yayın

`0012_olvex_ai_usage.sql` geçişini önce izole D1, yayın onayından sonra doğru üretim D1 bağı üzerinde çalıştırın. Tablo yalnızca yeni istek ölçümlerini ve kota rezervasyonlarını tutar. Ücretsiz işletme analizi OpenAI anahtarına bağlı değildir.

- `OPENAI_API_KEY` proje anahtarını yalnızca Cloudflare Pages Secret olarak tanımlayın. Anahtarı erişimi gereken test ve üretim projelerinde ayrı tutun.
- `OPENAI_MODEL` varsayılanı `gpt-6-luna`. `gpt-6.2-sol` seçilebilir. Otomatik model yükseltmesi yoktur. Eski `gpt-4.1-mini` yapılandırması reasoning parametresi olmadan desteklenir.
- `OLVEX_AI_REASONING_EFFORT` varsayılanı `medium`. GPT-6.2 Sol `none` kabul etmez.
- `OLVEX_OPENAI_DAILY_LIMIT` pozitif tam sayıdır ve varsayılanı 100’dür. İşletme başına 20, kullanıcı başına 12 istek uygulanır. Gün sınırı İstanbul saatidir. Başarısız veya ölçümü dönmeyen çağrılar da kotaya dahildir.
- `OLVEX_AI_MODE=off` ücretli sohbeti ve taslak uygulamayı kapatır. Ücretsiz analiz ve taslak reddi kullanılabilir. `mock` yerel veya önizleme akışları içindir. Üretimde bu değer ücretli çağrı başlatmaz.
- İstek başına son mesaj 2.000 karakter, önceki en fazla dört mesaj 650’şer karakterle sınırlıdır. Yanıt ve reasoning birlikte en fazla 1.600 çıktı tokenı. Sunucu sorguları ayrıntı listelerinde en fazla sekiz satır döndürür.

Önizlemede test D1 ile satış ve stok verileri oluşturarak sonuçları panelle karşılaştırın. Gerçek anahtar ve ücretli provider doğrulaması ayrı onay gerektirir. Bir istekle model erişimini, dönen token ölçümünü, kota ayarını ve bilinen toplamı doğrulayın. [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create) · [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## Maliyet

Standart metin fiyatları, milyon token başına USD. Reasoning tokenları çıktıya dahildir. Uygulamanın girdi boyutu uzun bağlam fiyatlandırması eşiğinin altındadır.

| Model | Girdi | Önbellekten girdi | Önbelleğe yazılan girdi | Çıktı |
|---|---:|---:|---:|---:|
| GPT-6 Luna | $0,10 | $0,01 | $0,125 | $0,50 |
| GPT-6.2 Sol | $2,00 | $0,10 | $2,50 | $10,00 |

Örnek olarak 2.000 normal girdi ve 700 çıktı tokenı olan bir isteğin maliyeti Luna ile **$0,00055**, Sol ile **$0,011**. Aynı hacimde 1.000 istek sırasıyla yaklaşık **$0,55** ve **$11**. Vergi, kur dönüşümü ve farklı sağlayıcı işleme seçenekleri hesaba dahil değildir. Panel, son 30 günün işletme bazlı kullanımını ve ölçülen tokenlardan hesaplanan tahmini maliyeti gösterir. Belirsiz timeout sonuçları ve fiyatı bilinmeyen ölçümler tahminsiz istek olarak sayılır. [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) · [GPT-6.2 Sol](https://developers.openai.com/api/docs/models/gpt-6.2-sol) · [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)

## Veri ve işlem sınırları

- Satış ve brüt sonuç, kayıtlı kalem maliyetleri ile satış, iade ve iptal hareketlerinden hesaplanır. Brüt zarar işletmenin toplam net kârını temsil etmez. Şube nakit raporları o şubeye bağlı satış ve alış ödemelerini içerir. İşletme genelindeki bağımsız nakit kayıtları şube kapsamına dahil değildir.
- Kritik stok önerileri kayıtlı eşiklere dayanır. Sistem sipariş oluşturmaz ve tedarik süresi veya tahmin verisi kullanmaz. Serbest metindeki tüm tarih, ürün veya şube adları çözümlenemez. Doğrulanmış kapsam ve dönem yanıtın altında gösterilir. Şube seçimi panelden yapılır. Tarihleri YYYY-AA-GG biçiminde de yazabilirsiniz.
- Sağlayıcıya hesap, müşteri ve personel kayıt alanları gönderilmez. Serbest metindeki bazı e-posta, telefon ve kimlik numarası biçimleri maskelenir. Kullanıcı mesajları ile ürün/şube etiketleri yine kişisel bilgi içerebilir. Sohbet geçmişi tarayıcı belleğindedir. Sunucudaki kota/maliyet kaydına mesaj metni yazılmaz. Onaya sunulan gider veya stok açıklaması bekleyen taslakta saklanır.
- Responses çağrısında `store: false` ayarlanır. Canlı sohbet açılmadan önce veri sorumlusu, OpenAI sözleşmesi, servis bölgesi, saklama koşulları, 6698 sayılı Kanun kapsamındaki aktarım mekanizması ve yerel kullanım kayıtlarının saklama süresini doğrulamalıdır. [OpenAI veri denetimleri](https://developers.openai.com/api/docs/guides/your-data)
- Model araç, SQL veya kayıt yazma yetkisine sahip değildir. Son mesaj açıkça isterse yalnızca gider veya stok taslağı üretilebilir. Kayıt, yetkili taslak sahibinin açık onayı ve atomik D1 kontrolleriyle yapılır. Şube stoku değişmişse yeni stok taslağı gerekir.
