export function recoveryOrigin(env) {
  try {
    const url = new URL(env.OLVEX_PUBLIC_ORIGIN ?? "https://olvex.com.tr");
    if (url.protocol !== "https:" || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}
