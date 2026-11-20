import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { onRequestGet, onRequestPost } from "../functions/api/workspace/[businessId]/[section].js";
import { randomToken, sha256 } from "../functions/_lib/session.js";
import { addDays, today } from "../functions/_lib/validate.js";
import { factsForAI } from "../functions/_lib/ai-facts.js";
import { reserveAI } from "../functions/_lib/ai-usage.js";
import { openAIConfig, parseOpenAI, requestOpenAI } from "../functions/_lib/openai.js";

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
    DB.prepare("INSERT INTO olvex_subscriptions (id,business_id,environment,plan,plan_ref,state,provider_ref,customer_ref,paid_until) VALUES ('pro','our','live','profesyonel-monthly','fixture-plan','active','fixture-subscription','fixture-customer',?)").bind(Date.now() + 86400000),
    DB.prepare("INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES ('s','u',?,'2099-01-01T00:00:00Z')")
      .bind(await sha256(session)),
    DB.prepare(`INSERT INTO olvex_cash_entries(business_id,id,kind,description,amount_minor,occurred_on,created_by)
      VALUES ('our','a','income','Giriş',1200,?,'u'),('private','b','income','Ayrı giriş',99999,?,'other')`).bind(today(), today())
  ]);

  let reply = { answer: "Gider taslağı.", proposal: { kind: "expense", description: "Kırtasiye", amount: 250 } };
  let calls = 0;
  let lastPayload;
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input, options) => {
    if (String(input) !== "https://api.openai.com/v1/responses") {
      assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(input?.url ?? input).hostname));
      return realFetch(input, options);
    }
    calls++;
    const payload = JSON.parse(options.body);
    assert.equal(payload.store, false);
    assert.equal(payload.model, "gpt-6-luna");
    assert.equal(payload.reasoning.effort, "medium");
    assert.equal(payload.text.format.strict, true);
    assert.equal(options.redirect, "manual");
    lastPayload = { ...JSON.parse(payload.input[0].content), latest: payload.input[1].content };
    return Response.json({ status: "completed", usage: { input_tokens: 1200, output_tokens: 400,
      input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 },
      output_tokens_details: { reasoning_tokens: 150 } }, output: [{ type: "message",
      content: [{ type: "output_text", text: JSON.stringify(reply) }] }] });
  });
  const env = { DB, OLVEX_AI_MODE: "mock" };
  const origin = "https://olvex.com.tr";
  const call = async (businessId, body, status, section = "ai", token = session) => {
    const request = new Request(`${origin}/api/workspace/${businessId}/${section}`, {
      method: body ? "POST" : "GET", headers: { Origin: origin, "Content-Type": "application/json", Cookie: `olvex_session=${token}` },
      body: body ? JSON.stringify(body) : undefined
    });
    const handler = body ? onRequestPost : onRequestGet;
    const response = await handler({ env, request, params: { section, businessId } });
    assert.equal(response.status, status);
    return response.json();
  };
  const ask = { action: "ask", messages: [{ role: "user", content: "250 kuruş kırtasiye gideri taslağı hazırlayın" }] };
  assert.equal((await call("our", null, 200)).mode, "off");
  await call("our", ask, 503);
  assert.equal(calls, 0);
  env.OPENAI_API_KEY = "fixture";
  assert.equal((await call("our", null, 200)).mode, "off");
  delete env.OLVEX_AI_MODE;
  await call("private", ask, 404);
  assert.equal(calls, 0);
  const { proposal } = await call("our", ask, 200);
  assert.equal(proposal.amount, 250);
  assert.equal(lastPayload.allowedDraft, "expense");
  assert.equal(lastPayload.facts.kind, "draft");

  const cash = { action: "ask", messages: [
    { role: "assistant", content: "Güvenilmeyen geçmiş" + "x".repeat(1200) },
    { role: "user", content: "Bu ay nakit akışım nasıl? özel@example.test" }
  ] };
  const { evidence, proposal: unexpected } = await call("our", cash, 200);
  assert.equal(unexpected, null);
  assert.equal(lastPayload.facts.cash.inflowMinor, 1200);
  assert.equal(lastPayload.facts.from, today().slice(0, 7) + "-01");
  assert.equal(lastPayload.allowedDraft, null);
  assert.equal(lastPayload.history[0].content.length, 650);
  assert.doesNotMatch(lastPayload.latest, /özel@example/);
  assert.match(evidence, /12,00/);
  assert.equal(await DB.prepare("SELECT COUNT(*) n FROM olvex_ai_proposals").first("n"), 1);

  const main = await DB.prepare("SELECT id FROM olvex_branches WHERE business_id = 'our'").first("id");
  const outside = await DB.prepare("SELECT id FROM olvex_branches WHERE business_id = 'private'").first("id");
  await call("our", { ...cash, branchId: outside }, 404);
  assert.equal(calls, 2);
  reply = { answer: "Şubeye ait ödemeler.", proposal: { kind: "none" } };
  const branchCash = await call("our", { ...cash, branchId: main }, 200);
  assert.equal(lastPayload.facts.cash.inflowMinor, 0);
  assert.equal(lastPayload.facts.cash.includesStandaloneEntries, false);
  assert.match(branchCash.evidence, /Şubeye atanmamış/);

  const item = await call("our", { action: "save", requestId: crypto.randomUUID(), sku: "TEST", name: "Kahve",
    opening: 10, branchId: main, price: 500, cost: 600 }, 200, "products");
  assert.ok(item.id);
  await call("our", { action: "create", requestId: crypto.randomUUID(), reference: "FIS", date: today(),
    branchId: main, lines: [{ sku: "TEST", quantity: 2, unit: 500 }], paid: true }, 200, "sales");
  await call("our", { action: "ask", branchId: main, messages: [{ role: "user", content: "Bugün ne kadar satış yaptım?" }] }, 200);
  assert.equal(lastPayload.facts.sales.netSalesMinor, 1000);
  assert.equal(lastPayload.facts.sales.grossProfitMinor, -200);
  assert.equal(lastPayload.facts.from, today());
  assert.equal(lastPayload.facts.to, today());
  assert.ok(!("cash" in lastPayload.facts));
  const { id: coast } = await call("our", { action: "create", requestId: crypto.randomUUID(), name: "İskele" }, 200, "locations");
  await call("our", { action: "adjust", requestId: crypto.randomUUID(), branchId: coast, productId: item.id,
    delta: 5, note: "Şube stoğu" }, 200, "stock");
  await call("our", { action: "create", requestId: crypto.randomUUID(), reference: "DIGER", date: today(),
    branchId: coast, lines: [{ sku: "TEST", quantity: 1, unit: 800 }], paid: true }, 200, "sales");
  const context = { db: DB, businessId: "our", env, request: new Request(origin) };
  const prompt = [{ role: "user", content: "Geçen haftaya göre satışlarım arttı mı?" }];
  const comparison = await factsForAI(context, prompt, { id: main, name: "Merkez" }, null);
  assert.equal(comparison.sales.netSalesMinor, 1000);
  assert.equal(comparison.previousSales.from, addDays(comparison.from, -7));
  assert.equal(comparison.previousSales.to, addDays(comparison.to, -7));
  assert.equal((await factsForAI(context, prompt, null, null)).sales.netSalesMinor, 1800);
  await call("our", { action: "ask", branchId: main, messages: [{ role: "user", content: "Hangi ürünler zarar ettiriyor?" }] }, 200);
  assert.deepEqual(lastPayload.facts.rows, [{ sku: "TEST", name: "Kahve", netQuantity: 2, salesMinor: 1000, grossProfitMinor: -200 }]);
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
  assert.equal(calls, 6);
  const { usage } = await call("our", null, 200);
  assert.equal(usage.models[0].input, 7200);
  assert.equal(usage.models[0].output, 2400);
  assert.equal(usage.models[0].estimatedNanoUsd, 1827000);
  env.OLVEX_OPENAI_DAILY_LIMIT = "7";
  reply = { answer: "Yanıt", proposal: { kind: "none" } };
  const quota = await Promise.all([200, 429].map(async () => {
    const request = new Request(`${origin}/api/workspace/our/ai`, { method: "POST", headers: {
      Origin: origin, "Content-Type": "application/json", Cookie: `olvex_session=${session}`
    }, body: JSON.stringify(cash) });
    return (await onRequestPost({ env, request, params: { section: "ai", businessId: "our" } })).status;
  }));
  assert.deepEqual(quota.sort(), [200, 429]);
  assert.equal(calls, 7);
  env.OLVEX_AI_MODE = "off";
  await call("our", cash, 503);
  assert.equal(calls, 7);

  env.OLVEX_OPENAI_DAILY_LIMIT = "100";
  for (let i = 0; i < 5; i++) await reserveAI({ db: DB, env, businessId: "our", actorId: "u" }, "gpt-6-luna");
  await assert.rejects(reserveAI({ db: DB, env, businessId: "our", actorId: "u" }, "gpt-6-luna"), { status: 429 });
  await DB.prepare("INSERT INTO business_members(id,business_id,user_id,role) VALUES ('m3','our','other','admin')").run();
  for (let i = 0; i < 8; i++) await reserveAI({ db: DB, env, businessId: "our", actorId: "other" }, "gpt-6-luna");
  await assert.rejects(reserveAI({ db: DB, env, businessId: "our", actorId: "other" }, "gpt-6-luna"), { status: 429 });
  await reserveAI({ db: DB, env, businessId: "private", actorId: "other" }, "gpt-6-luna");
  delete env.OLVEX_AI_MODE;
  env.OLVEX_AI_PROVIDER = "cloudflare";
  const otherToken = randomToken();
  await DB.prepare("INSERT INTO user_sessions (id,user_id,token_hash,expires_at) VALUES ('s2','other',?,'2099-01-01T00:00:00Z')")
    .bind(await sha256(otherToken)).run();
  let workerCalls = 0;
  env.AI = { async run(model) {
    assert.equal(model, "@cf/zai-org/glm-4.7-flash");
    if (++workerCalls === 1) throw new Error("Daily Neurons quota exceeded");
    return { response: { answer: "Yerel cevap", proposal: { kind: "none" } }, usage: { prompt_tokens: 10, completion_tokens: 4 } };
  }};
  const message = { action: "send", id: crypto.randomUUID(), requestId: crypto.randomUUID(),
    newChat: true, prompt: "Bugün satışlar?" };
  const cloud = (payload, status) => call("private", payload, status, "ai", otherToken);
  await cloud(message, 403);
  assert.equal(workerCalls, 0);
  assert.equal(await DB.prepare("SELECT COUNT(*) n FROM olvex_ai_conversations WHERE business_id = 'private'").first("n"), 0);
  await DB.prepare("INSERT INTO olvex_subscriptions (id,business_id,environment,plan,plan_ref,state,provider_ref,customer_ref,paid_until) VALUES ('private-plan','private','live','esnaf-monthly','fixture-plan','active','private-subscription','private-customer',?)")
    .bind(Date.now() + 86400000).run();
  await cloud(message, 429);
  assert.equal((await cloud(message, 200)).state, "failed");
  assert.equal(workerCalls, 1);
  assert.equal((await cloud({ ...message, retry: true }, 200)).state, "complete");
  assert.equal((await cloud({ ...message, retry: true }, 200)).state, "complete");
  assert.equal(workerCalls, 2);
  assert.equal(calls, 7);
});

