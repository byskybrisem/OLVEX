import assert from "node:assert/strict";
import test from "node:test";
import { requestWorkersAI, WORKERS_AI_MODEL } from "../functions/_lib/workers-ai.js";

const facts = { asOf: "2026-11-19", location: { scope: "whole_business" }, kind: "cash",
  cash: { inflowMinor: 12500, outflowMinor: 700 } };
const messages = [
  { role: "assistant", content: "Önceki yanıttan kısa bağlam" },
  { role: "user", content: "Bu ay nakit akışımı değerlendir" }
];
const proposal = { kind: "none", description: null, amount: null, sku: null, delta: null };

test("free Workers AI binding sends scoped facts and structured JSON and validates output", async () => {
  let calls = 0;
  const binding = { async run(model, input) {
    calls++;
    assert.equal(model, WORKERS_AI_MODEL);
    assert.equal(input.response_format.type, "json_schema");
    assert.deepEqual(input.response_format.json_schema.schema.required, ["answer", "proposal"]);
    assert.equal(input.response_format.json_schema.name, "olvex_answer");
    assert.equal(input.chat_template_kwargs.enable_thinking, false);
    assert.deepEqual(input.response_format.json_schema.schema.properties.proposal.properties.kind.enum, ["none"]);
    assert.deepEqual(input.messages.map(m => m.role), ["system", "user", "user"]);
    const context = JSON.parse(input.messages[1].content);
    assert.equal(context.facts.cash.inflowMinor, 12500);
    assert.equal(context.allowedDraft, null);
    assert.equal(context.history[0].role, "assistant");
    assert.equal(input.messages.at(-1).content, messages.at(-1).content);
    assert.ok(input.max_tokens <= 1100);
    return { choices: [{ finish_reason: "stop", message: {
      content: JSON.stringify({ answer: "Nakit girişiniz çıkışınızdan yüksek.", proposal })
    } }], usage: { prompt_tokens: 200, completion_tokens: 75 } };
  }};
  const result = await requestWorkersAI(binding, facts, messages, null);
  assert.equal(calls, 1);
  assert.equal(result.result.proposal.kind, "none");
  assert.equal(result.usage.input_tokens, 200);
  assert.equal(result.usage.output_tokens, 75);
});

test("free Workers AI rejects malformed or unauthorized-style responses", async () => {
  const malformed = { run: async () => ({ response: "not JSON" }) };
  await assert.rejects(requestWorkersAI(malformed, facts, messages, null), { status: 502 });
  const broken = { run: async () => ({ response: JSON.stringify({
    answer: "Hi", proposal: { kind: "delete", description: null, amount: null, sku: null, delta: null }
  }) }) };
  await assert.rejects(requestWorkersAI(broken, facts, messages, null), { status: 502 });
  await assert.rejects(requestWorkersAI(null, facts, messages, null), { status: 503 });
});

test("free quota errors do not trigger a paid fallback", async () => {
  let calls = 0;
  const binding = { async run() { calls++; throw new Error("Daily Neurons quota exceeded"); } };
  await assert.rejects(requestWorkersAI(binding, facts, messages, null), { status: 429 });
  assert.equal(calls, 1);
});

test("Cloudflare draft schema restricts actions to the user-requested kind", async () => {
  const binding = { async run(_model, input) {
    assert.deepEqual(input.response_format.json_schema.schema.properties.proposal.properties.kind.enum, ["none", "expense"]);
    return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      answer: "Gider taslağı hazır.", proposal: { kind: "expense", description: "Kırtasiye", amount: 100, sku: null, delta: null }
    }) } }] };
  } };
  const result = await requestWorkersAI(binding, facts, messages, "expense");
  assert.equal(result.result.proposal.kind, "expense");
});

test("incomplete Cloudflare reasoning output is never treated as a completed answer", async () => {
  await assert.rejects(requestWorkersAI({ run: async () => ({
    choices: [{ finish_reason: "length", message: { content: null, reasoning: "incomplete" } }]
  }) }, facts, messages, null), { status: 502 });
});
