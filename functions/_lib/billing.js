import { HttpError, isPreviewRequest } from "./http.js";
import { billingConfig, canStartTrial, iyzico, minorUnits, plans, legacyPlans, reference, trialIdentityKey, TRIAL_DAYS } from "./iyzico.js";
import { sha256 } from "./session.js";
import { identifier, text } from "./validate.js";

const detailPath = ref => "/v2/subscription/subscriptions/" + ref;
const terminal = ["failed", "canceled", "expired", "upgraded"];
const providerStates = {
  ACTIVE: "active", PENDING: "pending", UNPAID: "unpaid", CANCELED: "canceled", EXPIRED: "expired", UPGRADED: "upgraded"
};

export function requireBilling(env, request) {
  const config = billingConfig(env);
  if (!config) throw new HttpError(503, "Abonelik ödemeleri şu anda kapalı.");
  if (new URL(request.url).origin !== config.origin ||
      (config.environment === "sandbox") !== isPreviewRequest(env, request)) {
    throw new HttpError(403, "Abonelik isteği bu ödeme ortamına ait değil.");
  }
  return config;
}

function present(row, now = Date.now()) {
  const trial = row.plan?.startsWith("profesyonel-") &&
    ["active", "canceling", "canceled"].includes(row.state) && row.trial_started_at != null && row.trial_started_at <= now && row.trial_until > now;
  const paid = ["active", "canceling"].includes(row.state) && row.paid_until > now;
  return {
    id: row.id, plan: row.plan, state: row.state, paidUntil: row.paid_until,
    trialStartedAt: row.trial_started_at ?? null, trialUntil: row.trial_until ?? null, trial: Boolean(trial && !paid),
    tier: trial || paid ? (plans[row.plan] || legacyPlans[row.plan])?.tier ?? "inactive" : "inactive"
  };
}

export async function billingStatus(ctx) {
  const config = billingConfig(ctx.env);
  const preview = isPreviewRequest(ctx.env, ctx.request);
  if (!config || new URL(ctx.request.url).origin !== config.origin || (config.environment === "sandbox" && !preview) ||
      (config.environment === "live" && preview)) {
    return { enabled: false, checkoutEnabled: false, tier: "inactive", subscription: null };
  }
  const row = await ctx.db.prepare(`SELECT * FROM olvex_subscriptions WHERE environment = ? AND business_id = ?
    ORDER BY CASE WHEN state IN ('creating','checkout','pending','active','unpaid','canceling') THEN 0 ELSE 1 END,
      created_at DESC, rowid DESC LIMIT 1`).bind(config.environment, ctx.businessId).first();
  const subscription = row ? present(row) : null;
  return { enabled: true, checkoutEnabled: canStartTrial(ctx, config), tier: subscription?.tier ?? "inactive", subscription };
}

function customerPayload(body, email) {
  const name = text(body.name, "Ad", { max: 100 });
  const surname = text(body.surname, "Soyad", { max: 100 });
  if (typeof body.identityNumber !== "string" || !/^\d{11}$/.test(body.identityNumber)) {
    throw new HttpError(400, "Kimlik numarasını 11 hane olarak girin.");
  }
  if (typeof body.gsmNumber !== "string" || !/^\+905\d{9}$/.test(body.gsmNumber)) {
    throw new HttpError(400, "Cep telefonu numarasını +905 ile başlayan biçimde girin.");
  }
  const billingAddress = {
    address: text(body.address, "Fatura adresi", { max: 300 }),
    city: text(body.city, "İl", { max: 80 }), country: "Turkey", contactName: name + " " + surname
  };
  return { name, surname, email, gsmNumber: body.gsmNumber, identityNumber: body.identityNumber, billingAddress };
}

