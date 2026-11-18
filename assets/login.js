import { request } from "./ui.js";

const password = document.querySelector("#password");
const toggle = document.querySelector("#togglePassword");
const form = document.querySelector("#loginForm");
const message = document.querySelector("#message");
const submit = document.querySelector("#submitButton");
const url = new URL(location.href);
const joining = url.searchParams.get("next") === "join";

function status(text, success = false) {
  message.hidden = false;
  message.classList.toggle("error", !success);
  message.textContent = text;
}

if (joining) document.querySelector("#register-link").href = "/register.html?next=join";
if (url.searchParams.get("registered") === "1") status("Kayıt isteğiniz alındı. Hesabınıza ait e-posta ve şifreyle giriş yapabilirsiniz.", true);
if (url.searchParams.get("reset") === "1") status("Şifreniz güncellendi. Yeni şifrenizle giriş yapın.", true);

toggle.addEventListener("click", () => {
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";
  toggle.textContent = visible ? "Gizle" : "Göster";
  toggle.setAttribute("aria-pressed", String(visible));
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  submit.disabled = true;
  submit.textContent = "Giriş yapılıyor…";
  message.hidden = true;
  try {
    await request("/api/auth/login", "POST", {
      email: document.querySelector("#email").value.trim(),
      password: password.value,
      remember: document.querySelector('input[name="remember"]').checked
    });
    location.replace(joining ? "/join.html" : "/app.html");
  } catch (error) {
    status(error.message || "Giriş yapılamadı.");
    submit.disabled = false;
    submit.textContent = "Giriş Yap";
  }
});
