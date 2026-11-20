# Posnic yerel bağlayıcısı

Bağlayıcı Posnic API'siyle aynı bilgisayarda çalışır. Posnic webhook'u loopback üzerinden bağlayıcıyı uyandırır. Bağlayıcı yetkili API'den kayıtları okur ve OLVEX'e mevcut `POST /api/pos` üzerinden HTTPS ile gönderir. Bir webhook gelmese bile tarama devam eder. OLVEX'in Posnic ağına erişmesi gerekmez.

## Posnic kaynak sözleşmesi

Aşağıdaki kaynaklar `09f5a63e12281469ad593116da6777543958b3d1` revizyonunda incelendi. İlgili API ve kayıt alanları yayımlanan v1.9.2 etiketiyle de karşılaştırıldı. [Posnic v1.9.2](https://github.com/Posnic/POS/tree/v1.9.2)

| İşlem | Kaynak sözleşmesi |
| --- | --- |
| Webhook | `sales` bildirimi `event`, `entity`, `at` ve `shop` taşır. Posnic ham JSON'u HMAC-SHA256 ile imzalayıp `X-Posnic-Signature: sha256=<hex>` başlığında gönderir. [Gönderici](https://github.com/Posnic/POS/blob/09f5a63e12281469ad593116da6777543958b3d1/api/src/realtime/webhooks.js) |
| Satış ve kimlik doğrulama | `GET /api/v1/sales` `sales.read` kapsamlı Bearer anahtarıyla ilgili satış belgelerini döndürür. `updated_date` ve `_id` birleşik imleciyle sayfalanır. `GET /api/v1/sales/:id` tek kaydı verir. [API](https://github.com/Posnic/POS/blob/09f5a63e12281469ad593116da6777543958b3d1/api/src/v1/index.js), [anahtar çözümleme](https://github.com/Posnic/POS/blob/09f5a63e12281469ad593116da6777543958b3d1/api/src/middleware/auth.js) |
| Kasa | Satıştaki `cashregister_id` kasa oturumunun kimliğidir. `GET /api/registers/getCashRegister?id=…` oturumun kalıcı `register_id` değerini verir. [Satış kaydı](https://github.com/Posnic/POS/blob/09f5a63e12281469ad593116da6777543958b3d1/api/src/services/sale.service.js), [kasa kaydı](https://github.com/Posnic/POS/blob/09f5a63e12281469ad593116da6777543958b3d1/api/src/repositories/register.repository.js) |
| İade | `items_return[].returnArray.returnObjId` işlem kimliğidir. İade özgün satışa bağlıdır ve OLVEX’e o satışın kayıtlı kasası üzerinden gider. İlk aktarım bir iadeden sonra yapılırsa özgün kalemler için `business_item_origin` gerekir. [İade kaydı](https://github.com/Posnic/POS/blob/09f5a63e12281469ad593116da6777543958b3d1/api/src/repositories/sale.repository.js), [özgün satış görüntüsü](https://github.com/Posnic/POS/blob/09f5a63e12281469ad593116da6777543958b3d1/api/src/services/business-item-origin.js) |
| İptal | Posnic bazı iptallerde satış belgesini siler. Bağlayıcı, aktardığı satış için `GET /api/sales/getDataChanges` günlüğündeki aynı lisans ve şubeye ait `delete` kaydını, v1 satış ayrıntısındaki `404/not_found` ile doğrular. Kaynakta kalan `status: cancelled` kaydını da işler. [İptal denetleyicisi](https://github.com/Posnic/POS/blob/09f5a63e12281469ad593116da6777543958b3d1/api/src/controllers/sales.controller.js), [değişiklik günlüğü](https://github.com/Posnic/POS/blob/09f5a63e12281469ad593116da6777543958b3d1/api/src/models/base.model.js) |

## Kurulum

1. Node.js 22.13+ kurun. Her Posnic şubesi için bir bağlayıcı işlemi, ayrı yerel durum dosyası ve boş loopback portu kullanın. Posnic’in yetkili API adresini ve şubenin lisans, şube ve **fiziksel** kasa kimliklerini kaydedin.
2. Posnic’te **Manage → Integrations → API Tokens** üzerinden yalnızca Sales Read kapsamlı bir anahtar oluşturun. Posnic şubesi bu anahtarın erişim alanında olmalı. OLVEX Profesyonel paketinde her fiziksel kasa için karşılık gelen şubede **kalıcı kaynak işlem kimliği** kullanan ayrı bir kasa bağlantısı açın. OLVEX SKU'larını Posnic SKU'larıyla eşleştirin.
3. JSON dosyasını Git deposu dışında saklayın. Posnic şubesinin para birimini ve aktarılacak geçmişi kontrol edin. `startOn` dahil olacak ilk yerel satış günüdür. Başlangıç stoklarını ve daha önce farklı referansla içe alınmış satışları hesaba katarak bu tarihi belirleyin.

```json
{
  "posnicOrigin": "http://127.0.0.1:4100",
  "posnicLicenseId": "111111111111111111111111",
  "posnicBranchId": "222222222222222222222222",
  "olvexOrigin": "https://olvex.example",
  "olvexBusinessId": "11111111-1111-1111-1111-111111111111",
  "olvexBranchId": "22222222-2222-2222-2222-222222222222",
  "currency": "TRY",
  "timeZone": "Europe/Istanbul",
  "startOn": "2026-11-20",
  "statePath": "/var/lib/olvex-posnic/sube.sqlite",
  "webhookPort": 9021,
  "registers": [
    {
      "posnicRegisterId": "333333333333333333333333",
      "olvexRegisterId": "33333333-3333-3333-3333-333333333333",
      "tokenEnv": "OLVEX_POS_TOKEN_KASA1"
    }
  ]
}
```

4. Posnic’te **Manage → Integrations → Webhooks** altında yalnızca `sales` olayına abone olun. Bu yerel kurulumda hedef `http://127.0.0.1:9021/posnic/webhook` olur. İmzalama sırrını Posnic oluşturur. Bağlayıcı portunu dış ağa açmayın. [Posnic webhook kılavuzu](https://posnic.com/guides/posnic-pos-complete-user-guide/settings/register-monitor-webhooks/)
5. Servisin gizli ortamına `POSNIC_API_TOKEN`, `POSNIC_WEBHOOK_SECRET` ve her kasa için JSON’da adı verilen tam `olvex_pos_…` değerini verin. Servis kullanıcısına durum dizininde okuma ve yazma izni verin, dosyaları o kullanıcıyla sınırlandırın. Windows’ta bunu dizin erişim izinleriyle uygulayın. Çalıştırın.

```sh
node integrations/posnic/run.mjs /etc/olvex-posnic/sube.json
```

## Yeniden deneme ve uzlaştırma

Bağlayıcı satış ve iade kimliklerini Posnic’in kalıcı kimliklerinden üretir. OLVEX’in kasa bazlı işlem kimliği ve atomik stok işlemleri tekrarları karşılar. Yerel durum dosyası bekleyen gönderimleri ve tarama imleçlerini saklar. Onay kaybından veya bağlantı kesintisinden sonra aynı işlem tekrar gönderilir. Günlük olağan tarama, imlecin gerisine düşen kayıtları yeniden kontrol eder. Durum dosyası ve yedekleri kasa başında tutulmalı. Satış tanımlayıcıları ve normalize edilmiş kalemler dosyada saklanır.

Tam taramayı hemen başlatmak için hizmeti durdurup aynı ayar ve durum dosyasıyla bir kez `--reconcile` verin. Bu işlem hem satış hem silme günlüklerini baştan okur ve eski onayları kullanır. İzleyen olağan başlatmalarda bayrağı kaldırın.

```sh
node integrations/posnic/run.mjs /etc/olvex-posnic/sube.json --reconcile
```

Bir Posnic kaydı OLVEX sözleşmesine kayıpsız çevrilemiyorsa bağlayıcı kayıt kimliğiyle hata verir ve imleci o kaydın ötesine taşımaz. Örnekler arasında eşleşmeyen kasa, kesirli stok adedi, kısmi ödeme ve toplamı tam kuruşlu birim fiyatla ifade edilemeyen fişler bulunur. Sonradan değişen satış veya tahsilat için mevcut POS sözleşmesiyle otomatik düzeltme yapılmaz. Önceden görülmeyen ve Posnic’ten silinmiş bir satışın aslı bu uç noktalardan geri alınamaz. Posnic silme günlüğünü tutamadıysa veya eksik bir iade sırasında satış belgesi silindiyse eksik geçmiş otomatik olarak yeniden oluşturulamaz. Başarısız Posnic işlemlerinin veya kapsam dışı tarihî kayıtların incelenmesi için ilgili kaynak kimliğini ve kayıt türünü kullanın.
