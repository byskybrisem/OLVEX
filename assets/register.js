import { request } from "./ui.js";

const form = document.querySelector("#registerForm");
const name = form.querySelector("#name");
const email = form.querySelector("#email");
const password = form.querySelector("#password");
const confirmation = form.querySelector("#confirmPassword");
const toggle = form.querySelector("#togglePassword");
const terms = form.querySelector("#terms");
const submit = form.querySelector('[type="submit"]');
const subtitle = document.querySelector(".subtitle");
const title = document.querySelector("#form-title");
const message = document.querySelector("#message");
const restart = document.querySelector("#restart");
const joining = new URLSearchParams(location.search).get("next") === "join";
const token = location.hash.slice(1);
if (location.hash) history.replaceState(null, "", location.pathname + location.search);
if (joining) {
  document.querySelector("#login-link").href = "/login.html?next=join";
  restart.querySelector("a").href = "/register.html?next=join";
}

let termsVersion;
let requestingEmail = false;
let submitLabel;

function status(text, error = true) {
  message.hidden = false;
  message.classList.toggle("error", error);
  message.textContent = text;
}

function showField(input, visible) {
  input.disabled = !visible;
  input.closest(".field, .agreement").hidden = !visible;
}

subtitle.textContent = "Kayıt seçenekleri yükleniyor…";
request("/api/public-info").then((info) => {
  if (!info.registrationOpen) {
    subtitle.hidden = true;
    title.textContent = "Yeni hesap kaydı şu anda kapalı.";
    document.querySelector("#closed-registration").hidden = false;
    return;
  }
  if (token && (!info.emailVerificationRequired || !/^[A-Za-z0-9_-]{43}$/.test(token))) {
    subtitle.hidden = true;
    status("Bu doğrulama bağlantısı geçersiz.");
    restart.hidden = false;
    return;
  }
  termsVersion = info.termsVersion;
  requestingEmail = info.emailVerificationRequired && !token;
  for (const input of [name, password, confirmation, terms]) showField(input, !requestingEmail);
  showField(email, !token);
  if (requestingEmail) {
    submitLabel = "Doğrulama bağlantısı gönder";
    subtitle.textContent = "E-posta adresinize kayıt işlemini tamamlayabileceğiniz bir bağlantı göndereceğiz.";
  } else if (token) {
    title.textContent = "Hesabınızı tamamlayın.";
    submitLabel = "Doğrula ve hesap oluştur";
    subtitle.textContent = "E-posta adresinizi doğrulamak için adınızı girin ve hesabınızın şifresini belirleyin.";
    restart.hidden = false;
  } else {
    subtitle.textContent = "Başlamak için birkaç bilgi yeterli.";
    submitLabel = "Ücretsiz Hesap Oluştur";
  }
  form.hidden = false;
  submit.textContent = submitLabel;
  submit.disabled = false;
}).catch((error) => {
  subtitle.hidden = true;
  status(error.message);
});

toggle.addEventListener("click", () => {
  const visible = password.type === "password";
  password.type = confirmation.type = visible ? "text" : "password";
  toggle.textContent = visible ? "Gizle" : "Göster";
  toggle.setAttribute("aria-pressed", String(visible));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled || !termsVersion) return;
  if (!requestingEmail && password.value !== confirmation.value) {
    status("Girdiğiniz şifreler eşleşmiyor.");
    confirmation.focus();
    return;
  }
  submit.disabled = true;
  submit.textContent = requestingEmail ? "Bağlantı isteniyor…" : "Hesap oluşturuluyor…";
  message.hidden = true;
  try {
    if (requestingEmail) {
      await request("/api/auth/register", "POST", { email: email.value.trim(), joining });
      status("Bu adresle yeni hesap kaydı yapılabiliyorsa doğrulama bağlantısı gönderilir. Gelen kutunuzu ve spam klasörünü kontrol edin. Bağlantı 30 dakika geçerlidir. Mevcut bir hesabınız varsa giriş yapabilir veya şifrenizi sıfırlayabilirsiniz.", false);
      submitLabel = "Bağlantıyı yeniden gönder";
    } else {
      const details = { fullName: name.value.trim(), password: password.value, acceptedTerms: terms.checked, termsVersion };
      await request("/api/auth/register", "POST", token ? { ...details, action: "confirm", token } : { ...details, email: email.value.trim() });
      form.reset();
      location.replace(joining ? "/login.html?registered=1&next=join" : "/login.html?registered=1");
    }
  } catch (error) {
    status(error.message || "Kayıt tamamlanamadı.");
  } finally {
    submit.disabled = false;
    submit.textContent = submitLabel;
  }
});
