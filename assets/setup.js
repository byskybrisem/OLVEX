import { request } from "./ui.js";
import { subscriptionDestination, subscriptionOffer } from "./subscription-route.js";

const form = document.querySelector("#businessForm");
const input = document.querySelector("#businessName");
const submit = document.querySelector("#submitButton");
const message = document.querySelector("#message");
const params = new URLSearchParams(location.search);
const offer = subscriptionOffer(params.get("offer"));
const another = params.get("new") === "1";
const login = offer ? "/login.html?next=" + offer : "/login.html";
let lastName;
let requestId;

if (another) {
  document.querySelector("h1").textContent = "Yeni işletme ekle";
  submit.textContent = "İşletmeyi oluştur";
}

request("/api/businesses").then((data) => {
  if (data.businesses.length && !another) location.replace(offer ? subscriptionDestination(offer) : "/app.html");
  else submit.disabled = false;
}).catch((error) => {
  if (error.status === 401) location.replace(login);
  else message.textContent = error.message;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  const name = input.value.trim();
  if (name !== lastName) {
    lastName = name;
    requestId = crypto.randomUUID();
  }
  submit.disabled = true;
  message.textContent = "";
  try {
    const result = await request("/api/businesses", "POST", { name, requestId });
    location.replace(offer ? subscriptionDestination(offer, result.business.id) :
      `/app.html?business=${encodeURIComponent(result.business.id)}`);
  } catch (error) {
    if (error.status === 401) location.replace(login);
    else message.textContent = error.message;
    submit.disabled = false;
  }
});
