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
    assert.deepEqual(input.response_format.json_schema.required, ["answer", "proposal"]);
    assert.deepEqual(input.messages.map(m => m.role), ["system", "user", "user"]);
    const context = JSON.parse(input.messages[1].content);
    assert.equal(context.facts.cash.inflowMinor, 12500);
    assert.equal(context.allowedDraft, null);
    assert.equal(context.history[0].role, "assistant");
    assert.equal(input.messages.at(-1).content, messages.at(-1).content);
    assert.ok(input.max_tokens <= 1100);
    return { response: JSON.stringify({ answer: "Nakit girişiniz çıkışınızdan yüksek.", proposal }),
      usage: { input_tokens: 200, output_tokens: 75 } };
  }};
  const result = await requestWorkersAI(binding, facts, messages, null);
  assert.equal(calls, 1);
  assert.equal(result.result.proposal.kind, "none");
  assert.equal(result.usage.input_tokens, 200);
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
