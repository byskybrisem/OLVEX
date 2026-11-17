import { request } from "./ui.js";

const token = location.hash.slice(1);
const requestForm = document.querySelector("#request-form");
const resetForm = document.querySelector("#reset-form");
const message = document.querySelector("#message");
const resetting = /^[A-Za-z0-9_-]{43}$/.test(token);

if (resetting) {
  history.replaceState(null, "", location.pathname);
  requestForm.hidden = true;
  resetForm.hidden = false;
  document.querySelector("#heading").textContent = "Yeni şifre oluştur";
  document.querySelector("#hint").textContent = "Yeni şifren en az 8 karakter olmalı.";
}

function status(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
  message.hidden = false;
}

for (const form of [requestForm, resetForm]) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button");
    if (submit.disabled) return;
    const fields = new FormData(form);
    if (resetting && fields.get("password") !== fields.get("confirmation")) {
      status("Girdiğiniz şifreler eşleşmiyor.", true);
      return;
    }
    submit.disabled = true;
    message.hidden = true;
    try {
      await request("/api/auth/password-reset", "POST", resetting ?
        { action: "reset", token, password: fields.get("password") } :
        { action: "request", email: fields.get("email") });
      if (resetting) location.replace("/login.html?reset=1");
      else {
        status("Bu e-posta adresine bağlı bir hesap varsa sıfırlama bağlantısı gönderilecek.");
        form.reset();
      }
    } catch (error) {
      status(error.message, true);
    } finally {
      submit.disabled = false;
    }
  });
}
