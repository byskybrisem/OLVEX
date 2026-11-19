import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { onRequestGet, onRequestPost } from "../functions/api/workspace/[businessId]/[section].js";
import { randomToken, sha256 } from "../functions/_lib/session.js";
import { today } from "../functions/_lib/validate.js";

test("AI anahtarsız güvenli kapanır ve sağlayıcıya yalnızca yetkili işletmenin özetini gönderir", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "olvex-ai-"));
  const configPath = join(dir, "wrangler.json");
  await writeFile(configPath, JSON.stringify({ name: "olvex-ai-test", compatibility_date: "2025-10-01",
    d1_databases: [{ binding: "DB", database_name: "ai-test", database_id: crypto.randomUUID() }] }));
  const runtime = await getPlatformProxy({ configPath, persist: false, remoteBindings: false });
  t.after(async () => {
    await runtime.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const { DB } = runtime.env;
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) {
    const source = await readFile(new URL(name, directory), "utf8");
    await DB.batch(unstable_splitSqlQuery(source).map(sql => DB.prepare(sql)));
  }
  const session = randomToken();
  await DB.batch([
    DB.prepare("INSERT INTO users(id,email) VALUES ('u','ai@example.test'),('other','other@example.test')"),
    DB.prepare("INSERT INTO businesses(id,name,created_by) VALUES ('our','Deneme','u'),('private','Ayrı','other')"),
    DB.prepare("INSERT INTO business_members(id,business_id,user_id,role) VALUES ('m','our','u','owner'),('m2','private','other','owner')"),
    DB.prepare("INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES ('s','u',?,'2099-01-01T00:00:00Z')")
      .bind(await sha256(session)),
    DB.prepare(`INSERT INTO olvex_cash_entries(business_id,id,kind,description,amount_minor,occurred_on,created_by)
      VALUES ('our','a','income','Giriş',1200,?,'u'),('private','b','income','Ayrı giriş',99999,?,'other')`).bind(today(), today())
  ]);

  let reply = { answer: "Gider taslağı.", proposal: { kind: "expense", description: "Kırtasiye", amount: 250 } };
  let calls = 0;
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input, options) => {
    if (String(input) !== "https://api.openai.com/v1/responses") {
      assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(input?.url ?? input).hostname));
      return realFetch(input, options);
    }
    calls++;
    const payload = JSON.parse(options.body);
    assert.equal(payload.store, false);
    const summary = JSON.parse(payload.input[0].content.replace("İşletme özeti (JSON): ", ""));
    assert.equal(summary.totals.revenue, 1200);
    return Response.json({ status: "completed", output: [{ type: "message",
      content: [{ type: "output_text", text: JSON.stringify(reply) }] }] });
  });
  const env = { DB, OLVEX_AI_MODE: "mock" };
  const origin = "https://olvex.com.tr";
  const call = async (businessId, body, status) => {
    const request = new Request(`${origin}/api/workspace/${businessId}/ai`, {
      method: body ? "POST" : "GET", headers: { Origin: origin, "Content-Type": "application/json", Cookie: `olvex_session=${session}` },
      body: body ? JSON.stringify(body) : undefined
    });
    const handler = body ? onRequestPost : onRequestGet;
    const response = await handler({ env, request, params: { section: "ai", businessId } });
    assert.equal(response.status, status);
    return response.json();
  };
  const ask = { action: "ask", messages: [{ role: "user", content: "250 kuruş kırtasiye gideri taslağı hazırlayın" }] };
  assert.equal((await call("our", null, 200)).mode, "off");
  await call("our", ask, 503);
  assert.equal(calls, 0);
  env.OPENAI_API_KEY = "fixture";
  await call("private", ask, 404);
  assert.equal(calls, 0);
  const { proposal } = await call("our", ask, 200);
  assert.equal(proposal.amount, 250);
  const expenseCount = () => DB.prepare("SELECT COUNT(*) AS n FROM olvex_cash_entries WHERE business_id = 'our' AND kind = 'expense'").first("n");
  assert.equal(await expenseCount(), 0);
  const approval = { action: "apply", id: proposal.id, requestId: crypto.randomUUID() };
  delete env.OPENAI_API_KEY;
  await call("our", approval, 503);
  assert.equal(await expenseCount(), 0);
  env.OPENAI_API_KEY = "fixture";
  await call("our", approval, 200);
  assert.equal(await expenseCount(), 1);
  reply = null;
  await call("our", ask, 502);
  assert.equal(calls, 2);
});
