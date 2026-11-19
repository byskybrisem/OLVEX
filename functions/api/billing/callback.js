import { confirmCheckout, requireBilling } from "../../_lib/billing.js";
import { handle, HttpError } from "../../_lib/http.js";
import { identifier } from "../../_lib/validate.js";

export const onRequestPost = handle(async ({ request, env }) => {
  const config = requireBilling(env);
  const type = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded" || !request.body) throw new HttpError(415, "Ödeme formu gerekli.");
  let body = "";
  let size = 0;
  const decoder = new TextDecoder();
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > 4096) throw new HttpError(413, "Ödeme formu çok büyük.");
    body += decoder.decode(chunk, { stream: true });
  }
  const fields = new URLSearchParams(body + decoder.decode());
  if (fields.getAll("token").length !== 1) throw new HttpError(400, "Ödeme formu belirteci gerekli.");
  const id = identifier(new URL(request.url).searchParams.get("id"));
  await confirmCheckout(env.DB, config, id, fields.get("token"));
  return new Response(null, { status: 303, headers: { Location: "/app.html#settings", "Cache-Control": "no-store" } });
});
