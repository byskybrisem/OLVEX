import { handle, HttpError } from "../../_lib/http.js";
import { platformAdminId, requireUser } from "../../_lib/session.js";

// TEMPORARY PAYMENT TEST — delete this route, its landing CTA and odeme-testi.html after verification.
// Does not grant subscriptions, discounts or application access.
const CHECKOUT_URL = "https://buy.polar.sh/polar_cl_dnUbIoDK0BoT8vAkiH2zpEcyaTrKfQfLnLAYj2Px2Iy";

export const onRequestGet = handle(async ({ request, env }) => {
  const adminId = platformAdminId(env);
  if (!adminId) throw new HttpError(404, "Test ödeme sayfası kullanılamıyor.");
  const user = await requireUser(request, env.DB);
  if (user.id.toLowerCase() !== adminId) throw new HttpError(404, "Test ödeme sayfası kullanılamıyor.");

  return new Response(null, {
    status: 302,
    headers: {
      Location: CHECKOUT_URL,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    }
  });
});
