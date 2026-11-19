import { aiDashboard, ask, mode } from "./ai.js";
import { HttpError } from "./http.js";
import { identifier, integer, text } from "./validate.js";

const owner = "business_id = ?1 AND user_id = ?2";
const manager = `EXISTS (SELECT 1 FROM business_members
  WHERE business_id = ?1 AND user_id = ?2 AND role IN ('owner','admin'))`;
const chatOwner = `${owner} AND id = ?3 AND deleted_at IS NULL`;
const turnOwner = `${owner} AND chat_id = ?3`;
const now = () => new Date().toISOString();
const titleFrom = prompt => [...prompt.replace(/\s+/g, " ")].slice(0, 72).join("");
const pageSize = 20;
// The provider call may still be running when a browser disconnects. A new attempt
// supersedes an abandoned reservation without letting its late reply create a draft.
const expired = () => new Date(Date.now() - 2 * 60_000).toISOString();

function query(ctx, sql, ...bindings) {
  return ctx.db.prepare(sql).bind(ctx.businessId, ctx.actorId, ...bindings);
}

async function conversation(ctx, id) {
  const row = await query(ctx, `SELECT id, title, branch_id, branch_name FROM olvex_ai_conversations
    WHERE ${chatOwner} AND ${manager}`, id).first();
  if (!row) throw new HttpError(404, "Sohbet bulunamadı.");
  return row;
}

export async function readAI(ctx) {
  const params = ctx.paramsUrl;
  if (params.get("chat") === "1") return { mode: mode(ctx) };
  if (params.has("conversation")) {
    const id = identifier(params.get("conversation"), "Sohbet");
    const chat = await conversation(ctx, id);
    const before = params.has("before") ? integer(Number(params.get("before")), "Mesaj konumu", 1, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    const { results } = await query(ctx, `SELECT t.seq, t.request_id, t.prompt, t.answer, t.evidence, t.error, t.state, t.started_at,
      p.id AS proposal_id, p.kind, p.payload, p.expires_at, p.state AS proposal_state
      FROM olvex_ai_turns t LEFT JOIN olvex_ai_proposals p
        ON p.business_id = t.business_id AND p.user_id = t.user_id AND p.id = t.proposal_id
      WHERE t.business_id = ?1 AND t.user_id = ?2 AND t.chat_id = ?3 AND t.seq < ?4 AND ${manager}
      ORDER BY t.seq DESC LIMIT ${pageSize + 1}`, id, before).all();
    const cutoff = expired();
    const time = now();
    const turns = results.slice(0, pageSize).reverse().map(row => ({
      seq: row.seq, requestId: row.request_id, prompt: row.prompt, answer: row.answer, evidence: row.evidence,
      state: row.state, error: row.error, retryable: row.state === "failed" || (row.state === "pending" && row.started_at < cutoff),
      proposal: row.proposal_id ? {
        ...JSON.parse(row.payload), id: row.proposal_id, kind: row.kind, expires_at: row.expires_at,
        state: row.proposal_state === "pending" && row.expires_at <= time ? "expired" : row.proposal_state
      } : null
    }));
    return { chat, turns, before: results.length > pageSize ? turns[0].seq : null };
  }
  if (params.has("conversations")) {
    let date = "9999";
    let id = "";
    if (params.has("cursor")) {
      [date, id] = params.get("cursor").split(",");
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date)) throw new HttpError(400, "Sohbet konumu geçersiz.");
      id = identifier(id, "Sohbet");
    }
    const { results } = await query(ctx, `SELECT id, title, branch_id, branch_name, updated_at
      FROM olvex_ai_conversations WHERE ${owner} AND deleted_at IS NULL AND ${manager}
        AND (updated_at < ?3 OR (updated_at = ?3 AND id < ?4))
      ORDER BY updated_at DESC, id DESC LIMIT ${pageSize + 1}`, date, id).all();
    const rows = results.slice(0, pageSize);
    const last = rows.at(-1);
    return { rows, cursor: results.length > pageSize ? `${last.updated_at},${last.id}` : null };
  }
  return aiDashboard(ctx);
}

export async function renameChat(ctx, body) {
  const id = identifier(body.id, "Sohbet");
  const title = text(body.title, "Sohbet adı", { max: 100 });
  const { meta } = await query(ctx, `UPDATE olvex_ai_conversations SET title = ?4 WHERE ${chatOwner} AND ${manager}`, id, title).run();
  if (!meta.changes) throw new HttpError(404, "Sohbet bulunamadı.");
  return { id, title };
}

export async function removeChat(ctx, body) {
  const id = identifier(body.id, "Sohbet");
  const [, , deleted] = await ctx.db.batch([
    query(ctx, `UPDATE olvex_ai_proposals SET state = 'discarded' WHERE ${owner} AND state = 'pending' AND ${manager}
      AND id IN (SELECT proposal_id FROM olvex_ai_turns WHERE ${turnOwner})`, id),
    query(ctx, `DELETE FROM olvex_ai_turns WHERE ${turnOwner} AND ${manager}`, id),
    query(ctx, `UPDATE olvex_ai_conversations SET deleted_at = ?4, title = '', branch_id = NULL, branch_name = NULL
      WHERE ${chatOwner} AND ${manager}`, id, now())
  ]);
  if (!deleted.meta.changes) throw new HttpError(404, "Sohbet bulunamadı.");
  return { id };
}

