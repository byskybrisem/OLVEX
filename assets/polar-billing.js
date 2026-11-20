const params = new URLSearchParams(location.search);
const business = params.get("business");
const status = document.querySelector("#billing-status");
const actions = document.querySelector("#billing-actions");
const launch = document.querySelector("#billing-launch");
const portal = document.querySelector("#billing-portal");
const buttons = [...document.querySelectorAll("main button")];
const path = "/api/workspace/" + encodeURIComponent(business) + "/polar";
const day = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" });

async function request(body) {
  const response = await fetch(path, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  } : undefined);
  if (response.status === 401) throw new Error("Abonelik bilgileri için OLVEX hesabınıza giriş yapın.");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Abonelik işlemi tamamlanamadı.");
  return result;
}

async function load() {
  if (!business) {
    status.textContent = "Panelde bir işletme seçip abonelik ekranına dönün.";
    return;
  }
  try {
    const { enabled, launch: offer, subscription } = await request();
    if (!enabled) {
      status.textContent = "Polar ödemeleri bu ortamda kapalı.";
      return;
    }
    actions.hidden = Boolean(subscription && !subscription.closed && subscription.state !== "open");
    for (const button of actions.querySelectorAll("[data-offer]")) {
      button.hidden = Boolean(subscription?.state === "open" && subscription.offer !== button.dataset.offer);
    }
    launch.hidden = !offer;
    portal.hidden = !subscription?.canManage;
    const now = Date.now();
    if (subscription?.paidUntil > now) status.textContent = `Ödenmiş dönem ${day.format(subscription.paidUntil)} tarihinde sona erer.`;
    else if (subscription?.trialUntil > now) status.textContent = `Doğrulanmış deneme ${day.format(subscription.trialUntil)} tarihinde sona erer.`;
    else if (params.has("returned")) status.textContent = "Polar’dan döndünüz. Erişim, bildirim doğrulandıktan sonra açılır. Durumu görmek için sayfayı yenileyin.";
    else if (subscription?.state === "past_due" || subscription?.state === "unpaid") status.textContent = "Ödeme doğrulanamadı. Ödeme yönteminizi Polar müşteri panelinde kontrol edin.";
    else status.textContent = "Doğrulanmış aktif dönem bulunamadı.";
  } catch (error) {
    status.textContent = error.message;
  }
}

for (const button of buttons) {
  button.addEventListener("click", async () => {
    for (const control of buttons) control.disabled = true;
    try {
      const result = await request(button === portal ? { action: "portal" } : { action: "checkout", offer: button.dataset.offer });
      location.assign(result.url);
    } catch (error) {
      status.textContent = error.message;
      for (const control of buttons) control.disabled = false;
    }
  });
}
load();