export async function beginCheckout(ctx, body) {
  const config = requireBilling(ctx.env, ctx.request);
  if (!canStartTrial(ctx, config)) throw new HttpError(403, "Bu ortamda yeni deneme başlatılamaz.");
  if (!Object.hasOwn(plans, body.plan)) throw new HttpError(400, "Geçerli bir plan seçin.");
  if (body.acceptedBillingTerms !== true) throw new HttpError(400, "Deneme ve otomatik yenileme koşullarını onaylayın.");
  const id = identifier(body.requestId);
  const plan = plans[body.plan];
  const planRef = ctx.env[plan.binding];
  const customer = customerPayload(body, ctx.user.email);
  const existing = () => ctx.db.prepare("SELECT * FROM olvex_subscriptions WHERE id = ? AND business_id = ? AND environment = ?")
    .bind(id, ctx.businessId, config.environment).first();
  const repeat = row => {
    if (!row) throw new HttpError(409, "Açık işlem veya önceki deneme bulundu. Eşleştirme için destekle iletişime geçin.");
    if (row.plan !== body.plan) throw new HttpError(409, "Açık bir abonelik işlemi veya kullanımda olan istek kimliği var.");
    return present(row);
  };
  const previous = await existing();
  if (previous) return repeat(previous);
  const checked = await iyzico(config, "/v2/subscription/pricing-plans/" + planRef);
  const remote = checked.data;
  if (checked.status !== "success" || remote?.referenceCode !== planRef || remote.status !== "ACTIVE" ||
      remote.currencyCode !== "TRY" || minorUnits(remote.price) !== plan.amount || remote.paymentInterval !== plan.interval ||
      remote.paymentIntervalCount !== 1 || remote.planPaymentType !== "RECURRING" || remote.trialPeriodDays !== TRIAL_DAYS ||
      (remote.recurrenceCount ?? 0) !== 0) {
    throw new HttpError(503, "iyzico planı yayımlanan ücret ve ödeme dönemiyle uyuşmuyor.");
  }

  const reserve = await ctx.db.prepare(`INSERT INTO olvex_subscriptions
    (id, business_id, environment, plan, plan_ref, state, billing_terms_accepted_at, trial_owner_id, trial_identity_key)
    SELECT ?, ?, ?, ?, ?, 'creating', CURRENT_TIMESTAMP, user_id, ? FROM business_members
    WHERE business_id = ? AND user_id = ? AND role = 'owner'
      AND NOT EXISTS (SELECT 1 FROM olvex_subscriptions prior
        WHERE prior.environment = ? AND prior.provider_ref IS NOT NULL
          AND (prior.business_id = ? OR EXISTS (SELECT 1 FROM business_members owner
            WHERE owner.business_id = prior.business_id AND owner.user_id = ? AND owner.role = 'owner'
              AND (prior.trial_started_at IS NOT NULL OR prior.paid_until IS NOT NULL))))
    ON CONFLICT DO NOTHING`).bind(id, ctx.businessId, config.environment, body.plan, planRef,
      await trialIdentityKey(ctx.env.OLVEX_TRIAL_IDENTITY_SECRET, customer), ctx.businessId, ctx.actorId,
      config.environment, ctx.businessId, ctx.actorId).run();
  if (!reserve.meta.changes) return repeat(await existing());
  const callback = new URL("/api/billing/callback", config.origin);
  callback.searchParams.set("id", id);
  const created = await iyzico(config, "/v2/subscription/checkoutform/initialize", {
    locale: "tr", conversationId: id, callbackUrl: callback.href,
    pricingPlanReferenceCode: planRef, subscriptionInitialStatus: "ACTIVE", customer
  });
  if (created.status === "failure") {
    await ctx.db.prepare("UPDATE olvex_subscriptions SET state = 'failed' WHERE id = ? AND state = 'creating'").bind(id).run();
    throw new HttpError(422, "iyzico ödeme formu oluşturulamadı.");
  }
  if (created.conversationId !== id || !reference(created.token) || typeof created.checkoutFormContent !== "string" ||
      !created.checkoutFormContent) throw new HttpError(502, "iyzico ödeme formu doğrulanamadı.");

  await ctx.db.prepare("UPDATE olvex_subscriptions SET state = 'checkout', token_hash = ? WHERE id = ? AND state = 'creating'")
    .bind(await sha256(created.token), id).run();
  return { id, state: "checkout", checkoutFormContent: created.checkoutFormContent };
}

