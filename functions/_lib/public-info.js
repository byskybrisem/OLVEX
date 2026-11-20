import { accountMailReady } from "./account-mail.js";
import { isPreviewRequest } from "./http.js";
import { recoveryOrigin } from "./recovery.js";

export const TERMS_VERSION = "2026-11-20.1";

const validEmail = address => /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(address ?? "");

function legalContact(env) {
  const operator = env.OLVEX_OPERATOR_NAME?.trim();
  const serviceAddress = env.OLVEX_SERVICE_ADDRESS?.trim();
  const email = env.OLVEX_CONTACT_EMAIL?.trim();
  const rightsEmail = env.OLVEX_KVKK_EMAIL?.trim();
  const phone = env.OLVEX_CONTACT_PHONE?.trim();
  const kind = env.OLVEX_OPERATOR_KIND?.trim();
  const taxOffice = env.OLVEX_COMPANY_TAX_OFFICE?.trim();
  const taxId = env.OLVEX_COMPANY_TAX_ID?.trim();
  const tradeRegistry = env.OLVEX_TRADE_REGISTRY?.trim();
  const company = kind === "company" && taxOffice && /^\d{10}$/.test(taxId ?? "") && tradeRegistry
    ? { taxOffice, taxId, tradeRegistry } : null;
  return {
    operator, serviceAddress, email,
    rightsEmail: validEmail(rightsEmail) ? rightsEmail : null,
    phone: /^\+[1-9]\d{7,14}$/.test(phone ?? "") ? phone : null,
    configured: Boolean(operator && serviceAddress && validEmail(email)),
    kind, company
  };
}

export function paidLegalReady(env) {
  const contact = legalContact(env);
  return env.OLVEX_PAID_LEGAL_REVIEW === "approved" && contact.configured &&
    Boolean(contact.rightsEmail && contact.phone && (contact.kind === "person" || contact.company));
}

export function publicInfo(env, request) {
  const { configured, operator, serviceAddress, email, rightsEmail, phone, company } = legalContact(env);
  const preview = env.OLVEX_SIGNUPS === "preview" && isPreviewRequest(env, request);
  const mailEnabled = Boolean(accountMailReady(env) && recoveryOrigin(env));
  return {
    registrationOpen: preview || (env.OLVEX_SIGNUPS === "open" && configured && mailEnabled),
    emailVerificationRequired: !preview,
    termsVersion: TERMS_VERSION,
    operator: configured ? operator : null,
    serviceAddress: configured ? serviceAddress : null,
    email: configured ? email : null,
    rightsEmail: configured ? rightsEmail : null,
    phone: configured ? phone : null,
    company: configured ? company : null,
    passwordResetEnabled: mailEnabled
  };
}