test("Responses API gerçek Workers çalışma zamanında istek gönderir ve 302 yönlendirmesini izlemez", async (t) => {
  const bundled = await build({
    stdin: { contents: `import { openAIConfig, requestOpenAI } from "./functions/_lib/openai.js";
      export default { async fetch(_request, env) {
        try {
          const result = await requestOpenAI(env.KEY, openAIConfig(env), {}, [{role:"user",content:"Test"}], null);
          return Response.json(result);
        } catch (error) { return Response.json({error:error.message}, {status:error.status || 500}); }
      } };`, resolveDir: new URL("../", import.meta.url).pathname },
    bundle: true, format: "esm", write: false
  });
  let redirected = false;
  let calls = 0;
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: "olvex-openai-transport", compatibilityDate: "2026-11-16",
    modules: [{ type: "ESModule", path: "worker.mjs", contents: bundled.outputFiles[0].text }],
    bindings: { KEY: "fixture", OPENAI_MODEL: "gpt-6.2-sol", OLVEX_AI_REASONING_EFFORT: "low" },
    outboundService: async request => {
      assert.equal(request.url, "https://api.openai.com/v1/responses");
      assert.equal(request.headers.get("Authorization"), "Bearer fixture");
      assert.equal(request.method, "POST");
      const payload = await request.json();
      assert.equal(payload.model, "gpt-6.2-sol");
      assert.equal(payload.reasoning.effort, "low");
      assert.equal(payload.max_output_tokens, 1600);
      assert.equal(payload.store, false);
      assert.equal(payload.text.format.type, "json_schema");
      calls++;
      return redirected ? new Response(null, { status: 302, headers: { Location: "https://never.example.test" } })
        : Response.json({ status: "completed" });
    }
  }] }));
  t.after(() => runtime.dispose());
  assert.deepEqual(await (await runtime.dispatchFetch("https://worker.example.test")).json(), { status: "completed" });
  redirected = true;
  assert.equal((await runtime.dispatchFetch("https://worker.example.test")).status, 502);
  assert.equal(calls, 2);
});

