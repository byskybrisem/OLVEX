import { entitlement, paidSql, requirePaidSubscription, subscriptionEnvironment } from "./entitlements.js";
import { HttpError, isPreviewRequest } from "./http.js";
import { cashInsert } from "./records.js";
import { financials, insights } from "./reports.js";
import { choice, identifier, integer, MAX_STOCK, MAX_UNIT_MINOR, sku, text, today } from "./validate.js";
import { rowExists, transact } from "./workspace.js";
import { factsForAI, normalizeAI, verifiedFacts } from "./ai-facts.js";
import { aiUsage, recordAIUsage, reserveAI } from "./ai-usage.js";
import { openAIConfig, parseOpenAI, requestOpenAI } from "./openai.js";
import { WORKERS_AI_MODEL, requestWorkersAI } from "./workers-ai.js";

export function mode(ctx) {
  if (ctx.env.OLVEX_AI_MODE === "off") return "off";
  if (ctx.env.OLVEX_AI_MODE === "mock") return isPreviewRequest(ctx.env, ctx.request) ? "mock" : "off";
  if (ctx.env.OLVEX_AI_PROVIDER === "cloudflare") return typeof ctx.env.AI?.run === "function" ? "cloudflare" : "off";
  return ctx.env.OPENAI_API_KEY?.trim() ? "openai" : "off";
}

export async function aiDashboard(ctx) {
  const full = ctx.paramsUrl?.get("summary") === "1";
  const day = today();
  const plan = await entitlement(ctx);
  const [facts, pending, usage, daily, branches] = await Promise.all([
    insights(ctx),
    ctx.db.prepare(`SELECT id, kind, payload, expires_at FROM olvex_ai_proposals
      WHERE business_id = ? AND user_id = ? AND state = 'pending' AND expires_at > ?
      ${full ? `AND NOT EXISTS (SELECT 1 FROM olvex_ai_turns t
        WHERE t.business_id = olvex_ai_proposals.business_id AND t.user_id = olvex_ai_proposals.user_id
          AND t.proposal_id = olvex_ai_proposals.id)` : ""}
      ORDER BY created_at DESC, id DESC LIMIT 20`).bind(ctx.businessId, ctx.actorId, new Date().toISOString()).all(),
    aiUsage(ctx),
    full ? financials(ctx, day, day) : null,
    full && plan.professional
      ? factsForAI(ctx, [{ role: "user", content: "Son 7 gün hangi şube daha fazla satış yapıyor?" }], null, null) : null
  ]);
  return { mode: plan.tier !== "inactive" ? mode(ctx) : "off", facts, usage, daily: daily?.totals, branches: branches?.rows, proposals: pending.results.map(({ payload, ...row }) => ({ ...row, ...JSON.parse(payload) })) };
}

function draftKind(message) {
  const prompt = normalizeAI(message);
  if (/^gider\s+\d/.test(prompt)) return "expense";
  if (/^stok\s+\S+\s+[+-]?\d/.test(prompt)) return "stock";
  if (!/\b(hazirla|hazirlayin|olustur|olusturun|ekle|ekleyin|kaydet|kaydedin|duzelt|dus|artir)\b/.test(prompt) &&
      !/\b(hazirlar|olusturur|ekler|kaydeder) misin\b/.test(prompt)) return null;
  if (/\b(stok|stogu|stokta|stoktan)\b/.test(prompt)) return "stock";
  if (/gider|masraf/.test(prompt)) return "expense";
  return null;
}

