import { HttpError } from "./http.js";
import { aiInstructions, aiOutputSchema, parseOpenAI } from "./openai.js";

// The free Workers AI allocation has its own daily Neuron quota, shared with
// other applications in the Cloudflare account. Do not silently fall back
// to a paid OpenAI model if it is exhausted.
export const WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash";

export async function requestWorkersAI(binding, facts, messages, allowedDraft) {
  if (!binding || typeof binding.run !== "function") {
    throw new HttpError(503, "Cloudflare AI bağlantısı kurulmamış. Yöneticinize bildirin.");
  }

  // Keep an answer-only schema when no operation was requested. A smaller
  // enum reduces irrelevant proposals from smaller open-weight models.
  const allowedKinds = allowedDraft === "expense" || allowedDraft === "stock"
    ? ["none", allowedDraft] : ["none"];
  const schema = {
    ...aiOutputSchema,
    properties: {
      ...aiOutputSchema.properties,
      proposal: {
        ...aiOutputSchema.properties.proposal,
        properties: {
          ...aiOutputSchema.properties.proposal.properties,
          kind: { type: "string", enum: allowedKinds }
        }
      }
    }
  };
  const parameters = {
    messages: [
      { role: "system", content: aiInstructions },
      { role: "user", content: JSON.stringify({
        facts, allowedDraft, history: messages.slice(0, -1)
      }) },
      { role: "user", content: messages.at(-1).content }
    ],
    response_format: { type: "json_schema",
      json_schema: { name: "olvex_answer", strict: true, schema } },
    chat_template_kwargs: { enable_thinking: false },
    max_tokens: 800,
    temperature: 0.2
  };

  let payload;
  try {
    payload = await binding.run(WORKERS_AI_MODEL, parameters);
  } catch (error) {
    const code = error?.code ?? error?.cause?.code;
    if (code === 3040 || code === 5035 || code === 429 ||
        /quota|limit|neurons|capacity|exceeded/i.test(String(error?.message || ""))) {
      throw new HttpError(429,
        "Ücretsiz AI kotası veya sağlayıcı kapasitesi doldu. Daha sonra tekrar deneyin.");
    }
    throw new HttpError(502, "OLVEX AI yanıt oluşturamadı. Daha sonra tekrar deneyin.");
  }

  // GLM-4.7-Flash returns OpenAI-style chat completions. Other Workers
  // AI text models can return {response}. Accept both but never unvalidated
  // tool calls or unfinished generations.
  if (payload?.choices?.[0]?.finish_reason === "length") {
    throw new HttpError(502, "AI yanıtı tamamlanmadı. Daha kısa bir soru deneyin.");
  }
  const raw = payload?.choices?.[0]?.message?.content ?? payload?.response;
  const value = typeof raw === "string" ? raw : raw && typeof raw === "object" ? JSON.stringify(raw) : null;
  if (!value) throw new HttpError(502, "AI sağlayıcısından geçerli yanıt alınamadı.");

  const result = parseOpenAI({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: value }] }]
  });
  const usage = payload?.usage;
  const normalizedUsage = usage && {
    input_tokens: usage.input_tokens ?? usage.prompt_tokens,
    output_tokens: usage.output_tokens ?? usage.completion_tokens,
    input_tokens_details: {
      cached_tokens: usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0
    }
  };
  return { result, usage: normalizedUsage };
}
