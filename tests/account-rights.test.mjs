import assert from "node:assert/strict";
import { test } from "node:test";
import { randomToken, sha256 } from "../functions/_lib/session.js";
import { localPages } from "./local.mjs";

test("hesap hakları güvenli istek ve yönetici inceleme akışı", async t => {
  const adminId="11111111-1111-4111-8111-111111111111";
  const userId="22222222-2222-4222-8222-222222222222";
  const tokenAdmin=randomToken();
  const tokenUser=randomToken();
  const seed=`
    INSERT INTO users(id,email,full_name) VALUES ('${adminId}','admin@example.test','Yönetici'),('${userId}','customer@example.test','Müşteri');
    INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES
      ('${crypto.randomUUID()}','${adminId}','${await sha256(tokenAdmin)}','2099-01-01T00:00:00.000Z'),
      ('${crypto.randomUUID()}','${userId}','${await sha256(tokenUser)}','2099-01-01T00:00:00.000Z');
  `;
  const srv=await localPages({seed,bindings:{OLVEX_SUPER_ADMIN_USER_ID:adminId}});
  t.after(()=>srv.close());
  const rights=async({token=tokenUser,method="GET",payload,origin=srv.url}={})=>fetch(srv.url+"/api/account-rights",{
    method,headers:{...(token?{Cookie:"olvex_session="+token}:{}),...(method==="POST"?{"Origin":origin,"Content-Type":"application/json"}:{})},
    body:method==="POST"?JSON.stringify(payload):undefined
  });
  const admin=async({token=tokenAdmin,method="GET",payload}={})=>fetch(srv.url+"/api/admin/rights",{
    method,headers:{Cookie:"olvex_session="+token,...(method==="POST"?{Origin:srv.url,"Content-Type":"application/json"}:{})},
    body:method==="POST"?JSON.stringify(payload):undefined
  });
  assert.equal((await rights({token:null})).status,401);
  assert.equal((await rights({method:"POST",payload:{kind:"close"}})).status,400);
  assert.equal((await rights({method:"POST",payload:{kind:"access"},origin:"https://evil.example.test"})).status,403);
  const submitted=await rights({method:"POST",payload:{kind:"close",confirmed:true}});
  assert.equal(submitted.status,201);
  const item=(await submitted.json()).item;
  assert.equal((await rights({method:"POST",payload:{kind:"close",confirmed:true}})).status,200);
  assert.equal((await admin({token:tokenUser})).status,403);
  assert.deepEqual((await (await rights({token:tokenAdmin})).json()).rows,[]);
  const listed=await (await admin()).json();
  assert.equal(listed.rows.length,1);
  assert.equal(listed.rows[0].id,item.id);
  assert.equal(listed.rows[0].email,"customer@example.test");
  assert.equal((await admin({method:"POST",payload:{action:"responded",id:item.id,confirmed:false}})).status,400);
  assert.equal((await admin({method:"POST",token:tokenUser,payload:{action:"responded",id:item.id,confirmed:true}})).status,403);
  assert.equal((await admin({method:"POST",payload:{action:"responded",id:item.id,confirmed:true}})).status,200);
  assert.equal((await admin({method:"POST",payload:{action:"responded",id:item.id,confirmed:true}})).status,409);
  assert.ok((await (await rights()).json()).rows[0].processed_at);
});
