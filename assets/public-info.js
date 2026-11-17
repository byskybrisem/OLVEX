import { request } from "./ui.js";

request("/api/public-info").then((info) => {
  const configured = Boolean(info.operator);
  for (const node of document.querySelectorAll("[data-pending]")) node.hidden = configured;
  for (const node of document.querySelectorAll("[data-contact]")) node.hidden = !configured;
  for (const node of document.querySelectorAll("[data-operator]")) node.textContent = info.operator || "";
  for (const node of document.querySelectorAll("[data-address]")) node.textContent = info.serviceAddress || "";
  for (const node of document.querySelectorAll("[data-email]")) {
    node.textContent = info.email || "";
    if (info.email) node.href = `mailto:${info.email}`;
  }
}).catch(() => {
  for (const node of document.querySelectorAll("[data-pending]")) {
    node.textContent = "İletişim bilgileri şu anda yüklenemedi. Sayfayı yenileyin.";
  }
});
