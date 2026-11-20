import { handle, HttpError, json, readJson, sameOrigin } from "../_lib/http.js";
import { requireUser } from "../_lib/session.js";
import { choice } from "../_lib/validate.js";
import { isRateLimited } from "./auth/rate-limit.js";

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env.DB);
  const { results } = await env.DB.prepare(
    "SELECT id, kind, created_at, processed_at FROM olvex_account_rights_requests WHERE user_id = ? ORDER BY processed_at IS NOT NULL, created_at DESC, id DESC LIMIT 50"
  ).bind(user.id).all();
  return json({ rows: results });
});

export const onRequestPost = handle(async ({ request, env }) => {
  sameOrigin(request);
  const user = await requireUser(request, env.DB);
  const body = await readJson(request, 1024);
  const kind = choice(body.kind, ["close", "access", "correction", "erasure", "other"], "Talep türü");
  if (kind === "close" && body.confirmed !== true) throw new HttpError(400, "Hesap kapatma talebini onaylayın.");

  const pending = () => env.DB.prepare(
    "SELECT id, kind, created_at, processed_at FROM olvex_account_rights_requests WHERE user_id = ? AND kind = ? AND processed_at IS NULL"
  ).bind(user.id, kind).first();
  const existing = await pending();
  if (existing) return json({ item: existing });
  if (await isRateLimited(env.DB, "account-rights:" + user.id, 12, 3600)) {
    throw new HttpError(429, "Çok fazla talep gönderildi. Daha sonra tekrar deneyin.", { "Retry-After": "3600" });
  }
  const item = await env.DB.prepare(
    "INSERT INTO olvex_account_rights_requests (id,user_id,kind) VALUES (?,?,?) ON CONFLICT DO NOTHING RETURNING id,kind,created_at,processed_at"
  ).bind(crypto.randomUUID(), user.id, kind).first();
  if (item) return json({ item }, 201);
  const concurrent = await pending();
  if (!concurrent) throw new HttpError(409, "Talep durumu değişti. Sayfayı yenileyin.");
  return json({ item: concurrent });
});
