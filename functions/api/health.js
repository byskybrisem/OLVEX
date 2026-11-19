import { json } from "../_lib/http.js";

export async function onRequest({ env }) {
  try {
    if (!env.DB) return json({ status: "unavailable" }, 503);
    await env.DB.prepare("SELECT 1").first();
    return json({ status: "ok" });
  } catch {
    return json({ status: "unavailable" }, 503);
  }
}
