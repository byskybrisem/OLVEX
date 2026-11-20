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

const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = value => value.replace(/[&<>"']/g, char => entities[char]);

export function accountLinkMessage({ heading, instructions, label, url }) {
  const expiry = "Bağlantı 30 dakika geçerlidir ve yalnızca bir kez kullanılabilir.";
  const ignore = "Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.";
  const text = [heading, instructions, expiry, url, ignore].join("\n\n");
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(heading)}</title></head>
    <body style="margin:0;padding:20px;background:#f3f4fa;color:#161b2c;font-family:Arial,sans-serif;font-size:16px;line-height:1.5">
      <div style="max-width:480px;margin:0 auto;padding:20px;background:#fff">
        <h1 style="font-size:24px;line-height:1.2">${escapeHtml(heading)}</h1>
        <p>${escapeHtml(instructions)}</p>
        <p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 16px;background:#43289a;color:#fff;text-decoration:underline">${escapeHtml(label)}</a></p>
        <p>${expiry}</p><p>${ignore}</p>
      </div>
    </body></html>`;
  return { subject: heading, text, html };
}

export async function sendAccountMail(env, to, subject, text, flow, html) {
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
      body: JSON.stringify({ from, to: cloudflare ? to : [to], subject, text, ...(!cloudflare && html ? { html } : {}) }),
      signal,
      redirect: "manual"
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
