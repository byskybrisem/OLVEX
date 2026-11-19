const mailbox = /^[^\s@<>]+@(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i;
const resendCodes = new Set([
  "missing_api_key", "restricted_api_key", "invalid_api_key", "suspended_api_key",
  "invalid_permission", "validation_error", "invalid_from_address", "invalid_sender",
  "rate_limit_exceeded", "daily_quota_exceeded", "monthly_quota_exceeded",
  "application_error", "internal_server_error"
]);

function mailConfig(env) {
  const provider = env.OLVEX_MAIL_PROVIDER?.trim() || "resend";
  if (provider !== "resend" && provider !== "cloudflare") return { provider: "unknown", issue: "unsupported_provider" };
  const from = env.OLVEX_FROM_EMAIL?.trim();
  if (!mailbox.test(from ?? "")) return { provider, issue: "invalid_from" };
  if (provider === "cloudflare") {
    const accountId = env.OLVEX_EMAIL_ACCOUNT_ID?.trim();
    const key = env.OLVEX_EMAIL_API_TOKEN?.trim();
    if (!/^[a-f\d]{32}$/i.test(accountId ?? "") || !key || /\s/.test(key)) {
      return { provider, issue: "invalid_credentials_config" };
    }
    return { provider, from, key,
      endpoint: `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send` };
  }
  const key = env.RESEND_API_KEY?.trim();
  if (!key || /\s/.test(key)) return { provider, issue: "invalid_credentials_config" };
  return { provider, from, key, endpoint: "https://api.resend.com/emails" };
}

export function accountMailReady(env) {
  return !mailConfig(env).issue;
}

function rejection(provider, status, payload) {
  if (provider !== "resend") return { outcome: "provider_rejected" };
  const code = resendCodes.has(payload?.name) ? payload.name : undefined;
  const message = typeof payload?.message === "string" ? payload.message : "";
  let outcome = "provider_rejected";
  if (["restricted_api_key", "invalid_permission"].includes(code)) {
    outcome = "permission_denied";
  } else if (status === 401 || ["invalid_api_key", "missing_api_key", "suspended_api_key"].includes(code) ||
      (status === 400 && code === "validation_error" && /^api key is invalid[.!]?$/i.test(message))) {
    outcome = "credentials_rejected";
  } else if (["invalid_from_address", "invalid_sender"].includes(code) ||
      (status === 403 && code === "validation_error" &&
        /domain.{0,253}is not verified|only send testing emails/i.test(message))) {
    outcome = "sender_rejected";
  } else if (status === 429) {
    outcome = "provider_rate_limit";
  }
  return { outcome, code };
}

export async function sendAccountMail(env, to, subject, text, flow) {
  const { provider, from, key, endpoint, issue } = mailConfig(env);
  const context = { provider, flow };
  const fail = (outcome, status, code) => {
    console.error("OLVEX_ACCOUNT_MAIL", { ...context, outcome, status, code });
    throw new Error("E-posta sağlayıcısı isteği kabul etmedi.");
  };
  if (issue) fail(issue);

  const cloudflare = provider === "cloudflare";
  const signal = AbortSignal.timeout(10000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: cloudflare ? to : [to], subject, text }),
      signal,
      redirect: "error"
    });
  } catch (error) {
    fail(signal.aborted || error?.name === "TimeoutError" ? "timeout" : "network_error");
  }

  let acknowledgement;
  try {
    acknowledgement = await response.json();
  } catch (error) {
    if (signal.aborted || error?.name === "TimeoutError") fail("timeout", response.status);
    if (response.ok) fail("invalid_response", response.status);
  }

  if (!response.ok) {
    const { outcome, code } = rejection(provider, response.status, acknowledgement);
    fail(outcome, response.status, code);
  }
  const result = acknowledgement?.result;
  const accepted = cloudflare
    ? acknowledgement?.success === true && result?.message_id &&
      [result.delivered, result.queued].some(group => Array.isArray(group) && group.includes(to))
    : typeof acknowledgement?.id === "string" && acknowledgement.id.trim() !== "";
  if (!accepted) fail("invalid_response", response.status);
  console.info("OLVEX_ACCOUNT_MAIL", { ...context, outcome: "provider_accepted", status: response.status });
}
