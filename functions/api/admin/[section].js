import { handle, HttpError, json, readJson, sameOrigin } from "../../_lib/http.js";
import { adminData, adminFinanceAction, requirePlatformAdmin } from "../../_lib/platform-admin.js";

export const onRequestGet = handle(async ({ env, request, params }) => {
  const admin = await requirePlatformAdmin(request, env);
  const data = await adminData(env.DB, params.section, new URL(request.url).searchParams, admin);
  return json({ success: true, ...data });
});

export const onRequestPost = handle(async ({ env, request, params }) => {
  sameOrigin(request);
  const admin = await requirePlatformAdmin(request, env);
  if (params.section !== "finance") throw new HttpError(405, "Bu işlem desteklenmiyor.");
  const input = await readJson(request, 4096);
  return json(await adminFinanceAction(env.DB, input, admin));
});