function externalMessages(messages) {
  return messages.slice(-5).map(({ role, content }, index, context) => ({
    role,
    content: (index === context.length - 1 ? content : content.slice(0, 650))
      .replace(/[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/gi, "[e-posta]")
      .replace(/(?<!\d)(?:\+90[ -]?)?0?5\d{2}[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}(?!\d)/g, "[telefon]")
      .replace(/\b\d{11}\b/g, "[kimlik numarası]")
  }));
}

function mockAnswer(prompt) {
  const expense = prompt.trim().match(/^gider\s+(\d{1,7})(?:[,.](\d{1,2}))?\s+(.+)$/i);
  if (expense) {
    return {
      answer: "Gider taslağı hazır. Kaydı oluşturmak için tutarı ve açıklamayı kontrol edip onaylayın.",
      proposal: { kind: "expense", amount: Number(expense[1]) * 100 + Number((expense[2] || "").padEnd(2, "0")), description: expense[3] }
    };
  }
  const stock = prompt.trim().match(/^stok\s+(\S+)\s+([+-]?\d{1,7})\s+(.+)$/i);
  if (stock) {
    return {
      answer: "Stok düzeltme taslağı hazır. İşleme geçmeden önce SKU ve miktar farkını kontrol edin.",
      proposal: { kind: "stock", sku: stock[1], delta: Number(stock[2]), description: stock[3] }
    };
  }
  return {
    answer: "Seçtiğiniz kapsamdaki kayıtları aşağıda görebilirsiniz.",
    proposal: { kind: "none" }
  };
}

async function proposedAction(ctx, proposal, branch) {
  if (proposal?.kind === "expense") {
    return {
      kind: "expense",
      description: text(proposal.description, "Açıklama", { max: 180 }),
      amount: integer(proposal.amount, "Tutar", 1, MAX_UNIT_MINOR),
      occurredOn: today()
    };
  }

  if (proposal?.kind === "stock") {
    const code = sku(proposal.sku);
    const delta = integer(proposal.delta, "Stok farkı", -MAX_STOCK, MAX_STOCK);
    if (!delta) throw new HttpError(400, "Stok farkı sıfır olamaz.");
    const product = await ctx.db.prepare(`SELECT p.id, p.name, p.stock AS total_stock, COALESCE(s.stock, 0) AS branch_stock
      FROM olvex_products p LEFT JOIN olvex_branch_stock s ON s.business_id = p.business_id
        AND s.product_id = p.id AND s.branch_id = ?
      WHERE p.business_id = ? AND p.sku = ? AND p.active = 1`).bind(branch.id, ctx.businessId, code).first();
    if (!product) throw new HttpError(400, "SKU bulunamadı.");
    if (product.branch_stock + delta < 0 || product.total_stock + delta > MAX_STOCK) {
      throw new HttpError(400, "Bu stok farkı seçilen şubeye uygulanamaz.");
    }
    return {
      kind: "stock", businessName: ctx.businessName, branchId: branch.id, branchName: branch.name,
      productId: product.id, name: product.name, sku: code, delta, branchStock: product.branch_stock,
      description: text(proposal.description, "Neden", { max: 180 })
    };
  }

  return null;
}

export async function ask(ctx, body, { deferProposal = false } = {}) {
  await requirePaidSubscription(ctx);
  const activeMode = mode(ctx);
  if (activeMode === "off") throw new HttpError(503, "OLVEX AI şu anda kullanılamıyor.");
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 8 ||
      body.messages.at(-1)?.role !== "user") throw new HttpError(400, "Bir mesaj yazın.");
  const messages = body.messages.map((message) => {
    if (!message || typeof message !== "object") throw new HttpError(400, "Mesaj geçersiz.");
    return { role: choice(message.role, ["user", "assistant"], "Mesaj türü"), content: text(message.content, "Mesaj", { max: 2000 }) };
  });

  const branch = body.branchId == null ? null : await ctx.db.prepare(
    "SELECT id, name FROM olvex_branches WHERE business_id = ? AND id = ?"
  ).bind(ctx.businessId, identifier(body.branchId, "Şube")).first();
  if (body.branchId != null && !branch) throw new HttpError(404, "Şube bulunamadı.");

  const allowedDraft = draftKind(messages.at(-1).content);
  if (allowedDraft === "stock" && !branch) {
    return { answer: "Stok düzeltmesi için işlem yapılacak şubeyi seçip mesajı tekrar gönderin.", needsBranch: true, proposal: null };
  }

  let response;
  let evidence;
  if (activeMode === "mock") {
    response = mockAnswer(messages.at(-1).content);
    evidence = verifiedFacts(await factsForAI(ctx, messages, branch, allowedDraft));
  } else {
    const config = activeMode === "cloudflare" ? { model: WORKERS_AI_MODEL } : openAIConfig(ctx.env);
    const safeMessages = externalMessages(messages);
    const facts = await factsForAI(ctx, safeMessages, branch, allowedDraft);
    const id = await reserveAI(ctx, config.model);
    await requirePaidSubscription(ctx);
    if (activeMode === "cloudflare") {
      const result = await requestWorkersAI(ctx.env.AI, facts, safeMessages, allowedDraft);
      await recordAIUsage(ctx, id, config.model, result.usage).catch(() => console.warn("OLVEX AI kullanım ölçümü kaydedilemedi."));
      response = result.result;
    } else {
      const payload = await requestOpenAI(ctx.env.OPENAI_API_KEY.trim(), config, facts, safeMessages, allowedDraft);
      await recordAIUsage(ctx, id, config.model, payload?.usage).catch(() => console.warn("OLVEX AI kullanım ölçümü kaydedilemedi."));
      response = parseOpenAI(payload);
    }
    evidence = verifiedFacts(facts);
  }
  if (response.proposal?.kind !== "none" && response.proposal?.kind !== allowedDraft) {
    return { answer: "İşlem taslağı oluşturulmadı. Taslak istiyorsanız gider veya stok işlemini açıkça belirtin.", proposal: null, evidence };
  }
  const answer = text(response.answer, "AI yanıtı", { max: 2000 });
  let proposal = null;

  try {
    proposal = await proposedAction(ctx, response.proposal, branch);
  } catch (error) {
    if (error instanceof HttpError) {
      return { answer: `${answer}\n\nTaslak oluşturulamadı. ${error.message}`.slice(0, 2000), proposal: null };
    }
    throw error;
  }
  if (proposal) {
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1800 * 1000).toISOString();
    if (!deferProposal) {
      const result = await ctx.db.prepare(`INSERT INTO olvex_ai_proposals (business_id, id, user_id, kind, payload, expires_at)
        SELECT ?, ?, user_id, ?, ?, ? FROM business_members
        WHERE business_id = ? AND user_id = ? AND role IN ('owner', 'admin') AND ${paidSql}`)
        .bind(ctx.businessId, id, proposal.kind, JSON.stringify(proposal), expiresAt, ctx.businessId, ctx.actorId,
          ctx.businessId, subscriptionEnvironment(ctx)).run();
      if (result.meta.changes !== 1) throw new HttpError(403, "İşlem yetkisi sona ermiş.");
    }
    proposal = { ...proposal, id, expires_at: expiresAt };
  }
  return { answer, proposal, evidence };
}

