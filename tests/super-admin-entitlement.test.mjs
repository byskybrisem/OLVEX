import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { randomToken, sha256 } from "../functions/_lib/session.js";
import { today } from "../functions/_lib/validate.js";
import { localPages } from "./local.mjs";

test("yalnızca doğrulanmış Super Admin hesabı aboneliksiz yazma, POS ve AI erişimi alır", { timeout: 120_000 }, async t => {
  const adminId = randomUUID();
  const memberId = randomUUID();
  const otherOwnerId = randomUUID();
  const businessId = randomUUID();
  const otherBusinessId = randomUUID();
  const tokens = { admin: randomToken(), member: randomToken(), other: randomToken() };
  const seed = `
    INSERT INTO users(id,email,full_name) VALUES
      ('${adminId}','vayymatik0@gmail.com','Doğrulanmış yönetici'),
      ('${memberId}','uye@example.test','Aboneliksiz üye'),
      ('${otherOwnerId}','diger@example.test','Diğer işletme sahibi');
    INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES
      ('${randomUUID()}','${adminId}','${await sha256(tokens.admin)}','2099-01-01T00:00:00.000Z'),
      ('${randomUUID()}','${memberId}','${await sha256(tokens.member)}','2099-01-01T00:00:00.000Z'),
      ('${randomUUID()}','${otherOwnerId}','${await sha256(tokens.other)}','2099-01-01T00:00:00.000Z');
    INSERT INTO businesses(id,name,created_by) VALUES
      ('${businessId}','Yönetici işletmesi','${adminId}'),
      ('${otherBusinessId}','Başka işletme','${otherOwnerId}');
    INSERT INTO business_members(id,business_id,user_id,role) VALUES
      ('${randomUUID()}','${businessId}','${adminId}','owner'),
      ('${randomUUID()}','${businessId}','${memberId}','admin'),
      ('${randomUUID()}','${otherBusinessId}','${otherOwnerId}','owner');
  `;
  const local = await localPages({ seed, bindings: {
    OLVEX_BILLING: "sandbox",
    OLVEX_SUPER_ADMIN_USER_ID: adminId
  } });
  t.after(() => local.close());

  const request = async (path, body, token = tokens.admin, extraHeaders = {}) => {
    const response = await fetch(local.url + path, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: local.url,
        "Content-Type": "application/json",
        ...(token ? { Cookie: "olvex_session=" + token } : {}),
        ...extraHeaders
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, data: await response.json() };
  };
  const workspace = (section, body, token = tokens.admin, id = businessId) =>
    request(`/api/workspace/${id}/${section}`, body, token);
  const expect = async (promise, status) => {
    const result = await promise;
    assert.equal(result.status, status, JSON.stringify(result.data));
    return result.data;
  };
  const write = (section, action, values = {}, token = tokens.admin, id = businessId) =>
    workspace(section, { action, requestId: randomUUID(), ...values }, token, id);

  const packageStatus = await expect(workspace("package"), 200);
  assert.equal(packageStatus.exempt, true);
  assert.equal(packageStatus.tier, "profesyonel");
  assert.equal(packageStatus.paidUntil, null);

  const branch = (await expect(workspace("locations"), 200)).rows[0].id;
  const product = await expect(write("products", "save", {
    sku: "SUPER-URUN", name: "Super Admin ürünü", price: 1_000, cost: 500, opening: 10
  }), 200);
  assert.ok(product.id);
  await expect(write("locations", "create", { name: "İkinci şube" }), 200);

  const secret = randomToken();
  const register = await expect(write("pos", "create", {
    name: "Yönetici kasası", branchId: branch, identityMode: "native", secret
  }), 200);
  assert.ok(register.id);
  await expect(request("/api/pos", {
    action: "sale", reference: "SUPER-POS-1", date: today(), paid: true,
    lines: [{ sku: "SUPER-URUN", quantity: 1, unit: 1_000 }]
  }, null, { Authorization: "Bearer olvex_pos_" + secret }), 201);
  const ai = await expect(write("ai", "ask", {
    messages: [{ role: "user", content: "Bugün ne kadar satış yaptım?" }]
  }), 200);
  assert.equal(typeof ai.answer, "string");

  for (const [section, action, values] of [
    ["products", "save", { sku: "ENGEL", name: "Engellenen", price: 100, cost: 50, opening: 1 }],
    ["pos", "create", { name: "Engellenen kasa", branchId: branch, identityMode: "native", secret: randomToken() }],
    ["ai", "ask", { messages: [{ role: "user", content: "Satışlarımı incele" }] }]
  ]) {
    const denied = await expect(write(section, action, values, tokens.member), 403);
    assert.match(denied.error, /Aktif aboneliğiniz bulunmuyor/);
  }

  const otherBranch = (await expect(workspace("locations", null, tokens.other, otherBusinessId), 200)).rows[0].id;
  const otherSecret = randomToken();
  await local.query(`INSERT INTO olvex_pos_connections
    (business_id,id,name,token_hash,created_by,branch_id,identity_mode)
    VALUES ('${otherBusinessId}','${randomUUID()}','Aboneliksiz kasa','${await sha256(otherSecret)}',
      '${otherOwnerId}','${otherBranch}','native')`);
  const posDenied = await expect(request("/api/pos", {
    action: "sale", reference: "ENGELLENEN-POS", date: today(), paid: true, lines: []
  }, null, { Authorization: "Bearer olvex_pos_" + otherSecret }), 403);
  assert.match(posDenied.error, /Aktif aboneliğiniz bulunmuyor/);

  await expect(workspace("products", null, tokens.admin, otherBusinessId), 404);
  await local.query(`UPDATE users SET email = 'farkli@example.test' WHERE id = '${adminId}'`);
  await expect(write("products", "save", {
    sku: "YANLIS-EPOSTA", name: "Yanlış e-posta", price: 100, cost: 50, opening: 1
  }), 403);
  await local.query(`UPDATE users SET email = 'vayymatik0@gmail.com' WHERE id = '${adminId}'`);
  await local.query(`UPDATE user_sessions SET created_at = '2000-01-01T00:00:00.000Z' WHERE user_id = '${adminId}'`);
  await expect(write("products", "save", {
    sku: "ESKI-OTURUM", name: "Eski oturum", price: 100, cost: 50, opening: 1
  }), 403);
  const subscriptions = await local.query("SELECT COUNT(*) AS count FROM olvex_subscriptions");
  assert.equal(subscriptions[0][0].count, 0);
});