export async function refreshSubscription(db, config, row, event) {
  const response = await iyzico(config, detailPath(row.provider_ref));
  const data = response.data;
  let sub = data;
  if (Array.isArray(data?.items)) {
    const matches = data.items.filter(item => item?.referenceCode === row.provider_ref);
    sub = matches.length === 1 ? matches[0] : null;
  }
  if (response.status !== "success" || sub?.referenceCode !== row.provider_ref ||
      sub.customerReferenceCode !== row.customer_ref || sub.pricingPlanReferenceCode !== row.plan_ref ||
      !Object.hasOwn(providerStates, sub.subscriptionStatus) || !Array.isArray(sub.orders)) {
    throw new HttpError(502, "iyzico abonelik detayı doğrulanamadı.");
  }
  if (event) {
    const order = sub.orders.find(order => order?.referenceCode === event.orderReferenceCode);
    // A failure can be followed by a successful retry. Ignore the stale failure when the order is already paid.
    const expected = event.iyziEventType === "subscription.order.success" ? ["SUCCESS"] : ["FAILED", "SUCCESS"];
    if (!expected.includes(order?.orderStatus)) throw new HttpError(503, "iyzico ödeme sonucu henüz doğrulanamadı.");
  }
  let state = providerStates[sub.subscriptionStatus];
  if (terminal.includes(row.state)) state = row.state;
  else if (row.state === "canceling" && state === "active") state = "canceling";
  const now = Date.now();
  const price = plans[row.plan] || legacyPlans[row.plan];
  if (!price) throw new HttpError(502, "Abonelik planı tanınmıyor.");
  let trialStart = row.trial_started_at ?? null;
  let trialUntil = row.trial_until ?? null;
  // Only ACTIVE detail can establish a trial. Reconciliation can never move its original dates.
  if (row.billing_terms_accepted_at && Object.hasOwn(plans, row.plan) &&
      (state === "active" || trialStart !== null)) {
    if (sub.trialDays !== TRIAL_DAYS || !Number.isSafeInteger(sub.trialStartDate) ||
        !Number.isSafeInteger(sub.trialEndDate) || sub.trialStartDate <= 0 ||
        sub.trialEndDate - sub.trialStartDate !== TRIAL_DAYS * 86_400_000 ||
        sub.trialStartDate > now || (trialStart !== null && sub.trialStartDate !== trialStart) ||
        (trialUntil !== null && sub.trialEndDate !== trialUntil)) {
      throw new HttpError(502, "iyzico deneme tarihleri doğrulanamadı.");
    }
    trialStart = sub.trialStartDate;
    trialUntil = sub.trialEndDate;
  }
  const paidUntil = sub.orders.reduce((latest, order) => {
    if (order?.orderStatus !== "SUCCESS" || order.currencyCode !== "TRY" ||
        minorUnits(order.price) !== price.amount || !Number.isSafeInteger(order.startPeriod) ||
        !Number.isSafeInteger(order.endPeriod) || order.startPeriod > now ||
        (trialUntil !== null && order.startPeriod < trialUntil) || order.endPeriod <= now) return latest;
    return Math.max(latest, order.endPeriod);
  }, 0) || null;
  if (state === row.state && paidUntil === row.paid_until && trialStart === (row.trial_started_at ?? null) && trialUntil === (row.trial_until ?? null)) return present(row, now);
  const updated = await db.prepare(`UPDATE olvex_subscriptions
    SET state = ?, paid_until = ?, trial_started_at = ?, trial_until = ?, revision = revision + 1
    WHERE id = ? AND revision = ?`).bind(state, paidUntil, trialStart, trialUntil, row.id, row.revision).run();
  if (!updated.meta.changes) throw new HttpError(503, "Abonelik paralel olarak güncellendi. Tekrar deneyin.");
  return present({ ...row, state, paid_until: paidUntil, trial_started_at: trialStart, trial_until: trialUntil }, now);
}

