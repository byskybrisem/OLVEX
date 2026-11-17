import { HttpError } from "./http.js";

const ITERATIONS = 100000;
const encoder = new TextEncoder();
const dummyHash = "pbkdf2_sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

async function derive(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256"
  }, key, 256);
  return new Uint8Array(bits);
}

export function newPassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new HttpError(400, "Şifre 8 ile 128 karakter arasında olmalı.");
  }
  return value;
}

export async function passwordHash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const buffer = await derive(password, salt);
  return ["pbkdf2_sha256", ITERATIONS, btoa(String.fromCharCode(...salt)), btoa(String.fromCharCode(...buffer))].join("$");
}

export async function verifyPassword(password, storedHash) {
  try {
    const [algorithm, iterations, salt, expected] = (storedHash || dummyHash).split("$");
    if (algorithm !== "pbkdf2_sha256" || Number(iterations) !== ITERATIONS) return false;
    const bytes = Uint8Array.from(atob(salt), (char) => char.charCodeAt(0));
    const expectedBytes = Uint8Array.from(atob(expected), (char) => char.charCodeAt(0));
    if (bytes.length !== 16 || expectedBytes.length !== 32) return false;
    const actual = await derive(password, bytes);
    let difference = 0;
    for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expectedBytes[index];
    return Boolean(storedHash) && difference === 0;
  } catch {
    return false;
  }
}
