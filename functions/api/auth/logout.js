import { handle, json, sameOrigin } from "../../_lib/http.js";
import { sessionCookie, sessionHash } from "../../_lib/session.js";

export const onRequestPost = handle(async ({ request, env }) => {
  sameOrigin(request);
  const hash = await sessionHash(request);
  if (hash) await env.DB.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(hash).run();
  return json({ success: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
});
