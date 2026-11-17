export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

export function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function handle(handler) {
  return async (context) => {
    try {
      if (!context.env.DB) throw new HttpError(503, "Hizmet şu anda kullanılamıyor.");
      return await handler(context);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status, error.headers);
      console.error("OLVEX API:", new URL(context.request.url).pathname, error.name);
      return json({ error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." }, 500);
    }
  };
}

export function sameOrigin(request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    throw new HttpError(403, "İstek reddedildi.");
  }
}

export async function readJson(request, maxBytes = 32768) {
  const type = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json" || !request.body) throw new HttpError(415, "JSON istek gövdesi gerekli.");
  if (Number(request.headers.get("Content-Length")) > maxBytes) {
    throw new HttpError(413, "İstek çok büyük.");
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "İstek çok büyük.");
      }
      text += decoder.decode(value, { stream: true });
    }
    const data = JSON.parse(text + decoder.decode());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Geçersiz JSON verisi.");
  } finally {
    reader.releaseLock();
  }
}

export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "local";
}

export function isLoopback(request) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
}
