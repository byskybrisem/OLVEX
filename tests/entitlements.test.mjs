import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { randomToken, sha256 } from "../functions/_lib/session.js";
import { today } from "../functions/_lib/validate.js";
import { localPages } from "./local.mjs";

test("Paket yetkileri, D1 limitleri ve abonelik geçişleri", { timeout: 120_000 }, async t => {
  const users = ["owner", "other", "invitee"];
  const userIds = Object.fromEntries(users.map(user => [user, randomUUID()]));
  const tokens = Object.fromEntries(users.map(user => [user, randomToken()]));
  const seed = (await Promise.all(users.map(async user => [
    "INSERT INTO users (id,email) VALUES ('" + userIds[user] + "','" + user + "@example.test');",
    "INSERT INTO user_sessions (id,user_id,token_hash,expires_at) VALUES ('" + user + "','" + userIds[user] + "','" +
      await sha256(tokens[user]) + "','2099-01-01T00:00:00Z');"
  ].join("\n")))).join("\n");
  const local = await localPages({ seed, bindings: { OLVEX_BILLING: "sandbox" } });
  t.after(() => local.close());
  const business = randomUUID();
  const outside = randomUUID();
  const request = async (path, body, user = "owner", secret) => {
    const response = await fetch(local.url + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: { Origin: local.url, "Content-Type": "application/json", Cookie: "olvex_session=" + tokens[user],
        ...(secret ? { Authorization: "Bearer olvex_pos_" + secret } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, data: await response.json() };
  };
  function expect(result, status) {
    assert.equal(result.status, status, JSON.stringify(result.data));
    return result.data;
  }
  const workspace = (section, body, user, id = business) => request("workspace/" + id + "/" + section, body, user);
  const read = async (section, status = 200, user, id) => expect(await workspace(section, null, user, id), status);
  const write = async (section, action, body, status = 200, user) =>
    expect(await workspace(section, { requestId: randomUUID(), ...body, action }, user), status);
  const inviteBody = (email, role = "member") => ({ action: "invite", requestId: randomUUID(), email, role, secret: randomToken() });

  const setup = { requestId: business, name: "Paket işletmesi" };
  const competing = { requestId: randomUUID(), name: "Eşzamanlı işletme" };
  expect(await request("businesses", setup), 201);
  expect(await request("businesses", setup), 201);
  const otherSetup = { requestId: outside, name: "Diğer işletme" };
  const creations = await Promise.all([request("businesses", otherSetup, "other"), request("businesses", competing, "other")]);
  assert.deepEqual(creations.map(result => result.status).sort(), [201, 409]);
  const secondBusiness = creations.find(result => result.status === 201).data.business.id;
  await read("package", 404, "other");
  await read("billing", 404, "other");
  const otherBranch = (await read("locations", 200, "other", secondBusiness)).rows[0].id;
  const defaultBranch = (await read("locations")).rows[0].id;
  const inactive = await read("package");
  assert.equal(inactive.tier, "inactive");
  assert.equal(inactive.limits, null);
  assert.equal(inactive.billingAvailable, false);
  assert.deepEqual(inactive.counts, { branches: 1, users: 1, invitations: 0 });
  assert.equal((await read("billing")).enabled, false);
  await write("billing", "checkout", { plan: "esnaf-monthly" }, 503);
  assert.equal((await read("ai?chat=1")).mode, "off");

  const forbidden = [
    ["products", "save"], ["products", "bulk"], ["sales", "create"], ["sales", "import"],
    ["stock", "adjust"], ["finance", "create"], ["locations", "create"], ["transfers", "create"],
    ["settings", "invite"], ["settings", "rename"], ["customers", "save"],
    ["ai", "ask"], ["ai", "send"], ["ai", "apply"], ["ai", "rename"], ["ai", "remove"]
  ];
  for (const [section, action] of forbidden) {
    const result = await write(section, action, { plan: "profesyonel-yearly", paid: true }, 403);
    assert.match(result.error, /Aktif aboneliğiniz bulunmuyor/);
  }
  assert.deepEqual((await read("sales")).rows, []);
  assert.deepEqual((await read("products")).rows, []);

  const future = Date.now() + 86_400_000;
  const change = (plan, state = "active", paidUntil = future) => local.query(
    "UPDATE olvex_subscriptions SET plan='" + plan + "',state='" + state + "',paid_until=" + paidUntil + " WHERE id='sandbox'");
  await local.query("INSERT INTO olvex_subscriptions (id,business_id,environment,plan,plan_ref,state,provider_ref,customer_ref,paid_until) " +
    "VALUES ('sandbox','" + business + "','sandbox','esnaf-monthly','fixture-plan','active','sub','customer'," + future + ")");
  assert.equal((await read("package")).tier, "esnaf");
  assert.deepEqual((await read("package")).limits, { businesses: 1, branches: 1, users: 2 });
  await write("locations", "create", { name: "Fazla şube", plan: "profesyonel-monthly", paid: true }, 409);
  for (const section of ["employees", "shifts", "pos", "transfers", "reports?branchId=" + defaultBranch]) await read(section, 403);
  await write("pos", "create", { plan: "profesyonel-monthly", branchId: defaultBranch }, 403);
  await write("settings", "invite", inviteBody("manager@example.test", "admin"), 403);
  assert.equal((await read("ai")).mode, "mock");

  const invite = inviteBody("invitee@example.test");
  const attempts = [invite, inviteBody("waiting@example.test")];
  const invited = await Promise.all(attempts.map(body => workspace("settings", body)));
  assert.deepEqual(invited.map(result => result.status).sort(), [200, 409]);
  const winner = attempts[invited.findIndex(result => result.status === 200)];
  assert.deepEqual((await read("package")).counts, { branches: 1, users: 1, invitations: 1 });
  if (winner !== invite) {
    await write("settings", "revoke-invite", { id: winner.requestId });
    expect(await workspace("settings", invite), 200);
  }
  expect(await request("join", { token: invite.secret }, "other"), 400);
  expect(await request("join", { token: invite.secret }, "invitee"), 200);
  expect(await request("join", { token: invite.secret }, "invitee"), 200);
  assert.deepEqual((await read("package", 200, "invitee")).counts, { branches: 1, users: 2, invitations: 0 });
  await write("settings", "invite", inviteBody("blocked@example.test"), 409);
  await write("settings", "member", { userId: userIds.invitee, role: "admin" }, 403);
  await read("reports", 403, "invitee");

  await write("products", "save", { sku: "PLANS", name: "Paket ürünü", price: 100, cost: 50, opening: 10 });
  const csv = { csvMode: "file", branchId: defaultBranch, reference: "CSV-1", date: today(),
    paid: true, lines: [{ sku: "PLANS", unit: 100, quantity: 2 }] };
  assert.equal((await write("sales", "import", csv)).repeated, false);
  assert.equal((await write("sales", "import", csv)).repeated, true);
  assert.equal((await read("reports")).totals.sales, 200);
  assert.equal((await read("products")).rows[0].total_stock, 8);
  assert.deepEqual((await read("csv-sources")).rows, []);

  await change("profesyonel-yearly", "active", "NULL");
  await local.query("UPDATE olvex_subscriptions SET trial_started_at=" + (future - 14 * 86400000) +
    ", trial_until=" + future + " WHERE id='sandbox'");
  assert.equal((await read("ai?chat=1")).mode, "mock");
  assert.equal((await read("ai")).mode, "mock");
  assert.deepEqual((await read("package")).limits, { businesses: 1, branches: 5, users: 10 });
  for (let index = 0; index < 3; index++) await write("locations", "create", { name: "Şube " + index });
  const branchResults = await Promise.all(["Kıyı", "Yayla"].map(name =>
    workspace("locations", { action: "create", requestId: randomUUID(), name })));
  assert.deepEqual(branchResults.map(result => result.status).sort(), [200, 409]);
  const locations = (await read("locations")).rows;
  assert.equal(locations.length, 5);
  assert.equal((await read("reports?branchId=" + defaultBranch)).totals.sales, 200);
  assert.equal((await read("reports?branchId=" + locations.find(row => row.id !== defaultBranch).id)).totals.sales, 0);
  await read("reports?branchId=" + otherBranch, 404);
  await write("settings", "member", { userId: userIds.invitee, role: "admin" });
  const pendingAdmin = inviteBody("other@example.test", "admin");
  expect(await workspace("settings", pendingAdmin), 200);
  for (let index = 0; index < 6; index++) await write("settings", "invite", inviteBody("pending" + index + "@example.test"));
  const seats = await Promise.all([7, 8].map(index => workspace("settings", inviteBody("pending" + index + "@example.test"))));
  assert.deepEqual(seats.map(result => result.status).sort(), [200, 409]);
  assert.deepEqual((await read("package")).counts, { branches: 5, users: 2, invitations: 8 });
  await write("settings", "invite", inviteBody("over@example.test"), 409);

  const secret = randomToken();
  const till = await write("pos", "create", { name: "Kasa", branchId: defaultBranch, identityMode: "native", secret });
  const pos = { action: "sale", reference: "POS-1", date: today(), lines: [{ sku: "PLANS", unit: 100, quantity: 1 }] };
  expect(await request("pos", pos, "owner", secret), 201);
  assert.equal(expect(await request("pos", pos, "owner", secret), 200).repeated, true);
  await write("sales", "import", { ...csv, reference: pos.reference, lines: pos.lines }, 409);

  await change("profesyonel-yearly", "canceling");
  await read("employees");
  await write("locations", "create", { name: "Dönem sonuna kadar limit korunur" }, 409);
  await write("settings", "rename", { name: "İptal bekleyen işletme" });
  await local.query("UPDATE olvex_subscriptions SET trial_until=" + (Date.now() - 1) + " WHERE id='sandbox'");
  await change("profesyonel-yearly", "active", Date.now() - 1);
  assert.equal((await read("package")).tier, "inactive");
  expect(await request("pos", { ...pos, reference: "POS-2" }, "owner", secret), 403);
  expect(await request("pos", pos, "owner", secret), 403);
  expect(await request("join", { token: pendingAdmin.secret }, "other"), 403);
  const repeat = { ...csv, action: "import", requestId: randomUUID() };
  const concurrent = await Promise.all([workspace("sales", repeat), workspace("sales", repeat)]);
  assert.deepEqual(concurrent.map(result => result.status), [403, 403]);
  await read("employees");
  assert.equal((await read("pos")).rows[0].id, till.id);
  assert.equal((await read("reports")).totals.sales, 300);
  assert.equal((await read("sales")).rows.length, 2);
  assert.equal((await read("products")).rows[0].total_stock, 7);
  assert.equal((await read("package", 200, "invitee")).counts.users, 2);
  const [paidRows] = await local.query("SELECT COUNT(*) AS n FROM olvex_ai_usage");
  assert.equal(paidRows[0].n, 0);
  for (const state of ["pending", "checkout", "unpaid", "failed", "canceled", "expired"]) {
    await change("profesyonel-yearly", state);
    assert.equal((await read("package")).tier, "inactive");
    await write("products", "save", { paid: true }, 403);
  }
  expect(await workspace("products", { action: "save", businessId: business, paid: true }, "other", secondBusiness), 403);
  await change("esnaf-yearly");
  await write("locations", "create", { name: "Kota aşıldı" }, 409);
  expect(await request("join", { token: pendingAdmin.secret }, "other"), 409);
  assert.equal((await read("settings")).members.find(row => row.id === userIds.invitee).role, "admin");
  assert.deepEqual((await read("package")).counts, { branches: 5, users: 2, invitations: 8 });
  await read("reports?branchId=" + defaultBranch, 403);
  await read("employees", 403);
  assert.equal((await read("csv-sources")).rows[0].id, till.id);
  await read("ai?summary=1");
  assert.equal((await read("products")).rows[0].total_stock, 7);
  const count = await local.query("SELECT COUNT(*) n FROM olvex_pos_connections");
  assert.equal(count[0][0].n, 1);
});
