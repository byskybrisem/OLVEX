import { HttpError } from "./http.js";

const COOKIE = "olvex_session";
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();

export async function sha256(value) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function sessionCookie(token, maxAge) {
  const options = `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return maxAge === undefined ? options : `${options}; Max-Age=${maxAge}`;
}

export async function sessionHash(request) {
  const match = (request.headers.get("Cookie") || "").split(";")
    .map((value) => value.trim()).find((value) => value.startsWith(`${COOKIE}=`));
  const token = match?.slice(COOKIE.length + 1) || "";
  return TOKEN_PATTERN.test(token) ? sha256(token) : null;
}

export async function requireUser(request, db) {
  const hash = await sessionHash(request);
  const user = hash && await db.prepare(`
    SELECT u.id, u.email, u.full_name
    FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(hash, new Date().toISOString()).first();

  if (!user) throw new HttpError(401, "Oturumunuz sona erdi. Tekrar giriş yapın.");
  return user;
}