export async function confirmCheckout(db, config, id, token) {
  if (!reference(token)) throw new HttpError(400, "Ödeme formu belirteci geçersiz.");
  const row = await db.prepare("SELECT * FROM olvex_subscriptions WHERE id = ? AND environment = ? AND token_hash = ?")
    .bind(id, config.environment, await sha256(token)).first();
  if (!row) throw new HttpError(404, "Ödeme oturumu bulunamadı.");
  if (row.provider_ref) return refreshSubscription(db, config, row);

  const result = await iyzico(config, "/v2/subscription/checkoutform/" + token + "?conversationId=" + id);
  const sub = result.data;
  if (result.status === "failure") throw new HttpError(422, "Ödeme doğrulanamadı. Abonelik etkinleşmedi.");
  if ((result.token != null && result.token !== token) ||
      (result.conversationId != null && result.conversationId !== id) || sub?.pricingPlanReferenceCode !== row.plan_ref ||
      !reference(sub.referenceCode) || !reference(sub.customerReferenceCode) ||
      !["ACTIVE", "PENDING"].includes(sub.subscriptionStatus)) throw new HttpError(502, "iyzico ödeme sonucu eşleşmedi.");

  await db.prepare(`UPDATE olvex_subscriptions SET provider_ref = ?, customer_ref = ?, state = 'pending', revision = revision + 1
    WHERE id = ? AND state = 'checkout' AND provider_ref IS NULL`).bind(sub.referenceCode, sub.customerReferenceCode, id).run();
  const current = await db.prepare("SELECT * FROM olvex_subscriptions WHERE id = ?").bind(id).first();
  if (current.provider_ref !== sub.referenceCode || current.customer_ref !== sub.customerReferenceCode) {
    throw new HttpError(409, "Ödeme oturumu başka bir sonuçla eşleşti.");
  }
  return refreshSubscription(db, config, current);
}

export async function manageSubscription(ctx, body, cancel = false) {
  const config = requireBilling(ctx.env, ctx.request);
  const id = identifier(body.id);
  const row = await ctx.db.prepare(`SELECT * FROM olvex_subscriptions WHERE id = ? AND environment = ?
    AND business_id = ? AND provider_ref IS NOT NULL`).bind(id, config.environment, ctx.businessId).first();
  if (!row) throw new HttpError(404, "Abonelik bulunamadı.");
  if (!cancel) return refreshSubscription(ctx.db, config, row);
  if (row.state === "canceling") {
    const current = await refreshSubscription(ctx.db, config, row);
    if (current.state !== "canceling" || row.cancel_requested_at > Date.now() - 60_000) return current;
  }
  if (terminal.includes(row.state)) return present(row);
  if (!["active", "canceling"].includes(row.state)) throw new HttpError(409, "İptal için etkin bir abonelik gerekli.");
  const claim = await ctx.db.prepare(`UPDATE olvex_subscriptions SET state = 'canceling', cancel_requested_at = ?, revision = revision + 1
    WHERE id = ? AND revision = ? AND EXISTS (
      SELECT 1 FROM business_members WHERE business_id = ? AND user_id = ? AND role = 'owner'
    )`).bind(Date.now(), id, row.revision, ctx.businessId, ctx.actorId).run();
  if (!claim.meta.changes) throw new HttpError(409, "Abonelik veya yetki değişti. Sayfayı yenileyin.");

  const next = { ...row, state: "canceling", revision: row.revision + 1 };
  const result = await iyzico(config, detailPath(row.provider_ref) + "/cancel", {});
  if (result.status === "failure") {
    await ctx.db.prepare(`UPDATE olvex_subscriptions SET state = 'active', revision = revision + 1
      WHERE id = ? AND state = 'canceling' AND revision = ?`).bind(id, next.revision).run();
    throw new HttpError(422, "iyzico iptal isteğini kabul etmedi.");
  }
  return refreshSubscription(ctx.db, config, next);
}
