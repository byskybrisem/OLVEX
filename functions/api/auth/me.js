import { handle, json } from "../../_lib/http.js";
import { requireUser } from "../../_lib/session.js";

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env.DB).catch((error) => {
    if (error.status !== 401) throw error;
    return null;
  });
  if (!user) return json({ authenticated: false }, 401);
  return json({ authenticated: true, user: { id: user.id, email: user.email, fullName: user.full_name } });
});
