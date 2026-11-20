import { isPreviewRequest } from "./http.js";

export const uuid = value => typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export function polarConfig({ env, request }) {
  const mode = env.OLVEX_POLAR;
  if (mode !== "sandbox" && mode !== "live") return null;
  const preview = isPreviewRequest(env, request);
  if (!(mode === "sandbox" && preview || mode === "live" && !preview)) return null;
  const origin = new URL(request.url).origin;
  if (!origin.startsWith("https://") || origin !== env.OLVEX_POLAR_ORIGIN) return null;
  const { POLAR_ACCESS_TOKEN: token, POLAR_WEBHOOK_SECRET: secret, POLAR_STANDARD_PRODUCT_ID: standard,
    POLAR_LAUNCH_PRODUCT_ID: launch, POLAR_LAUNCH_DISCOUNT_ID: discount } = env;
  if (!token || !secret || ![standard, launch, discount].every(uuid) || standard === launch) return null;
  return { mode, origin, token, secret, standard, launch, discount };
}