export async function sendChat(ctx, body) {
  const id = identifier(body.id, "Sohbet");
  const requestId = identifier(body.requestId);
  const prompt = text(body.prompt, "Mesaj", { max: 2000 });
  const branchId = body.branchId == null ? null : identifier(body.branchId, "Şube");
  const branch = branchId && await ctx.db.prepare("SELECT name FROM olvex_branches WHERE business_id = ? AND id = ?")
    .bind(ctx.businessId, branchId).first();
  if (branchId && !branch) throw new HttpError(404, "Şube bulunamadı.");

  // Only a first turn may create a conversation. An old reply cannot revive deleted history.
  if (body.newChat === true) {
    await query(ctx, `INSERT INTO olvex_ai_conversations (business_id, user_id, id, title, branch_id, branch_name, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE ${manager}
      ON CONFLICT DO NOTHING`, id, titleFrom(prompt), branchId, branch?.name ?? null, now()).run();
  }
  const chat = await conversation(ctx, id);
  if (chat.branch_id !== branchId) throw new HttpError(409, "Bu şube için yeni bir sohbet açın.");

  const started = now();
  const attempt = crypto.randomUUID();
  const lookup = () => query(ctx, `SELECT prompt, state FROM olvex_ai_turns WHERE ${turnOwner} AND request_id = ?4`, id, requestId).first();
  const existing = await lookup();
  if (existing && existing.prompt !== prompt) throw new HttpError(409, "Bu istek kimliği başka bir mesajda kullanılmış.");
  if (existing && (existing.state === "complete" || body.retry !== true)) return { id, state: existing.state };
  const claimed = existing
    ? await query(ctx, `UPDATE OR IGNORE olvex_ai_turns SET state = 'pending', error = NULL, started_at = ?5, attempt = ?6
      WHERE ${turnOwner} AND request_id = ?4 AND ${manager} AND (state = 'failed' OR (state = 'pending' AND started_at < ?7))`,
      id, requestId, started, attempt, expired()).run()
    : await query(ctx, `INSERT OR IGNORE INTO olvex_ai_turns (business_id,user_id,chat_id,request_id,prompt,state,started_at,attempt)
      SELECT ?1,?2,?3,?4,?5,'pending',?6,?7
      WHERE ${manager} AND EXISTS (SELECT 1 FROM olvex_ai_conversations WHERE ${chatOwner})`,
      id, requestId, prompt, started, attempt).run();
  if (!claimed.meta.changes) {
    const current = await lookup();
    if (current?.prompt !== prompt && current) throw new HttpError(409, "Bu istek kimliği başka bir mesajda kullanılmış.");
    if (current) return { id, state: current.state };
    throw new HttpError(409, "Bu sohbette yanıt bekleyen bir mesaj var.");
  }

  try {
    const { results } = await query(ctx, `SELECT prompt,answer FROM olvex_ai_turns WHERE ${turnOwner}
      AND state = 'complete' AND ${manager}
      AND seq < (SELECT seq FROM olvex_ai_turns WHERE ${turnOwner} AND request_id = ?4)
      ORDER BY seq DESC LIMIT 2`, id, requestId).all();
    const messages = results.reverse().flatMap(row => [
      { role: "user", content: row.prompt }, { role: "assistant", content: row.answer }
    ]);
    const result = await ask(ctx, { branchId, messages: [...messages, { role: "user", content: prompt }] }, { deferProposal: true });
    const { proposal } = result;
    const committed = now();
    const saved = `EXISTS (SELECT 1 FROM olvex_ai_turns WHERE ${turnOwner} AND request_id = ?4 AND attempt = ?5 AND state = 'complete')`;
    const writes = [
      query(ctx, `UPDATE olvex_ai_turns SET state = 'complete', answer = ?6, evidence = ?7, proposal_id = ?8
        WHERE ${turnOwner} AND request_id = ?4 AND attempt = ?5 AND state = 'pending' AND ${manager}`,
        id, requestId, attempt, result.answer, result.evidence ?? null, proposal?.id ?? null),
      query(ctx, `UPDATE olvex_ai_conversations SET updated_at = ?6 WHERE ${chatOwner} AND ${saved}`,
        id, requestId, attempt, committed)
    ];
    if (proposal) writes.push(query(ctx, `INSERT INTO olvex_ai_proposals (business_id, user_id, id, kind, payload, expires_at)
      SELECT ?1,?2,?6,?7,?8,?9 WHERE ${saved}`, id, requestId, attempt,
      proposal.id, proposal.kind, JSON.stringify(proposal), proposal.expires_at));
    const [updated] = await ctx.db.batch(writes);
    if (!updated.meta.changes) throw new HttpError(409, "Sohbet veya işlem yetkisi değişti.");
    return { id, state: "complete", needsBranch: result.needsBranch === true };
  } catch (error) {
    const reason = error instanceof HttpError ? error.message : "Yanıt kaydedilemedi. Tekrar deneyin.";
    await ctx.db.batch([
      query(ctx, `UPDATE olvex_ai_turns SET state = 'failed', error = ?6
        WHERE ${turnOwner} AND request_id = ?4 AND attempt = ?5 AND state = 'pending'`, id, requestId, attempt, reason),
      query(ctx, `UPDATE olvex_ai_conversations SET updated_at = ?6 WHERE ${chatOwner}
        AND EXISTS (SELECT 1 FROM olvex_ai_turns WHERE ${turnOwner} AND request_id = ?4 AND attempt = ?5 AND state = 'failed')`,
        id, requestId, attempt, now())
    ]);
    throw error;
  }
}
