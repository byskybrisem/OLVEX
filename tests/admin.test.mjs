import assert from "node:assert/strict";
import { test } from "node:test";
import { randomToken, sha256 } from "../functions/_lib/session.js";
import { passwordHash } from "../functions/_lib/password.js";
import { today } from "../functions/_lib/validate.js";
import { localPages } from "./local.mjs";

test("super admin is strictly isolated; platform income/expenses are auditable and not customer sales", async t => {
  const adminId = "11111111-1111-4111-8111-111111111111";
  const customerId = "22222222-2222-4222-8222-222222222222";
  const businessId = "33333333-3333-4333-8333-333333333333";
  const adminToken = randomToken();
  const customerToken = randomToken();
  const seed = `
    INSERT INTO users(id,email,full_name) VALUES
      ('${adminId}','platform-admin@example.test','Platform Yöneticisi'),
      ('${customerId}','tenant@example.test','İşletme Sahibi');
    INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES
      ('${crypto.randomUUID()}','${adminId}','${await sha256(adminToken)}','2099-01-01T00:00:00.000Z'),
      ('${crypto.randomUUID()}','${customerId}','${await sha256(customerToken)}','2099-01-01T00:00:00.000Z');
    INSERT INTO businesses(id,name,created_by) VALUES ('${businessId}','Müşteri İşletmesi','${customerId}');
    INSERT INTO business_members(id,business_id,user_id,role) VALUES ('${crypto.randomUUID()}','${businessId}','${customerId}','owner');
    INSERT INTO olvex_cash_entries(business_id,id,kind,description,amount_minor,occurred_on,created_by)
      VALUES ('${businessId}','${crypto.randomUUID()}','income','Müşteri kendi tahsilatı',99990000,'${today()}','${customerId}');
  `;
  const srv = await localPages({ seed, bindings: { OLVEX_SUPER_ADMIN_USER_ID: adminId } });
  t.after(() => srv.close());
  const call = async (section, { method="GET", body, token=adminToken, status=200, origin=srv.url, query="" } = {}) => {
    const r = await fetch(srv.url + "/api/admin/" + section + query, {
      method, headers: {
        ...(token === null ? {} : { Cookie: `olvex_session=${token}` }),
        ...(method === "POST" ? {Origin: origin, "Content-Type": "application/json"} : {})
      }, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const d = await r.json();
    assert.equal(r.status,status,JSON.stringify(d));
    assert.equal(r.headers.get("Cache-Control"),"no-store");
    assert.match(r.headers.get("Content-Security-Policy"), /default-src 'none'/);
    return d;
  };

  const adminHtml = await fetch(srv.url + "/admin.html");
  assert.equal(adminHtml.status, 200);
  assert.match(await adminHtml.text(),/CONTROL CENTER/);
  await call("overview",{token:null,status:401});
  for (const section of ["me", "overview", "businesses", "users", "subscriptions", "ai", "finance", "system"]) {
    await call(section, { token: customerToken, status: 403 });
  }
  await call("finance",{method:"POST", token:customerToken, status:403,body:{action:"create"}});
  const me=await call("me");
  assert.equal(me.user.email,"platform-admin@example.test");
  const initial=await call("overview");
  assert.equal(initial.counts.users,2);
  assert.equal(initial.counts.businesses,1);
  assert.equal(initial.finance.income,0,"Customer cash must not enter operator revenue.");
  assert.equal(initial.finance.expense,0);
  assert.equal(initial.counts.loggedInUsers,2);
  const businessList=await call("businesses");
  assert.equal(businessList.rows[0].members,1);
  const userList=await call("users");
  assert.equal(userList.rows.length,2);
  assert.equal(userList.rows[0].password_hash,undefined);
  const subscriptionList=await call("subscriptions");
  assert.equal(subscriptionList.rows.length,0);
  const ai=await call("ai");
  assert.deepEqual(ai.models,[]);
  const system=await call("system");
  assert.equal(system.db,"connected");
  assert.match(system.migration.name,/0017_polar_billing/);

  const id=crypto.randomUUID();
  const income={action:"create",requestId:id,kind:"income",description:"Hizmet danışmanlığı",
    category:"Diğer",amountMinor:102550,occurredOn:today()};
  await call("finance",{method:"POST",body:income,status:403,origin:"https://evil.example"});
  await call("finance",{method:"POST",body:{...income,amountMinor:-100},status:400});
  await call("finance",{method:"POST",body:{...income,occurredOn:"2026-13-40"},status:400});
  await call("finance",{method:"POST",body:income});
  await call("finance",{method:"POST",body:income});
  await call("finance",{method:"POST",body:{...income,amountMinor:777},status:409});
  let ledger=await call("finance");
  assert.equal(ledger.totals.income,102550);
  assert.equal(ledger.totals.expense,0);
  assert.equal(ledger.rows.length,1);
  assert.equal(ledger.rows[0].description,"Hizmet danışmanlığı");
  const expenseId=crypto.randomUUID();
  await call("finance",{method:"POST",body:{action:"create",requestId:expenseId,kind:"expense",
    description:"Alan adı",category:"Altyapı",amountMinor:1250,occurredOn:today()}});
  ledger=await call("finance");
  assert.equal(ledger.totals.expense,1250);
  assert.equal(ledger.totals.net,101300);
  assert.equal(ledger.days.at(-1).income,102550);
  assert.equal(ledger.days.at(-1).expense,1250);
  await call("finance",{method:"POST",body:{action:"void",id:expenseId}});
  await call("finance",{method:"POST",body:{action:"void",id:expenseId},status:409});
  ledger=await call("finance");
  assert.equal(ledger.totals.income,102550);
  assert.equal(ledger.totals.expense,0);
  assert.equal(ledger.rows.find(row=>row.id===expenseId).voided_at!==null,true);
  const audits=await call("system");
  assert.equal(audits.recent.length,3);
  assert.equal(audits.recent.filter(row=>row.action==="ledger_create").length,2);
  assert.equal(audits.recent.filter(row=>row.action==="ledger_void").length,1);
});

test("unconfigured super-admin ID fails closed without exposing any platform data", async t => {
  const u="11111111-1111-4111-8111-111111111111",token=randomToken();
  const server=await localPages({ seed:`
    INSERT INTO users(id,email,full_name) VALUES ('${u}','x@example.test','Deneme');
    INSERT INTO user_sessions(id,user_id,token_hash,expires_at)
      VALUES ('${crypto.randomUUID()}','${u}','${await sha256(token)}','2099-01-01T00:00:00.000Z');
  ` });
  t.after(()=>server.close());
  const result=await fetch(server.url+"/api/admin/overview",{headers:{Cookie:`olvex_session=${token}`}});
  assert.equal(result.status,503);
  assert.doesNotMatch(JSON.stringify(await result.json()),/businesses|users|income/);
});

test("sign-in identifies only the configured platform admin, without trusting a browser role", async t => {
  const superId="11111111-1111-4111-8111-111111111111";
  const otherId="22222222-2222-4222-8222-222222222222";
  const password="OLVEX-Safe-Test-Password-2026!";
  const hash=await passwordHash(password);
  const seed=`
    INSERT INTO users(id,email,full_name,password_hash) VALUES
    ('${superId}','admin-login@example.test','Super Admin','${hash}'),
    ('${otherId}','tenant-login@example.test','Regular User','${hash}');
  `;
  const server=await localPages({seed,bindings:{OLVEX_SUPER_ADMIN_USER_ID:superId}});
  t.after(()=>server.close());
  async function signIn(email) {
    const response=await fetch(server.url+"/api/auth/login",{
      method:"POST",
      headers:{"Content-Type":"application/json",Origin:server.url},
      body:JSON.stringify({email,password,remember:true})
    });
    assert.equal(response.status,200);
    return { result: await response.json(), cookie: response.headers.get("Set-Cookie") };
  }
  const admin = await signIn("admin-login@example.test");
  assert.deepEqual(admin.result, { success: true, isPlatformAdmin: true });
  assert.doesNotMatch(admin.cookie, /Max-Age/);
  const customer = await signIn("tenant-login@example.test");
  assert.deepEqual(customer.result, { success: true, isPlatformAdmin: false });
  assert.match(customer.cookie, /Max-Age=2592000/);

  const [sessions] = await server.query("SELECT user_id, unixepoch(expires_at) - unixepoch(created_at) AS lifetime FROM user_sessions ORDER BY user_id");
  assert.ok(sessions[0].lifetime > 0 && sessions[0].lifetime <= 3600);
  assert.equal(sessions[1].lifetime, 2592000);

  const oldToken = randomToken();
  await server.query("INSERT INTO user_sessions(id,user_id,token_hash,expires_at,created_at) VALUES " +
    "('old-admin','" + superId + "','" + await sha256(oldToken) + "','2099-01-01T00:00:00Z','2020-01-01 00:00:00')");
  const headers = { Cookie: "olvex_session=" + oldToken };
  assert.equal((await fetch(server.url + "/api/auth/me", { headers })).status, 200);
  assert.equal((await fetch(server.url + "/api/admin/me", { headers })).status, 401);
  assert.equal((await fetch(server.url + "/api/admin/finance", {
    method: "POST", headers: { ...headers, Origin: server.url, "Content-Type": "application/json" },
    body: "{}"
  })).status, 401);
});
