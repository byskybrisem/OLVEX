import { request } from "./ui.js";

const form = document.querySelector("#join-form");
const message = document.querySelector("#message");
const identity = document.querySelector("#identity");
const key = "olvex-pending-invite";
let token = location.hash.slice(1);
const validToken = /^[A-Za-z0-9_-]{43}$/;
try {
  if (validToken.test(token)) {
    sessionStorage.setItem(key, token);
    history.replaceState(null, "", location.pathname);
  } else token = sessionStorage.getItem(key) || "";
} catch {}

function showError(text) {
  message.textContent = text;
  message.hidden = false;
}

request("/api/auth/me").then(({ user }) => {
  identity.textContent = `${user.email} hesabıyla katılıyorsunuz.`;
  form.elements.token.value = validToken.test(token) ? token : "";
  form.hidden = false;
}).catch((error) => {
  identity.textContent = error.status === 401 ? "Davetin gönderildiği e-posta adresine bağlı hesapla giriş yap." : error.message;
  document.querySelector("#signed-out").hidden = error.status !== 401;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector("button");
  if (submit.disabled) return;
  submit.disabled = true;
  message.hidden = true;
  try {
    const data = await request("/api/join", "POST", { token: form.elements.token.value.trim() });
    try { sessionStorage.removeItem(key); } catch {}
    location.replace(`/app.html?business=${encodeURIComponent(data.businessId)}`);
  } catch (error) {
    showError(error.message);
    submit.disabled = false;
  }
});
