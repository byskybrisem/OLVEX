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
  const display = (row, selector, value, scheme) => {
    const container = document.querySelector(row);
    if (!container || !value) return;
    const node = container.querySelector(selector);
    node.textContent = value;
    node.href = scheme + value;
    container.hidden = false;
  };
  display("[data-phone-row]", "[data-phone]", info.phone, "tel:");
  display("[data-rights-row]", "[data-rights-email]", info.rightsEmail, "mailto:");
  const company = document.querySelector("[data-company]");
  if (company && info.company) {
    company.querySelector("[data-tax-office]").textContent = info.company.taxOffice;
    company.querySelector("[data-tax-id]").textContent = info.company.taxId;
    company.querySelector("[data-trade-registry]").textContent = info.company.tradeRegistry;
    company.hidden = false;
  }
}).catch(() => {
  for (const node of document.querySelectorAll("[data-pending]")) {
    node.textContent = "İletişim bilgileri şu anda yüklenemedi. Sayfayı yenileyin.";
  }
});
