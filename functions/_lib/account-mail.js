
export function accountMailReady(env) {
  if (!env.OLVEX_FROM_EMAIL?.trim()) return false;

  if (env.OLVEX_MAIL_PROVIDER === "cloudflare") {
    return /^[a-f\d]{32}$/i.test(
      env.OLVEX_EMAIL_ACCOUNT_ID ?? ""
    ) && Boolean(env.OLVEX_EMAIL_API_TOKEN);
  }

  return (
    !env.OLVEX_MAIL_PROVIDER ||
    env.OLVEX_MAIL_PROVIDER === "resend"
  ) && Boolean(env.RESEND_API_KEY);
}

export async function sendAccountMail(env, to, subject, text) {
  if (!accountMailReady(env)) {
    console.error("OLVEX_MAIL_CONFIG_MISSING");
    throw new Error("E-posta gönderimi yapılandırılmamış.");
  }

  const cloudflare = env.OLVEX_MAIL_PROVIDER === "cloudflare";
  const provider = cloudflare ? "cloudflare" : "resend";

  const endpoint = cloudflare
    ? `https://api.cloudflare.com/client/v4/accounts/${env.OLVEX_EMAIL_ACCOUNT_ID}/email/sending/send`
    : "https://api.resend.com/emails";

  const key = cloudflare
    ? env.OLVEX_EMAIL_API_TOKEN
    : env.RESEND_API_KEY;

  let response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env.OLVEX_FROM_EMAIL,
        to: cloudflare ? to : [to],
        subject,
        text
      }),
      signal: AbortSignal.timeout(10000),
      redirect: "error"
    });
  } catch (error) {
    console.error("OLVEX_MAIL_NETWORK_ERROR", {
      provider,
      errorType: error?.name || "UnknownError"
    });

    throw new Error("E-posta sağlayıcısına erişilemedi.");
  }

  let acknowledgement;

  try {
    acknowledgement = await response.json();
  } catch {
    console.error("OLVEX_MAIL_INVALID_RESPONSE", {
      provider,
      status: response.status
    });

    throw new Error("E-posta sağlayıcısı geçersiz yanıt verdi.");
  }

  if (!response.ok) {
    const rawCode = acknowledgement?.code
      ?? acknowledgement?.error?.code;

    console.error("OLVEX_MAIL_PROVIDER_ERROR", {
      provider,
      status: response.status,
      code: typeof rawCode === "string"
        ? rawCode.slice(0, 80).replace(/[^a-zA-Z0-9_-]/g, "")
        : "unknown"
    });

    throw new Error("E-posta sağlayıcısı isteği reddetti.");
  }

  if (!cloudflare && acknowledgement?.id) {
    return;
  }

  const result = acknowledgement?.result;

  if (
    cloudflare &&
    acknowledgement.success === true &&
    result?.message_id &&
    [result.delivered, result.queued].some(
      group => Array.isArray(group) && group.includes(to)
    )
  ) {
    return;
  }

  console.error("OLVEX_MAIL_UNEXPECTED_RESPONSE", {
    provider,
    status: response.status
  });

  throw new Error("E-posta sağlayıcısı isteği kabul etmedi.");
}