test("OpenAI ağ, timeout, kota, bozuk yanıt ve ret durumları güvenli sınıflanır", async (t) => {
  const config = openAIConfig({});
  assert.throws(() => openAIConfig({ OPENAI_MODEL: "gpt-6.2-sol", OLVEX_AI_REASONING_EFFORT: "none" }), { status: 503 });
  assert.equal(openAIConfig({ OPENAI_MODEL: "gpt-4.1-mini" }).reasoning, undefined);
  let outcome;
  t.mock.method(globalThis, "fetch", () => outcome());
  const invoke = () => requestOpenAI("fixture", config, {}, [{ role: "user", content: "Soru" }], null);
  for (const [respond, status] of [
    [() => new Response("private upstream detail", { status: 429 }), 503],
    [() => new Response("private upstream detail", { status: 401 }), 503],
    [() => new Response("not JSON"), 502],
    [() => { throw new Error("private upstream detail"); }, 502],
    [() => { throw new DOMException("private upstream detail", "TimeoutError"); }, 504]
  ]) {
    outcome = respond;
    await assert.rejects(invoke(), error => error.status === status && !error.message.includes("private"));
  }
  assert.throws(() => parseOpenAI({ status: "incomplete" }), { status: 502 });
  assert.throws(() => parseOpenAI({ status: "completed", output: [
    { type: "message", content: [{ type: "refusal", refusal: "private" }] }
  ] }), { status: 422 });
});
