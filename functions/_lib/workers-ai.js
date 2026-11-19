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

  const parameters = {
    messages: [
      { role: "system", content: aiInstructions },
      { role: "user", content: JSON.stringify({
        facts, allowedDraft, history: messages.slice(0, -1)
      }) },
      { role: "user", content: messages.at(-1).content }
    ],
    response_format: { type: "json_schema", json_schema: aiOutputSchema },
    max_tokens: 1100,
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

  // Workers AI uses { response, usage } for non-streaming text requests.
  // JSON mode can return a string or an already decoded object. Reuse the
  // existing OpenAI response validator before any operational proposal.
  const raw = payload?.response;
  const value = typeof raw === "string" ? raw : raw && typeof raw === "object" ? JSON.stringify(raw) : null;
  if (!value) throw new HttpError(502, "AI sağlayıcısından geçerli yanıt alınamadı.");

  const result = parseOpenAI({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: value }] }]
  });
  return { result, usage: payload?.usage };
}
