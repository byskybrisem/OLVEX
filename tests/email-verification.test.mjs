import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { onRequestPost as register } from "../functions/api/auth/register.js";
import { onRequestGet as businesses, onRequestPost as createBusiness } from "../functions/api/businesses.js";
import { onRequestPost as login } from "../functions/api/auth/login.js";
import { onRequestPost as recover } from "../functions/api/auth/password-reset.js";
import { accountMailReady, sendAccountMail } from "../functions/_lib/account-mail.js";
import { TERMS_VERSION } from "../functions/_lib/public-info.js";
import { sha256 } from "../functions/_lib/session.js";

const address = "owner@example.test";
const origin = "https://panel.example.test";
const cloudflare = { OLVEX_MAIL_PROVIDER: "cloudflare", OLVEX_EMAIL_ACCOUNT_ID: "1".repeat(32),
  OLVEX_EMAIL_API_TOKEN: "test-only", OLVEX_FROM_EMAIL: "notify@example.test" };
const details = { fullName: "Örnek Kullanıcı", password: "örnek kayıt şifresi", acceptedTerms: true, termsVersion: TERMS_VERSION };

test("açık kayıt ve kurtarma gerçek yerel D1 üzerinde tek kullanımlık posta bağlantılarıyla çalışır", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "olvex-mail-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, "wrangler.json");
  await writeFile(configPath, JSON.stringify({ name: "olvex-mail-test", compatibility_date: "2025-10-01",
    d1_databases: [{ binding: "DB", database_name: "mail-test", database_id: crypto.randomUUID() }] }));
  const runtime = await getPlatformProxy({ configPath, persist: false, remoteBindings: false });
  t.after(() => runtime.dispose());
  const { DB } = runtime.env;
  const migrationDir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(migrationDir)).filter(name => name.endsWith(".sql")).sort()) {
    const source = await readFile(new URL("../migrations/" + file, import.meta.url), "utf8");
    await DB.batch(unstable_splitSqlQuery(source).map(sql => DB.prepare(sql)));
  }
  const env = { DB, ...cloudflare, OLVEX_SIGNUPS: "open", OLVEX_PUBLIC_ORIGIN: origin, OLVEX_OPERATOR_NAME: "Test",
    OLVEX_SERVICE_ADDRESS: "Test adresi", OLVEX_CONTACT_EMAIL: "owner@example.test" };
  const mail = [];
  let deliveryAvailable = true;
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input, options) => {
    if (String(input) !== `https://api.cloudflare.com/client/v4/accounts/${cloudflare.OLVEX_EMAIL_ACCOUNT_ID}/email/sending/send`) {
      // D1's transport may call localhost. No external test traffic is allowed.
      const url = new URL(input?.url ?? input);
      assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
      return realFetch(input, options);
    }
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer test-only");
    if (!deliveryAvailable) return new Response("", { status: 503 });
    const body = JSON.parse(options.body);
    const link = new URL(body.text.match(/https:\/\/\S+/)[0]);
    assert.equal(link.origin, origin);
    assert.match(link.hash, /^#[A-Za-z0-9_-]{43}$/);
    mail.push({ link, body });
    return Response.json({ success: true, result: { message_id: "local", queued: [body.to] } });
  });
  const invoke = async (handler, path, data, expectedStatus) => {
    const pending = [];
    const request = new Request(origin + path, { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const response = await handler({ env, request, waitUntil: promise => pending.push(promise) });
    await Promise.all(pending);
    assert.equal(response.status, expectedStatus, path);
    return response;
  };
  const signup = (data, status) => invoke(register, "/api/auth/register", data, status);
  const signIn = (password, status) => invoke(login, "/api/auth/login", { email: address, password }, status);
  const reset = (data, status) => invoke(recover, "/api/auth/password-reset", data, status);
  const token = () => mail.at(-1).link.hash.slice(1);
  const count = table => DB.prepare(`SELECT count(*) AS n FROM ${table}`).first("n");
  const confirm = (linkToken, extra = {}) => ({ ...details, action: "confirm", token: linkToken, ...extra });

  env.OLVEX_SIGNUPS = "closed";
  await signup({ email: address }, 403);
  assert.equal(await count("olvex_signup_links"), 0);
  assert.equal(mail.length, 0);
  env.OLVEX_SIGNUPS = "open";
  await signup({ email: "geçersiz" }, 400);

  deliveryAvailable = false;
  await signup({ email: address }, 503);
  assert.equal(await count("olvex_signup_links"), 0);
  deliveryAvailable = true;
  const requested = await signup({ email: address, joining: true, password: "request-only password" }, 202);
  assert.deepEqual(await requested.json(), { verificationRequested: true });
  assert.equal(mail[0].body.to, address);
  assert.equal(mail[0].link.search, "?next=join");
  assert.equal(mail[0].link.pathname, "/register.html");
  assert.equal(await count("users"), 0);
  assert.equal(await DB.prepare("SELECT token_hash FROM olvex_signup_links").first("token_hash"), await sha256(token()));
  await signIn(details.password, 401);
  const first = token();
  await signup(confirm(first, { acceptedTerms: false }), 400);
  const results = await Promise.all([202, 400].map(async () => {
    const request = new Request(origin + "/api/auth/register", { method: "POST", headers: {
      Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(confirm(first)) });
    return (await register({ env, request })).status;
  }));
  assert.deepEqual(results.sort(), [202, 400]);
  assert.equal(await count("olvex_terms_acceptances"), 1);
  await signIn("request-only password", 401);
  const session = (await signIn(details.password, 200)).headers.get("set-cookie");
  assert.match(session, /HttpOnly/);
  const cookie = session.split(";")[0];
  const setup = await createBusiness({ env, request: new Request(origin + "/api/businesses", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "İlk İşletme" })
  }) });
  assert.equal(setup.status, 201);
  const { business } = await setup.json();
  assert.equal(business.role, "owner");
  assert.deepEqual(await DB.prepare("SELECT name, is_default FROM olvex_branches WHERE business_id = ?")
    .bind(business.id).first(), { name: "Merkez", is_default: 1 });
  const unauthenticated = await businesses({ env, request: new Request(origin + "/api/businesses") });
  assert.equal(unauthenticated.status, 401);
  assert.equal(await count("user_sessions"), 1);
  const existing = await signup({ email: address }, 202);
  assert.deepEqual(await existing.json(), { verificationRequested: true });
  await signup(confirm(token(), { password: "farklı örnek şifre" }), 202);
  assert.equal(await count("user_sessions"), 1);
  await signIn("farklı örnek şifre", 401);
  await signup({ email: address }, 429);
  assert.equal(mail.length, 2);
  await signup({ email: "second@example.test" }, 202);
  await DB.prepare("UPDATE olvex_signup_links SET expires_at = ?").bind(new Date(0).toISOString()).run();
  env.OLVEX_SIGNUPS = "closed";
  await signup(confirm(token()), 403);
  env.OLVEX_SIGNUPS = "open";
  await signup(confirm(token()), 400);
  assert.equal(await count("users"), 1);

  await reset({ action: "request", email: address }, 200);
  assert.equal(mail.at(-1).link.pathname, "/forgot-password.html");
  const recoveryToken = token();
  const newPassword = "yenilenmiş örnek şifre";
  await reset({ action: "reset", token: recoveryToken, password: newPassword }, 200);
  assert.equal(await count("user_sessions"), 0);
  await reset({ action: "reset", token: recoveryToken, password: newPassword }, 400);
  await signIn(newPassword, 200);
});

test("e-posta sağlayıcısı seçimi ve başarısız teslim durumları", async (t) => {
  assert.equal(accountMailReady({ ...cloudflare, OLVEX_EMAIL_ACCOUNT_ID: "invalid" }), false);
  assert.equal(accountMailReady({ ...cloudflare, OLVEX_MAIL_PROVIDER: "unknown" }), false);
  const resend = { RESEND_API_KEY: "test-only", OLVEX_FROM_EMAIL: "notify@example.test" };
  let accepted = false;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const data = JSON.parse(options.body);
    if (url === "https://api.resend.com/emails") {
      assert.deepEqual(data.to, [address]);
      return Response.json(accepted ? { id: "local-resend" } : {});
    }
    assert.equal(data.to, address);
    return Response.json({ success: true, result: {
      message_id: "local-cloudflare", delivered: accepted ? [address] : [], suppressed_recipients: accepted ? [] : [address]
    } });
  });
  for (const settings of [cloudflare, resend]) {
    accepted = false;
    await assert.rejects(sendAccountMail(settings, address, "Test", "Test"));
    accepted = true;
    await sendAccountMail(settings, address, "Test", "Test");
  }
});
