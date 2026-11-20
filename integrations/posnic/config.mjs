import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { objectId, requireValue } from "./mapping.mjs";
import { date, identifier } from "../../functions/_lib/validate.js";
import { TOKEN_PATTERN } from "../../functions/_lib/session.js";

export function origin(value) {
  requireValue(typeof value === "string", "API adresi gerekli.");
  const url = new URL(value);
  requireValue(!url.username && !url.password && url.pathname === "/" && !url.search && !url.hash,
    "API adresinde yalnızca origin kullanılmalı.");
  requireValue(url.protocol === "https:" || (url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)),
  "API adresi HTTPS veya yerel loopback HTTP olmalı.");
  return url.origin;
}

export async function loadConfig(path, env = process.env) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const posnicToken = env.POSNIC_API_TOKEN;
  const webhookSecret = env.POSNIC_WEBHOOK_SECRET;
  requireValue(typeof posnicToken === "string" && /^posnic_[a-f0-9]{48}$/.test(posnicToken),
    "POSNIC_API_TOKEN eksik veya geçersiz.");
  requireValue(typeof webhookSecret === "string" && /^[a-f0-9]{48}$/.test(webhookSecret),
    "POSNIC_WEBHOOK_SECRET eksik veya geçersiz.");
  requireValue(objectId(raw.posnicLicenseId) && objectId(raw.posnicBranchId), "Posnic lisans ve şube kimlikleri gerekli.");
  requireValue(typeof raw.statePath === "string" && isAbsolute(raw.statePath), "statePath mutlak bir dosya yolu olmalı.");
  requireValue(Number.isInteger(raw.webhookPort) && raw.webhookPort >= 1024 && raw.webhookPort <= 65535,
    "webhookPort 1024–65535 arasında olmalı.");
  requireValue(Array.isArray(raw.registers) && raw.registers.length > 0, "En az bir fiziksel kasa eşleştirin.");
  requireValue(raw.currency === "TRY", "Posnic şube ve aktarım kapsamının para birimi TRY olmalı.");
  requireValue(typeof raw.timeZone === "string" && raw.timeZone.length > 0, "Posnic şube saat dilimi gerekli.");
  const businessId = identifier(raw.olvexBusinessId, "OLVEX işletmesi");
  const branchId = identifier(raw.olvexBranchId, "OLVEX şubesi");
  const routes = new Map();
  const targetIds = new Set();
  for (const entry of raw.registers) {
    const registerId = identifier(entry.olvexRegisterId, "OLVEX kasası");
    requireValue(objectId(entry.posnicRegisterId) && !routes.has(entry.posnicRegisterId) && !targetIds.has(registerId),
      "Posnic fiziksel kasa kimlikleri ve OLVEX kasaları bire bir eşleşmeli.");
    requireValue(typeof entry.tokenEnv === "string" && /^OLVEX_POS_TOKEN_[A-Z0-9_]+$/.test(entry.tokenEnv),
      "Kasa anahtarı için OLVEX_POS_TOKEN_ ile başlayan bir ortam değişkeni adı gerekli.");
    const token = env[entry.tokenEnv];
    requireValue(typeof token === "string" && token.startsWith("olvex_pos_") && TOKEN_PATTERN.test(token.slice(10)),
      "Bir OLVEX kasa anahtarı eksik veya geçersiz.");
    routes.set(entry.posnicRegisterId, { businessId, branchId, registerId, token });
    targetIds.add(registerId);
  }
  return {
    posnicOrigin: origin(raw.posnicOrigin), olvexOrigin: origin(raw.olvexOrigin),
    sourceLicense: raw.posnicLicenseId, sourceBranch: raw.posnicBranchId, businessId, branchId,
    startOn: date(raw.startOn), timeZone: raw.timeZone,
    posnicToken, webhookSecret, port: raw.webhookPort, statePath: raw.statePath, routes,
  };
}
