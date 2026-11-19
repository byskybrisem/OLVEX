import { refreshSubscription, requireBilling } from "../../_lib/billing.js";
import { handle, HttpError, json, readJson } from "../../_lib/http.js";
import { verifyWebhook } from "../../_lib/iyzico.js";

export const onRequestPost = handle(async ({ request, env }) => {
  const config = requireBilling(env);
  const event = await readJson(request, 8192);
  if (!await verifyWebhook(config, event, request.headers.get("X-IYZ-SIGNATURE-V3"))) {
    throw new HttpError(403, "iyzico bildirim imzası geçersiz.");
  }
  const row = await env.DB.prepare(`SELECT * FROM olvex_subscriptions
    WHERE environment = ? AND provider_ref = ? AND customer_ref = ?`)
    .bind(config.environment, event.subscriptionReferenceCode, event.customerReferenceCode).first();
  if (!row) throw new HttpError(503, "Abonelik eşleşmesi henüz hazır değil.");
  await refreshSubscription(env.DB, config, row, event);
  return json({ success: true });
});
