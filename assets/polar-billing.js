import { subscriptionDestination, subscriptionOffer } from "./subscription-route.js";
import { request } from "./ui.js";

const params = new URLSearchParams(location.search);
const business = params.get("business");
const selectedOffer = subscriptionOffer(params.get("offer"));
const auth = document.querySelector("#billing-auth");
const businesses = document.querySelector("#billing-businesses");
const status = document.querySelector("#billing-status");
const actions = document.querySelector("#billing-actions");
const launch = document.querySelector("#billing-launch");
const portal = document.querySelector("#billing-portal");
const buttons = [...document.querySelectorAll("main button")];
const path = "/api/workspace/" + encodeURIComponent(business) + "/polar";
const day = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" });

function showAuth() {
  status.textContent = "Abonelik bilgileri için OLVEX hesabınıza giriş yapın.";
  if (selectedOffer) {
    document.querySelector("#billing-login").href = "/login.html?next=" + selectedOffer;
    document.querySelector("#billing-register").href = "/register.html?next=" + selectedOffer;
  }
  auth.hidden = false;
}

async function chooseBusiness() {
  if (!selectedOffer) {
    status.textContent = "Panelde bir işletme seçip abonelik ekranına dönün.";
    return;
  }
  const result = await request("/api/businesses");
  const owned = result.businesses.filter(item => item.role === "owner");
  if (!result.businesses.length) {
    location.replace("/setup.html?offer=" + selectedOffer);
    return;
  }
  status.textContent = owned.length ? "Aboneliği başlatmak istediğiniz işletmeyi seçin." :
    "Abonelik başlatabilmek için bir işletmenin sahibi olmalısınız.";
  for (const item of owned) {
    const link = document.createElement("a");
    link.href = subscriptionDestination(selectedOffer, item.id);
    link.textContent = item.name;
    businesses.append(link);
  }
  if (!owned.length) {
    const link = document.createElement("a");
    link.href = "/setup.html?new=1&offer=" + selectedOffer;
    link.textContent = "İşletme oluştur";
    businesses.append(link);
  }
  businesses.hidden = false;
}

async function load() {
  try {
    if (!business) return await chooseBusiness();
    const { enabled, launch: offer, subscription } = await request(path);
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
    else if (!actions.hidden && selectedOffer === "launch" && !offer) status.textContent = "Lansman teklifi sona erdi. İsterseniz standart aboneliği seçebilirsiniz.";
    else if (!actions.hidden && selectedOffer) {
      const selected = actions.querySelector('[data-offer="' + selectedOffer + '"]');
      status.textContent = "Seçtiğiniz teklifle devam etmek için ödeme ekranını açın.";
      if (!selected.hidden) selected.focus();
    } else status.textContent = "Doğrulanmış aktif dönem bulunamadı.";
  } catch (error) {
    if (error.status === 401) showAuth();
    else status.textContent = error.message;
  }
}

for (const button of buttons) {
  button.addEventListener("click", async () => {
    for (const control of buttons) control.disabled = true;
    try {
      const result = await request(path, "POST", button === portal ? { action: "portal" } : { action: "checkout", offer: button.dataset.offer });
      location.assign(result.url);
    } catch (error) {
      if (error.status === 401) showAuth();
      else status.textContent = error.message;
      for (const control of buttons) control.disabled = false;
    }
  });
}
load();