export async function resolveProposal(ctx, body, apply) {
  if (apply && mode(ctx) === "off") throw new HttpError(503, "OLVEX AI şu anda kullanılamıyor.");
  const id = identifier(body.id, "Taslak");
  const requestId = identifier(body.requestId);
  const row = await ctx.db.prepare(`SELECT kind, payload FROM olvex_ai_proposals
    WHERE business_id = ? AND id = ? AND user_id = ?`).bind(ctx.businessId, id, ctx.actorId).first();
  if (!row) throw new HttpError(404, "Taslak bulunamadı.");
  const draft = JSON.parse(row.payload);
  const statements = [
    ctx.db.prepare("UPDATE olvex_ai_proposals SET state = ? WHERE business_id = ? AND id = ?")
      .bind(apply ? "applied" : "discarded", ctx.businessId, id)
  ];
  if (apply && row.kind === "expense") {
    statements.push(cashInsert(ctx, requestId, { ...draft, kind: "expense", category: "" }));
  }
  if (apply && row.kind === "stock") {
    if (!draft.branchId) throw new HttpError(409, "Bu eski taslakta şube seçilmemiş. Şube seçerek yeni bir taslak hazırlayın.");
    if (body.branchId !== draft.branchId) throw new HttpError(409, "Onaylanan şube taslaktaki şube ile uyuşmuyor.");
    statements.push(ctx.db.prepare(`INSERT INTO olvex_stock_movements
      (business_id, id, product_id, kind, delta, note, created_by, branch_id) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?)`)
      .bind(ctx.businessId, requestId, draft.productId, draft.delta, draft.description, ctx.actorId, draft.branchId));
  }
  const guard = rowExists("olvex_ai_proposals", id,
    "AND user_id = ? AND state = 'pending' AND expires_at > ?", ctx.actorId, new Date().toISOString());
  guard.message = "Taslak kullanılmış veya süresi dolmuş.";
  if (apply && row.kind === "stock") {
    const product = rowExists("olvex_products", draft.productId, "AND active = 1 AND sku = ?", draft.sku);
    guard.sql += ` AND ${product.sql}`;
    const proposalValues = guard.values;
    guard.values = businessId => [...proposalValues(businessId), ...product.values(businessId)];
    guard.message = "Taslak kullanılmış, süresi dolmuş veya ürün kaydı değişmiş.";
    if (Number.isSafeInteger(draft.branchStock)) {
      guard.sql += ` AND COALESCE((SELECT stock FROM olvex_branch_stock
        WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0) = ?`;
      const productValues = guard.values;
      guard.values = businessId => [...productValues(businessId), businessId, draft.branchId, draft.productId, draft.branchStock];
      guard.message = "Taslak kullanılmış, süresi dolmuş veya ürün ya da şube stoğu değişmiş. Yeni taslak hazırlayın.";
    }
  }
  return transact(ctx, apply ? "ai-apply" : "ai-discard", { requestId, id }, statements, guard);
}
