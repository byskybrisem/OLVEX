import { request } from "./ui.js";

const password = document.querySelector("#password");
const confirmation = document.querySelector("#confirmPassword");
const toggle = document.querySelector("#togglePassword");
const form = document.querySelector("#registerForm");
const message = document.querySelector("#message");
const terms = document.querySelector("#terms");
const submit = form.querySelector('[type="submit"]');
const joining = new URLSearchParams(location.search).get("next") === "join";
let termsVersion;

function status(text) {
  message.hidden = false;
  message.textContent = text;
}

if (joining) document.querySelector("#login-link").href = "/login.html?next=join";

request("/api/public-info").then((info) => {
  if (!info.registrationOpen) {
    status("Yeni hesap kaydı şu anda kapalı.");
    return;
  }
  termsVersion = info.termsVersion;
  submit.disabled = false;
}).catch((error) => status(error.message));

toggle.addEventListener("click", () => {
  const visible = password.type === "password";
  password.type = confirmation.type = visible ? "text" : "password";
  toggle.textContent = visible ? "Gizle" : "Göster";
  toggle.setAttribute("aria-pressed", String(visible));
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled || !termsVersion) return;
  if (password.value !== confirmation.value) {
    status("Girdiğiniz şifreler eşleşmiyor.");
    confirmation.focus();
    return;
  }

  submit.disabled = true;
  submit.textContent = "Hesap oluşturuluyor…";
  message.hidden = true;
  try {
    await request("/api/auth/register", "POST", {
      fullName: document.querySelector("#name").value.trim(),
      email: document.querySelector("#email").value.trim(),
      password: password.value, acceptedTerms: terms.checked, termsVersion
    });
    form.reset();
    location.replace(joining ? "/login.html?registered=1&next=join" : "/login.html?registered=1");
  } catch (error) {
    status(error.message || "Kayıt tamamlanamadı.");
    submit.disabled = false;
    submit.textContent = "Ücretsiz Hesap Oluştur";
  }
});
