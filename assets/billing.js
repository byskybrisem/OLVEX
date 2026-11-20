// Customer card data is entered only in iyzico's hosted checkout, never in OLVEX.
const form = document.querySelector("#billingForm");
const subtitle = document.querySelector(".subtitle");
const message = document.querySelector("#message");
const current = document.querySelector("#activeSubscription");
const stateText = document.querySelector("#statusText");
const cancel = document.querySelector("#cancelSubscription");
const businessId = new URLSearchParams(location.search).get("businessId");
const amount = { "profesyonel-monthly": "999 TL/ay", "profesyonel-yearly": "9.590,40 TL/yıl" };

function notify(value, error = false) {
  message.textContent = value;
  message.classList.toggle("error", error);
}
async function getJson(url, init) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Abonelik isteği başarısız.");
  return data;
}
const pretty = (ms) => new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul"
}).format(new Date(ms));

async function load() {
  if (!businessId || !/^[a-zA-Z0-9_-]{1,100}$/.test(businessId)) {
    notify("Geçerli bir işletme seçerek ayarlar üzerinden yeniden deneyin.", true);
    return;
  }
  try {
    const { businesses } = await getJson("/api/businesses");
    const business = businesses.find(item => item.id === businessId && item.role === "owner");
    if (!business) throw new Error("Yalnızca işletme sahibi aboneliği yönetebilir.");
    const { enabled, checkoutEnabled, subscription } = await getJson("/api/workspace/" + encodeURIComponent(businessId) + "/billing");
    if (!enabled || (!checkoutEnabled && !subscription)) {
      subtitle.textContent = "Kartla 14 günlük deneme henüz açık değil.";
      notify("iyzico canlı ödeme ve abonelik onayı tamamlanınca bu ekrandan güvenle başlayabilirsiniz. Şu anda kart bilgisi alınmıyor.");
      return;
    }
    subtitle.textContent = business.name + " işletmesinin aboneliği";
    if (subscription && (subscription.state !== "failed" || !checkoutEnabled)) {
      current.hidden = false;
      const state = subscription.state === "canceled" ? "Abonelik iptal edildi" : subscription.trial ? "Deneme etkin" : subscription.tier === "profesyonel" ? "Profesyonel etkin" : "Abonelik durumu: " + subscription.state;
      stateText.textContent = [state, subscription.trialStartedAt ? "Deneme başlangıcı: " + pretty(subscription.trialStartedAt) : "",
        subscription.trialUntil ? "Deneme bitişi: " + pretty(subscription.trialUntil) : "",
        subscription.trial && subscription.state === "active" ? "İlk tahsilat: " + amount[subscription.plan] + ", " + pretty(subscription.trialUntil) + " (Türkiye saati)" : "",
        subscription.state === "canceled" ? "Otomatik yenileme kapalı." : "",
        ["creating", "checkout", "pending"].includes(subscription.state) ? "Kart işlemi henüz doğrulanmadı. İşlemi tamamlayamadıysanız destekle iletişime geçin." : "",
        subscription.paidUntil ? "Ödenmiş dönem bitişi: " + pretty(subscription.paidUntil) : ""].filter(Boolean).join(" · ");
      cancel.hidden = !["active", "canceling"].includes(subscription.state);
      cancel.disabled = false;
      cancel.textContent = subscription.state === "canceling" ? "İptal durumunu kontrol et" : "Aboneliği iptal et";
      cancel.onclick = async () => {
        if (!confirm("Aboneliği iptal etmek istediğinize emin misiniz? İptal sonrası yeniden deneme hakkı verilmez.")) return;
        cancel.disabled = true;
        try {
          await getJson("/api/workspace/" + encodeURIComponent(businessId) + "/billing", {
            method: "POST", headers: { "Content-Type": "application/json", "Origin": location.origin },
            body: JSON.stringify({ action: "cancel", id: subscription.id })
          });
          notify("İptal talebiniz iyzico tarafından işleme alındı.");
          await load();
        } catch (error) { notify(error.message, true); cancel.disabled = false; }
      };
      return;
    }
    document.querySelector("#businessId").value = businessId;
    document.querySelector("#requestId").value = crypto.randomUUID();
    form.hidden = false;
    notify("14 gün boyunca abonelik ücreti alınmaz. Deneme bitmeden iptal etmezseniz seçtiğiniz dönem tutarı kartınızdan tahsil edilir.");
    form.addEventListener("submit", () => {
      document.querySelector("#submit").disabled = true;
      document.querySelector("#submit").textContent = "iyzico kart formu hazırlanıyor…";
    }, { once: true });
    document.querySelector("#plan").addEventListener("change", (event) => {
      notify("14 gün sonra iptal edilmemiş abonelik için " + amount[event.target.value] + " otomatik tahsil edilir.");
    });
  } catch (error) {
    subtitle.textContent = "Abonelik durumu alınamadı.";
    notify(error.message || "Bilinmeyen hata.", true);
  }
}
load();
