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
const returned = params.has("returned");
const management = document.querySelector("#billing-management");
management.href = subscriptionDestination(null, business);
const delays = [2000, 4000, 8000, 12000, 20000];
let standardWithoutTrial = false;
let polls = 0;
let timer;
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

function scheduleCheck() {
  if (polls < delays.length) {
    timer = setTimeout(() => load(++polls % 2 === 1), delays[polls]);
  } else {
    status.textContent += " Otomatik kontrol tamamlandı. Güncel durum için sayfayı yenileyebilirsiniz.";
  }
}

async function load(reconcile = false) {
  clearTimeout(timer);
  try {
    if (!business) return await chooseBusiness();
    const result = reconcile ? await request(path, "POST", { action: "reconcile" }) : await request(path);
    const { enabled, launch: offer, subscription, verified, usedTrial, canManage } = result;
    if (!enabled) {
      status.textContent = "Polar ödemeleri bu ortamda kapalı.";
      return;
    }
    const state = subscription?.state;
    const attempt = params.get("attempt");
    const matchingReturn = returned && subscription && (!attempt || subscription.id === attempt);
    const currentPeriod = subscription?.paidUntil || subscription?.trialUntil;
    portal.hidden = !canManage;
    management.hidden = !returned;
    actions.hidden = returned || Boolean(subscription && !subscription.closed && state !== "open");
    for (const button of actions.querySelectorAll("[data-offer]")) {
      button.hidden = Boolean(state === "open" && subscription.offer !== button.dataset.offer);
    }
    launch.hidden = !offer;
    standardWithoutTrial = Boolean(usedTrial);
    if (usedTrial) document.querySelector("#standard-terms").textContent =
      "Standart abonelik 999 TL/ay. Bu işletme deneme hakkını kullandı; ücretli dönem hemen başlar.";
    if (verified && matchingReturn && !["past_due", "unpaid"].includes(state)) {
      location.replace("/app.html?business=" + encodeURIComponent(business) + "#overview");
    } else if (state === "canceling" && verified) {
      status.textContent = "Yenileme iptal edildi. Erişiminiz " + day.format(currentPeriod) + " tarihinde sona erer.";
    } else if (["past_due", "unpaid", "failed"].includes(state)) {
      status.textContent = "Ödeme doğrulanamadı. Ödeme yönteminizi kontrol edin." +
        (verified ? " Önceki ödenmiş döneminiz " + day.format(currentPeriod) + " tarihine kadar geçerli." : "");
    } else if (verified) {
      status.textContent = (subscription.trialUntil ? "Kartlı deneme bitişi" : "Ödenmiş dönem sonu") +
        " · " + day.format(currentPeriod) + ". Yenileme bilgilerini Polar panelinde görebilirsiniz.";
    } else if (subscription?.closed) {
      status.textContent = state === "canceled" ? "Abonelik sona erdi." : "Bu ödeme oturumu veya abonelik dönemi sona erdi.";
    } else if (state === "refunded") {
      status.textContent = "Bu dönemin ödemesi iade edildi. Ayrıntıları Polar müşteri panelinde görebilirsiniz.";
    } else if (matchingReturn) {
      status.textContent = "Ödemeniz doğrulanıyor. Bu işlem için tekrar ödeme başlatmayın.";
      scheduleCheck();
    } else if (returned) {
      status.textContent = "Bu dönüş için doğrulanmış bir ödeme bulunamadı. Abonelik ekranından işletmenizin durumunu kontrol edin.";
    } else if (state === "open") {
      status.textContent = "Bu işletmede açık bir ödeme oturumu var. Aynı oturuma devam edebilirsiniz.";
    } else if (!actions.hidden && selectedOffer === "launch" && !offer) {
      status.textContent = "Lansman teklifi sona erdi. İsterseniz standart aboneliği seçebilirsiniz.";
    } else if (!actions.hidden && selectedOffer) {
      status.textContent = "Seçtiğiniz teklifle devam etmek için ödeme ekranını açın.";
    } else {
      status.textContent = "Doğrulanmış aktif dönem bulunamadı.";
    }
  } catch (error) {
    if (error.status === 401) showAuth();
    else {
      status.textContent = error.status ? error.message : "Bağlantı kesildi. Ödeme durumu şu anda doğrulanamıyor.";
      if (returned && ![403, 404].includes(error.status)) scheduleCheck();
    }
  }
}

for (const button of buttons) {
  button.addEventListener("click", async () => {
    for (const control of buttons) control.disabled = true;
    try {
      const offer = button.dataset.offer;
      const body = button === portal ? { action: "portal" } :
        { action: "checkout", offer, withoutTrial: offer === "standard" && standardWithoutTrial };
      const result = await request(path, "POST", body);
      location.assign(result.url);
    } catch (error) {
      if (error.status === 401) showAuth();
      else status.textContent = error.status ? error.message : "Bağlantı kesildi. Abonelik durumunu kontrol edip tekrar deneyin.";
      for (const control of buttons) control.disabled = false;
    }
  });
}
window.addEventListener("pagehide", () => clearTimeout(timer));
window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});
load();
