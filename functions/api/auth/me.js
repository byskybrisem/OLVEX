import { handle, json, readJson, sameOrigin } from "../../_lib/http.js";
import { requireUser } from "../../_lib/session.js";
import { text } from "../../_lib/validate.js";

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env.DB).catch((error) => {
    if (error.status !== 401) throw error;
    return null;
  });
  if (!user) return json({ authenticated: false }, 401);
  return json({ authenticated: true, user: { id: user.id, email: user.email, fullName: user.full_name } });
});

export const onRequestPost = handle(async ({ request, env }) => {
  sameOrigin(request);
  const user = await requireUser(request, env.DB);
  const { fullName } = await readJson(request, 2048);
  const name = text(fullName, "Ad soyad", { min: 2, max: 100 });
  await env.DB.prepare("UPDATE users SET full_name = ? WHERE id = ?").bind(name, user.id).run();
  return json({ fullName: name });
});
