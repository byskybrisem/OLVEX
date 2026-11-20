import { handle, HttpError, json, readJson, sameOrigin } from "../../_lib/http.js";
import { adminData, adminFinanceAction, markRightsResponded, requirePlatformAdmin } from "../../_lib/platform-admin.js";

export const onRequestGet = handle(async ({ env, request, params }) => {
  const admin = await requirePlatformAdmin(request, env);
  const data = await adminData(env.DB, params.section, new URL(request.url).searchParams, admin);
  return json({ success: true, ...data });
});

export const onRequestPost = handle(async ({ env, request, params }) => {
  sameOrigin(request);
  const admin = await requirePlatformAdmin(request, env);
  if (!["finance", "rights"].includes(params.section)) throw new HttpError(405, "Bu işlem desteklenmiyor.");
  const input = await readJson(request, 4096);
  if (params.section === "rights") return json(await markRightsResponded(env.DB, input, admin));
  return json(await adminFinanceAction(env.DB, input, admin));
});
