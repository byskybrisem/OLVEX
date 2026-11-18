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

const billing = document.querySelector("#billing");
const monthly = document.querySelector("#monthly");
const annual = document.querySelector("#annual");
const prices = [...document.querySelectorAll("[data-price]")];
const integerLira = new Intl.NumberFormat("tr-TR", {style: "currency", currency: "TRY", maximumFractionDigits: 0});
const decimalLira = new Intl.NumberFormat("tr-TR", {style: "currency", currency: "TRY"});
function pricePeriod(yearly) {
  monthly.setAttribute("aria-pressed", String(!yearly));
  annual.setAttribute("aria-pressed", String(yearly));
  prices.forEach(price => {
    const amount = Number(price.dataset.price) * (yearly ? 0.8 : 1);
    price.textContent = (Number.isInteger(amount) ? integerLira : decimalLira).format(amount);
  });
}
billing.hidden = false;
monthly.addEventListener("click", () => pricePeriod(false));
annual.addEventListener("click", () => pricePeriod(true));

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
document.querySelectorAll('a[href="#fiyatlandirma"]').forEach(link => {
  link.addEventListener("click", () => { document.querySelector("#fiyatlandirma").open = true; });
});

// The registration page checks the same server setting again before submission.
async function showSignupStatus() {
  try {
    const response = await fetch("/api/public-info", {credentials: "omit"});
    if (!response.ok) return;
    const info = await response.json();
    if (info.registrationOpen !== false) return;
    for (const label of document.querySelectorAll("[data-signup-label]")) label.textContent = "Kayıt durumu";
    document.querySelector(".hero [data-signup-label]").textContent = "Yeni kayıtlar kapalı";
    document.querySelector("#start-title").textContent = "OLVEX’i örnek panelde deneyin.";
    document.querySelector("#baslayin p").textContent = "Yeni hesap kaydı şu anda kapalı. Örnek işletmenin panelini giriş yapmadan inceleyebilirsiniz.";
    const action = document.querySelector("#baslayin .button");
    action.href = "/demo.html#overview";
    action.querySelector("[data-signup-label]").textContent = "Örnek paneli aç";
  } catch {
    // The link still opens the authoritative registration status page offline or on API errors.
  }
}
showSignupStatus();
