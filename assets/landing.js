import { subscriptionDestination } from "./subscription-route.js";

// Each preview remains a normal anchor and section when JavaScript is unavailable.
const tour = document.querySelector(".tour-tabs");
const tabs = [...tour.querySelectorAll("a")];
const panels = tabs.map(tab => document.getElementById(tab.hash.slice(1)));

let tourInRange = !("IntersectionObserver" in window);
function loadPreview(index) {
  const image = panels[index].querySelector(".preview template");
  if (image) image.replaceWith(image.content);
}

function selectPreview(index) {
  if (tourInRange) loadPreview(index);
  tabs.forEach((tab, position) => {
    const active = position === index;
    tab.tabIndex = active ? 0 : -1;
    tab.setAttribute("aria-selected", String(active));
    panels[position].hidden = !active;
  });
}

tour.setAttribute("role", "tablist");
tabs.forEach((tab, index) => {
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-controls", panels[index].id);
  panels[index].setAttribute("role", "tabpanel");
  panels[index].setAttribute("aria-labelledby", tab.id);
  tab.addEventListener("click", event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectPreview(index);
  });
  tab.addEventListener("keydown", event => {
    let next;
    switch (event.key) {
      case "ArrowLeft": next = (index - 1 + tabs.length) % tabs.length; break;
      case "ArrowRight": next = (index + 1) % tabs.length; break;
      case "Home": next = 0; break;
      case "End": next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    selectPreview(next);
    tabs[next].focus();
  });
});

const menu = document.querySelector("#site-menu");
const menuButton = menu.querySelector("summary");
menu.addEventListener("toggle", () => {
  menuButton.setAttribute("aria-label", menu.open ? "Menüyü kapat" : "Menüyü aç");
});
document.addEventListener("click", event => {
  if (menu.open && (!menu.contains(event.target) || event.target.closest("a"))) menu.open = false;
});
document.addEventListener("keydown", event => {
  if (menu.open && event.key === "Escape") {
    menu.open = false;
    menuButton.focus();
  }
});

function openDestination() {
  const destination = document.getElementById(location.hash.slice(1));
  if (destination?.matches("details")) destination.open = true;
  const index = panels.indexOf(destination);
  if (index >= 0) {
    selectPreview(index);
    destination.scrollIntoView({block: "start"});
  }
}
selectPreview(0);
if (!tourInRange) {
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    tourInRange = true;
    loadPreview(tabs.findIndex(tab => tab.getAttribute("aria-selected") === "true"));
    observer.disconnect();
  }, {rootMargin: "180px"});
  observer.observe(document.querySelector(".tour-frame"));
}
openDestination();
window.addEventListener("hashchange", openDestination);

const lira = new Intl.NumberFormat("tr-TR");
const moneyLabel = kurus => lira.format(kurus / 100) + " TL";
const monthlyPrice = document.querySelector("#monthly-price");
const trialTitle = document.querySelector("#trial-title");
const fallbackPrice = monthlyPrice.textContent;
const fallbackTrial = trialTitle.textContent;

function showPricing(pricing) {
  const standard = pricing?.standard;
  const launch = pricing?.launch;
  const standardPrice = standard ? moneyLabel(standard.monthlyKurus) : fallbackPrice;
  const launchBadge = document.querySelector("#launch-badge");
  const regularPrice = document.querySelector("#regular-price");
  const launchTerms = document.querySelector("#launch-terms");
  for (const element of [launchBadge, regularPrice, launchTerms]) element.hidden = !launch;

  trialTitle.textContent = standard ? `${standard.trialDays} gün ücretsiz deneme` : fallbackTrial;
  const launchPrice = launch ? moneyLabel(launch.discountedKurus) : null;
  monthlyPrice.textContent = launchPrice ?? standardPrice;
  if (!launch) return;

  const renewalPrice = moneyLabel(launch.monthlyKurus);
  regularPrice.querySelector("del").textContent = standardPrice + "/ay";
  launchTerms.textContent = `Sınırlı süreli teklif. İlk ${launch.discountedPeriods} ücretli ay ${launchPrice}/ay, sonrasında ${renewalPrice}/ay. Bu teklifte deneme yoktur.`;
}

function showPricingAction(info) {
  const action = document.querySelector("#pricing-cta");
  const availability = document.querySelector("#billing-availability");
  const trialDetails = document.querySelector("#trial-details");
  const launch = info?.pricing?.olvex?.launch;
  const enabled = info?.polarCheckoutEnabled === true;
  const registrationClosed = info?.registrationOpen === false;

  action.href = enabled ? subscriptionDestination(launch ? "launch" : "standard") :
    registrationClosed ? "/login.html" : "/register.html";
  action.textContent = enabled
    ? (launch ? moneyLabel(launch.discountedKurus) + "/ay — Satın Al" : "14 Gün Ücretsiz Dene")
    : (registrationClosed ? "Giriş Yap" : "Ücretsiz Hesap Oluştur");
  availability.hidden = enabled;
  if (enabled) action.removeAttribute("aria-describedby");
  else action.setAttribute("aria-describedby", availability.id);
  availability.textContent = "Ücretli abonelik tahsilatı şu anda kapalıdır." +
    (registrationClosed ? " Yeni hesap kaydı da kapalıdır." : "");
  trialDetails.textContent = enabled ? "Standart abonelikte deneme için ödeme kartı gerekir." :
    "Standart abonelikte tahsilat açıldığında sunulacak. Deneme için ödeme kartı gerekecek.";
}

// The registration page checks the same server setting again before submission.
async function showPublicInfo() {
  try {
    const response = await fetch("/api/public-info", {credentials: "omit"});
    if (!response.ok) throw new Error("Public information is unavailable.");
    const info = await response.json();
    showPricing(info.pricing?.olvex);
    showPricingAction(info);
    if (info.registrationOpen !== false) return;
    for (const label of document.querySelectorAll("[data-signup-label]")) label.textContent = "Kayıt durumu";
    document.querySelector(".hero [data-signup-label]").textContent = "Yeni kayıtlar kapalı";
    document.querySelector("#start-title").textContent = "OLVEX panelini inceleyin.";
    document.querySelector("#baslayin p").textContent = "Yeni hesap kayıtları şu anda kapalı. Panelin inceleme sürümünü giriş yapmadan görüntüleyebilirsiniz.";
    const action = document.querySelector("#baslayin .button");
    action.href = "/demo.html#overview";
    action.querySelector("[data-signup-label]").textContent = "Paneli incele";
  } catch {
    showPricing();
    showPricingAction();
  }
}
showPublicInfo();
window.addEventListener("pageshow", event => {
  if (event.persisted) showPublicInfo();
});
