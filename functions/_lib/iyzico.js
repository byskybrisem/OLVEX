import { HttpError } from "./http.js";

const encoder = new TextEncoder();
export const reference = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export const plans = Object.freeze({
  "esnaf-monthly": { tier: "esnaf", interval: "MONTHLY", amount: 49900, binding: "IYZICO_ESNAF_MONTHLY" },
  "esnaf-yearly": { tier: "esnaf", interval: "YEARLY", amount: 479040, binding: "IYZICO_ESNAF_YEARLY" },
  "profesyonel-monthly": { tier: "profesyonel", interval: "MONTHLY", amount: 99900, binding: "IYZICO_PROFESYONEL_MONTHLY" },
  "profesyonel-yearly": { tier: "profesyonel", interval: "YEARLY", amount: 959040, binding: "IYZICO_PROFESYONEL_YEARLY" }
});

export function billingConfig(env) {
  if (env.OLVEX_BILLING !== "sandbox" && env.OLVEX_BILLING !== "live") return null;
  const environment = env.OLVEX_BILLING;
  const apiKey = env.IYZICO_API_KEY?.trim();
  const secret = env.IYZICO_SECRET_KEY?.trim();
  const merchantId = env.IYZICO_MERCHANT_ID?.trim();
  let origin;
  try {
    const url = new URL(env.OLVEX_BILLING_ORIGIN);
    if (url.protocol === "https:" && url.href === url.origin + "/") origin = url.origin;
  } catch {}
  const codes = Object.values(plans).map(plan => env[plan.binding]);
  if (!origin || !reference(apiKey) || !secret || !/^\d+$/.test(merchantId ?? "") ||
      !codes.every(reference) || new Set(codes).size !== codes.length) return null;
  return { environment, origin, apiKey, secret, merchantId, env,
    base: environment === "sandbox" ? "https://sandbox-api.iyzipay.com" : "https://api.iyzipay.com" };
}

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function iyzico(config, path, payload) {
  const url = new URL(path, config.base);
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const nonce = crypto.randomUUID();
  const key = await hmacKey(config.secret, "sign");
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(nonce + url.pathname + body));
  const signature = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
  try {
    const response = await fetch(url, {
      method: payload === undefined ? "GET" : "POST",
      headers: {
        Authorization: "IYZWSv2 " + btoa(`apiKey:${config.apiKey}&randomKey:${nonce}&signature:${signature}`),
        "x-iyzi-rnd": nonce, "Content-Type": "application/json"
      },
      body: body || undefined, redirect: "error", signal: AbortSignal.timeout(12000)
    });
    if (response.ok) {
      const result = await response.json();
      if (result?.status === "success" || result?.status === "failure") return result;
    }
  } catch {}
  throw new HttpError(502, "iyzico yanıtı doğrulanamadı.");
}

export async function verifyWebhook(config, body, signature) {
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature) ||
      !["subscription.order.success", "subscription.order.failure"].includes(body.iyziEventType) ||
      ![body.subscriptionReferenceCode, body.orderReferenceCode, body.customerReferenceCode].every(reference) ||
      (body.merchantId != null && String(body.merchantId) !== config.merchantId)) return false;

  const message = config.merchantId + config.secret + body.iyziEventType + body.subscriptionReferenceCode +
    body.orderReferenceCode + body.customerReferenceCode;
  const bytes = Uint8Array.from(signature.match(/../g), byte => parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", await hmacKey(config.secret, "verify"), bytes, encoder.encode(message));
}

export function minorUnits(price) {
  const value = String(price);
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
