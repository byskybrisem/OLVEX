import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { onRequestPost as changePassword } from "../functions/api/auth/password-change.js";
import { onRequestGet as currentUser, onRequestPost as updateProfile } from "../functions/api/auth/me.js";
import { passwordHash, verifyPassword } from "../functions/_lib/password.js";
import { randomToken, sha256 } from "../functions/_lib/session.js";

test("şifre değiştirme oturum ve eski sıfırlama bağlantılarını geçersizleştirir", async t => {
  const dir = await mkdtemp(join(tmpdir(), "olvex-password-change-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, "wrangler.json");
  await writeFile(configPath, JSON.stringify({
    name: "olvex-account-security", compatibility_date: "2025-10-01",
    d1_databases: [{ binding: "DB", database_name: "security-test", database_id: crypto.randomUUID() }]
  }));
  const runtime = await getPlatformProxy({ configPath, persist: false, remoteBindings: false });
  t.after(() => runtime.dispose());
  const db = runtime.env.DB;
  const sql = await readFile(new URL("../migrations/0001_auth.sql", import.meta.url), "utf8");
  await db.batch(unstable_splitSqlQuery(sql).map(part => db.prepare(part)));

  const old = "eski şifrem en az onbeş";
  const next = "yeni şifrem farklı ve uzun";
  const token = randomToken();
  const otherToken = randomToken();
  const unrelatedToken = randomToken();
  await db.batch([
    db.prepare("INSERT INTO users (id,email,password_hash) VALUES (?,?,?)")
      .bind("u1", "owner@example.test", await passwordHash(old)),
    db.prepare("INSERT INTO users (id,email,password_hash) VALUES (?,?,?)")
      .bind("u2", "other@example.test", await passwordHash("farklı hesap şifresi")),
    db.prepare("INSERT INTO user_sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,'2099-01-01T00:00:00Z')")
      .bind("session1", "u1", await sha256(token)),
    db.prepare("INSERT INTO user_sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,'2099-01-01T00:00:00Z')")
      .bind("session2", "u1", await sha256(otherToken)),
    db.prepare("INSERT INTO user_sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,'2099-01-01T00:00:00Z')")
      .bind("session3", "u2", await sha256(unrelatedToken)),
    db.prepare("INSERT INTO olvex_password_resets (token_hash,user_id,expires_at) VALUES (?,?,'2099-01-01T00:00:00Z')")
      .bind(await sha256(randomToken()), "u1")
  ]);

  const origin = "https://panel.example.test";
  const invoke = async (payload, cookie = token, csrf = origin) => changePassword({
    env: { DB: db }, request: new Request(origin + "/api/auth/password-change", {
      method: "POST",
      headers: { Origin: csrf, Cookie: "olvex_session=" + cookie, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  });
  const me = async tokenValue => currentUser({ env: { DB: db },
    request: new Request(origin + "/api/auth/me", { headers: { Cookie: "olvex_session=" + tokenValue } }) });
  const rename = (fullName, cookie = token, csrf = origin) => updateProfile({ env: { DB: db },
    request: new Request(origin + "/api/auth/me", { method: "POST",
      headers: { Origin: csrf, Cookie: "olvex_session=" + cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, id: "u2", email: "unused@example.test" }) }) });
  assert.equal((await rename(" A ")).status, 400);
  assert.equal((await rename("Yeni Ad", randomToken())).status, 401);
  assert.equal((await rename("Yeni Ad", token, "https://other.example.test")).status, 403);
  assert.equal((await rename(" Yeni Ad ")).status, 200);
  const renamed = (await (await me(token)).json()).user;
  assert.equal(renamed.fullName, "Yeni Ad");
  assert.equal(renamed.email, "owner@example.test");
  assert.notEqual((await (await me(unrelatedToken)).json()).user.fullName, "Yeni Ad");
  const body = { currentPassword: old, newPassword: next };
  assert.equal((await invoke(body, token, "https://other.example.test")).status, 403);
  assert.equal((await invoke({ currentPassword: "yanlış ama uzun şifre", newPassword: next })).status, 400);
  assert.equal((await invoke({ currentPassword: old, newPassword: "kısa" })).status, 400);
  assert.equal((await invoke({ currentPassword: old, newPassword: old })).status, 400);
  assert.equal((await me(token)).status, 200);

  const response = await invoke(body);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, reloginRequired: true });
  assert.match(response.headers.get("Set-Cookie"), /Max-Age=0/);
  const updated = await db.prepare("SELECT password_hash FROM users WHERE id = 'u1'").first();
  assert.equal(await verifyPassword(next, updated.password_hash), true);
  assert.equal(await verifyPassword(old, updated.password_hash), false);
  assert.equal((await me(token)).status, 401);
  assert.equal((await me(otherToken)).status, 401);
  assert.equal((await me(unrelatedToken)).status, 200);
  assert.equal(await db.prepare("SELECT COUNT(*) FROM olvex_password_resets WHERE user_id='u1'").first("COUNT(*)"), 0);
  assert.equal((await invoke(body)).status, 401);
});
