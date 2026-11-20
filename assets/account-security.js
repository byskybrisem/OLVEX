import { request } from "./ui.js";

import { subscriptionDestination } from "./subscription-route.js";

const profile = document.querySelector("#profile-form");
const profileMessage = document.querySelector("#profile-message");
const roles = { owner: "İşletme sahibi", admin: "Yönetici", member: "Üye" };
const day = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" });
const form = document.querySelector("#password-change-form");
const status = document.querySelector("#account-email");
const message = document.querySelector("#password-message");

function showMessage(value, error = false) {
  message.hidden = false;
  message.classList.toggle("error", error);
  message.textContent = value;
}

async function loadBusinesses() {
  const notice = document.querySelector("#membership-status");
  try {
    const { businesses } = await request("/api/businesses");
    notice.textContent = businesses.length ? "" : "Henüz bir işletmeye bağlı değilsiniz.";
    await Promise.all(businesses.map(async business => {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = business.name + " · " + roles[business.role];
      const summary = document.createElement("p");
      item.append(title, summary);
      document.querySelector("#memberships").append(item);
      if (business.role === "owner") {
        const manage = document.createElement("a");
        manage.href = subscriptionDestination(null, business.id);
        manage.textContent = "Abonelik, iptal ve makbuzlar";
        item.append(manage);
      }
      try {
        const plan = await request("/api/workspace/" + encodeURIComponent(business.id) + "/package");
        if (plan.paidUntil) summary.textContent = "Ödenmiş dönem sonu · " + day.format(plan.paidUntil);
        else if (plan.trialUntil) summary.textContent = "Kartlı deneme sonu · " + day.format(plan.trialUntil);
        else summary.textContent = "Aktif abonelik bulunmuyor.";
        if (plan.professional) summary.textContent = "OLVEX Professional · " + summary.textContent;
      } catch {
        summary.textContent = "Abonelik bilgileri yüklenemedi.";
      }
    }));
  } catch {
    notice.textContent = "İşletme bilgileri yüklenemedi.";
  }
}

profile.addEventListener("submit", async event => {
  event.preventDefault();
  const button = profile.querySelector("button");
  if (button.disabled) return;
  button.disabled = true;
  try {
    const result = await request("/api/auth/me", "POST", { fullName: profile.elements.fullName.value });
    profile.elements.fullName.value = result.fullName;
    profileMessage.textContent = "Adınız güncellendi.";
    profileMessage.classList.remove("error");
  } catch (error) {
    profileMessage.textContent = error.message;
    profileMessage.classList.add("error");
  } finally {
    button.disabled = false;
  }
});

async function load() {
  try {
    const result = await request("/api/auth/me");
    status.textContent = result.user.email;
    profile.elements.fullName.value = result.user.fullName || "";
    profile.hidden = false;
    form.hidden = false;
    await loadBusinesses();
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
    location.replace("/login.html?reset=1");
  } catch (error) {
    showMessage(error.message, true);
    if (error.status === 401) location.replace("/login.html");
    else button.disabled = false;
  }
});

load();
