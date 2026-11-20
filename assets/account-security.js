import { request } from "./ui.js";

const form = document.querySelector("#password-change-form");
const status = document.querySelector("#account-email");
const message = document.querySelector("#password-message");

function showMessage(value, error = false) {
  message.hidden = false;
  message.classList.toggle("error", error);
  message.textContent = value;
}

async function load() {
  try {
    const result = await request("/api/auth/me");
    status.textContent = result.user.fullName
      ? result.user.fullName + " · " + result.user.email
      : result.user.email;
    form.hidden = false;
  } catch (error) {
    if (error.status === 401) {
      location.replace("/login.html");
      return;
    }
    status.textContent = "Hesap bilgileri yüklenemedi.";
    showMessage(error.message, true);
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const fields = new FormData(form);
  const currentPassword = String(fields.get("currentPassword") || "");
  const newPassword = String(fields.get("newPassword") || "");
  const confirmation = String(fields.get("confirmation") || "");
  if (newPassword !== confirmation) {
    showMessage("Yeni şifreler eşleşmiyor.", true);
    return;
  }
  if (currentPassword === newPassword) {
    showMessage("Yeni şifre mevcut şifrenizden farklı olmalı.", true);
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  message.hidden = true;
  try {
    await request("/api/auth/password-change", "POST", { currentPassword, newPassword });
    form.reset();
    location.replace("/login.html?password-changed=1");
  } catch (error) {
    showMessage(error.message, true);
    if (error.status === 401) location.replace("/login.html");
    else button.disabled = false;
  }
});

load();
