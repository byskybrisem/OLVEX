import { HttpError } from "./http.js";

export function polarClient(config) {
  const origin = config.mode === "sandbox" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh";
  async function call(path, body) {
    const response = await fetch(origin + "/v1/" + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: "Bearer " + config.token, "Polar-Version": "2026-10", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual", signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new HttpError(502, "Polar yanıtı doğrulanamadı.");
    return response.json();
  }
  return {
    checkouts: { create: body => call("checkouts/", body), get: id => call("checkouts/" + id) },
    subscriptions: { get: id => call("subscriptions/" + id) },
    orders: { list: query => call("orders/?" + new URLSearchParams(query)) },
    customerSessions: { create: body => call("customer-sessions/", body) }
  };
}

const encoder = new TextEncoder();

function base64(value) {
  try {
    return Uint8Array.from(atob(value), character => character.charCodeAt(0));
  } catch {
    return null;
  }
}

// Polar signs webhook-id.timestamp.raw-body. Verify both dashboard and whsec_ secrets.
export async function verifyPolarSignature(body, headers, secret, now = Date.now()) {
  const id = headers.get("webhook-id") ?? "";
  const timestamp = headers.get("webhook-timestamp") ?? "";
  const signature = headers.get("webhook-signature") ?? "";
  if (!/^[\w-]{1,160}$/.test(id) || !/^\d{1,12}$/.test(timestamp) || signature.length > 2048 ||
      Math.abs(now / 1000 - Number(timestamp)) > 300) return false;

  const candidates = [encoder.encode(secret), base64(secret.replace(/^whsec_/, ""))].filter(key => key?.length);
  const signed = encoder.encode(`${id}.${timestamp}.${body}`);
  for (const candidate of candidates) {
    const key = await crypto.subtle.importKey("raw", candidate, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    for (const item of signature.split(" ")) {
      if (!item.startsWith("v1,")) continue;
      const bytes = base64(item.slice(3));
      if (bytes?.length === 32 && await crypto.subtle.verify("HMAC", key, bytes, signed)) return true;
    }
  }
  return false;
}
