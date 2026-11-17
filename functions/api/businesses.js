import { handle, HttpError, json, readJson, sameOrigin } from "../_lib/http.js";
import { requireUser } from "../_lib/session.js";
import { identifier, text } from "../_lib/validate.js";

export const onRequestGet = handle(async ({ request, env }) => {
  const db = env.DB;
  const user = await requireUser(request, db);
  const { results } = await db.prepare(`
    SELECT b.id, b.name, b.created_at, m.role FROM business_members m
    JOIN businesses b ON b.id = m.business_id WHERE m.user_id = ?
    ORDER BY b.created_at, b.id
  `).bind(user.id).all();
  return json({ success: true, businesses: results });
});

export const onRequestPost = handle(async ({ request, env }) => {
  sameOrigin(request);
  const db = env.DB;
  const user = await requireUser(request, db);
  const data = await readJson(request, 4096);
  const name = text(data.name, "İşletme adı", { min: 2, max: 100 });
  const id = data.requestId ? identifier(data.requestId) : crypto.randomUUID();

  try {
    await db.batch([
      db.prepare("INSERT INTO businesses (id, name, created_by) VALUES (?, ?, ?)").bind(id, name, user.id),
      db.prepare("INSERT INTO business_members (id, business_id, user_id, role) VALUES (?, ?, ?, 'owner')")
        .bind(crypto.randomUUID(), id, user.id)
    ]);
  } catch (error) {
    if (!error.message?.includes("UNIQUE constraint failed: businesses.id")) throw error;
    const existing = await db.prepare(`SELECT b.name FROM businesses b JOIN business_members m ON m.business_id = b.id
      WHERE b.id = ? AND m.user_id = ? AND m.role = 'owner'`).bind(id, user.id).first();
    if (existing?.name !== name) throw new HttpError(409, "Bu istek kimliği kullanılmış.");
  }

  return json({ success: true, business: { id, name, role: "owner" } }, 201);
});
