import { HttpError } from "./http.js";
import { addDays, today } from "./validate.js";

// Standard text pricing in nano-USD per token. Reasoning is billed within output tokens.
const prices = {
  "gpt-6-luna": { input: 100, cached: 10, written: 125, output: 500 },
  "gpt-6.2-sol": { input: 2000, cached: 100, written: 2500, written12h: 5000, output: 10000 },
  "gpt-4.1-mini": { input: 400, cached: 100, output: 1600 }
};
const businessLimit = 20;
const userLimit = 12;

function systemLimit(env) {
  const configured = Number(env.OLVEX_OPENAI_DAILY_LIMIT);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 100;
}

export async function reserveAI(ctx, model) {
  const id = crypto.randomUUID();
  const day = today();
  const { meta } = await ctx.db.prepare(`INSERT INTO olvex_ai_usage (id, day, business_id, user_id, model)
    SELECT ?1, ?2, ?3, ?4, ?5
    WHERE EXISTS (SELECT 1 FROM business_members WHERE business_id = ?3 AND user_id = ?4 AND role IN ('owner','admin'))
      AND (SELECT COUNT(*) FROM olvex_ai_usage WHERE day = ?2) < ?6
      AND (SELECT COUNT(*) FROM olvex_ai_usage WHERE day = ?2 AND business_id = ?3) < ?7
      AND (SELECT COUNT(*) FROM olvex_ai_usage WHERE day = ?2 AND user_id = ?4) < ?8`)
    .bind(id, day, ctx.businessId, ctx.actorId, model, systemLimit(ctx.env), businessLimit, userLimit).run();
  if (!meta.changes) {
    const member = await ctx.db.prepare("SELECT role FROM business_members WHERE business_id = ? AND user_id = ?")
      .bind(ctx.businessId, ctx.actorId).first();
    if (!["owner", "admin"].includes(member?.role)) throw new HttpError(403, "İşlem yetkisi sona ermiş.");
    throw new HttpError(429, "Bugünkü OLVEX AI kullanım sınırına ulaşıldı. İstanbul saatiyle yarın tekrar deneyin veya ücretsiz analizleri kullanın.");
  }
  return id;
}

export async function recordAIUsage(ctx, id, model, usage) {
  const input = usage?.input_tokens;
  const output = usage?.output_tokens;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  const written = usage?.input_tokens_details?.cache_write_tokens ?? 0;
  const written12h = usage?.input_tokens_details?.cache_write_tokens_details?.ttl_12h_tokens ?? 0;
  const reasoning = usage?.output_tokens_details?.reasoning_tokens ?? 0;
  if (![input, output, cached, written, written12h, reasoning].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 2_000_000) ||
      cached + written > input || written12h > written || reasoning > output) return;
  const price = Object.hasOwn(prices, model) ? prices[model] : null;
  const estimate = price && (!written || price.written) && (!written12h || price.written12h)
    ? (input - cached - written) * price.input + cached * price.cached + output * price.output +
      (written - written12h) * (price.written ?? 0) + written12h * (price.written12h ?? 0)
    : null;
  await ctx.db.prepare(`UPDATE olvex_ai_usage SET input_tokens = ?, cached_tokens = ?, cache_write_tokens = ?,
    output_tokens = ?, reasoning_tokens = ?, estimated_nano_usd = ? WHERE id = ? AND business_id = ?`)
    .bind(input, cached, written, output, reasoning, estimate, id, ctx.businessId).run();
}

export async function aiUsage(ctx) {
  const day = today();
  const from = addDays(day, -29);
  const { results } = await ctx.db.prepare(`SELECT model, COUNT(*) AS requests,
    SUM(day = ?1) AS today, COUNT(input_tokens) AS metered, COUNT(estimated_nano_usd) AS priced,
    COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output,
    COALESCE(SUM(estimated_nano_usd), 0) AS estimatedNanoUsd
    FROM olvex_ai_usage WHERE business_id = ?2 AND day BETWEEN ?3 AND ?1
    GROUP BY model ORDER BY requests DESC, model`).bind(day, ctx.businessId, from).all();
  return { day, from, businessLimit, userLimit, models: results };
}
