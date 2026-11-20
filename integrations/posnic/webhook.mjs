import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { isoTime, objectId } from "./mapping.mjs";

const MAX_BODY = 4096;
const MAX_RECENT = 2048;

export function webhookServer(secret, wake) {
  const recent = new Set();
  return createServer({ requestTimeout: 10_000, headersTimeout: 5_000 }, async (request, response) => {
    const reply = (status) => response.writeHead(status, { "Cache-Control": "no-store" }).end();
    if (request.method !== "POST" || request.url !== "/posnic/webhook") return reply(404);
    const signature = /^sha256=([a-f0-9]{64})$/.exec(request.headers["x-posnic-signature"] ?? "");
    const delivery = request.headers["x-posnic-delivery"];
    if (!signature || !objectId(delivery) || request.headers["x-posnic-event"] !== "change") return reply(401);

    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        length += chunk.length;
        if (length > MAX_BODY) {
          response.setHeader("Connection", "close");
          return reply(413);
        }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      const expected = createHmac("sha256", secret).update(raw).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature[1], "hex"))) return reply(401);
      const payload = JSON.parse(raw);
      if (payload?.event !== "change" || payload.entity !== "sales" || typeof payload.shop !== "string") return reply(400);
      isoTime(payload.at);
    } catch {
      return reply(400);
    }

    // Posnic retries the same signed body. Also deduplicate it if an unsigned
    // delivery header is changed. A periodic scan covers restarts and lost signals.
    const digest = signature[1];
    if (recent.has(digest)) return reply(204);
    if (recent.size === MAX_RECENT) recent.delete(recent.values().next().value);
    recent.add(digest);
    wake();
    return reply(204);
  });
}
