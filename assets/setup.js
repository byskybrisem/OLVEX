import { request } from "./ui.js";

const form = document.querySelector("#businessForm");
const input = document.querySelector("#businessName");
const submit = document.querySelector("#submitButton");
const message = document.querySelector("#message");
const another = new URLSearchParams(location.search).get("new") === "1";
let lastName;
let requestId;

if (another) {
  document.querySelector("h1").textContent = "Yeni işletme ekle";
  submit.textContent = "İşletmeyi oluştur";
}

request("/api/businesses").then((data) => {
  if (data.businesses.length && !another) location.replace("/app.html");
  else submit.disabled = false;
}).catch((error) => {
  if (error.status === 401) location.replace("/login.html");
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
    // When billing is enabled, begin the card-verified trial after the first business is created.
    let redirect = `/app.html?business=${encodeURIComponent(result.business.id)}`;
    try {
      const status = await request(`/api/workspace/${encodeURIComponent(result.business.id)}/billing`);
      if (status.checkoutEnabled) redirect = `/billing.html?businessId=${encodeURIComponent(result.business.id)}`;
    } catch { /* Preserve the created business even if billing status cannot load. */ }
    location.replace(redirect);
  } catch (error) {
    if (error.status === 401) location.replace("/login.html");
    else message.textContent = error.message;
    submit.disabled = false;
  }
});
