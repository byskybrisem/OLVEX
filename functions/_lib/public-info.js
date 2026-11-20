import { accountMailReady } from "./account-mail.js";
import { isPreviewRequest } from "./http.js";
import { publicPricing } from "./pricing.js";
import { recoveryOrigin } from "./recovery.js";

export const TERMS_VERSION = "2026-11-17.1";

export function publicInfo(env, request) {
  const email = env.OLVEX_CONTACT_EMAIL?.trim();
  const operator = env.OLVEX_OPERATOR_NAME?.trim();
  const serviceAddress = env.OLVEX_SERVICE_ADDRESS?.trim();
  const configured = Boolean(operator && serviceAddress && email && /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(email));
  const preview = env.OLVEX_SIGNUPS === "preview" && isPreviewRequest(env, request);
  const mailEnabled = Boolean(accountMailReady(env) && recoveryOrigin(env));
  return {
    registrationOpen: preview || (env.OLVEX_SIGNUPS === "open" && configured && mailEnabled),
    emailVerificationRequired: !preview,
    termsVersion: TERMS_VERSION,
    operator: configured ? operator : null,
    serviceAddress: configured ? serviceAddress : null,
    email: configured ? email : null,
    passwordResetEnabled: mailEnabled,
    pricing: publicPricing(env)
  };
}
