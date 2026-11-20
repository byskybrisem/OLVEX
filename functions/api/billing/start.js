import { beginCheckout, requireBilling } from "../../_lib/billing.js";
import { handle, HttpError, isPreviewRequest, sameOrigin } from "../../_lib/http.js";
import { OWNER, workspace } from "../../_lib/workspace.js";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export const onRequestPost = handle(async ({ request, env }) => {
  sameOrigin(request);
  const config = requireBilling(env);
  if (config.environment === "sandbox" && !isPreviewRequest(env, request)) {
    throw new HttpError(403, "Canlı alan adında test ödemesi başlatılamaz.");
  }
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    throw new HttpError(415, "Ödeme formu gönderimi gerekli.");
  }
  if (Number(request.headers.get("Content-Length")) > 8192) throw new HttpError(413, "Form çok büyük.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Ödeme formu eksik.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 8192) { await reader.cancel(); throw new HttpError(413, "Form çok büyük."); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally { reader.releaseLock(); }
  const form = new URLSearchParams(raw);
  const single = key => form.getAll(key).length === 1 ? form.get(key) : null;
  const businessId = single("businessId");
  if (!businessId || !/^[a-zA-Z0-9_-]{1,100}$/.test(businessId)) throw new HttpError(400, "Geçerli işletme gerekli.");
  const ctx = await workspace({ request, env, params: { businessId } }, OWNER);
  const values = {};
  for (const key of ["requestId", "plan", "name", "surname", "identityNumber", "gsmNumber", "city", "address"]) {
    values[key] = single(key);
  }
  values.acceptedBillingTerms = single("acceptedBillingTerms") === "true";
  if (!values.acceptedBillingTerms) throw new HttpError(400, "Abonelik ve otomatik yenileme koşullarını kabul edin.");

  const started = await beginCheckout(ctx, values);
  if (started.state !== "checkout" || !started.checkoutFormContent) {
    throw new HttpError(409, "Mevcut abonelik işlemi bulundu. İşletme ayarlarından durumu kontrol edin.");
  }
  const content = started.checkoutFormContent;
  if (content.length > 400_000 || !/<script(?:\s|>)/i.test(content)) {
    throw new HttpError(502, "iyzico kart formu beklenen biçimde değil.");
  }
  const nonce = crypto.randomUUID().replace(/-/g, "");
  // iyzico returns its official bootstrap script. Permit that script only on this dedicated checkout response.
  const trusted = content.replace(/<script(?=\s|>)/gi, '<script nonce="' + nonce + '"');
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'nonce-" + nonce + "' https://*.iyzipay.com",
    "connect-src 'self' https://*.iyzipay.com",
    "img-src 'self' data: https://*.iyzipay.com",
    "style-src 'self' 'unsafe-inline' https://*.iyzipay.com",
    "frame-src https://*.iyzipay.com",
    "form-action 'self' https://*.iyzipay.com",
    "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'"
  ].join("; ");
  const html = '<!doctype html><html lang="tr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">' +
    '<title>iyzico Kart Doğrulama | OLVEX</title><link rel="stylesheet" href="/assets/tokens.css">' +
    '<link rel="stylesheet" href="/assets/public.css"></head><body><main class="shell">' +
    '<header><a class="brand" href="/billing.html?businessId=' + encodeURIComponent(businessId) + '">OLVEX</a></header>' +
    '<section class="card"><h1>Güvenli kart doğrulama</h1>' +
    '<p>14 günlük denemede abonelik ücreti alınmaz. İptal etmezseniz seçtiğiniz dönem sonunda ' +
    escapeHtml(values.plan === "profesyonel-monthly" ? "999 TL/ay" : "9.590,40 TL/yıl") +
    ' abonelik ücreti otomatik tahsil edilir. iyzico kart doğrulaması için geçici 1 TL çekip iade edebilir.</p>' +
    '<div id="iyzipay-checkout-form" class="responsive"></div>' + trusted +
    '</section></main></body></html>';
  return new Response(html, { status: 200, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": policy
  } });
});
