import { HttpError } from "./http.js";
import { billingConfig, iyzico, minorUnits, plans, reference } from "./iyzico.js";
import { sha256 } from "./session.js";
import { identifier, text } from "./validate.js";

const detailPath = ref => "/v2/subscription/subscriptions/" + ref;
const terminal = ["failed", "canceled", "expired", "upgraded"];
const providerStates = {
  ACTIVE: "active", PENDING: "pending", UNPAID: "unpaid", CANCELED: "canceled", EXPIRED: "expired", UPGRADED: "upgraded"
};

export function requireBilling(env) {
  const config = billingConfig(env);
  if (!config) throw new HttpError(503, "Abonelik ödemeleri şu anda kapalı.");
  return config;
}

function present(row, now = Date.now()) {
  return {
    id: row.id, plan: row.plan, state: row.state, paidUntil: row.paid_until,
    tier: ["active", "canceling"].includes(row.state) && row.paid_until > now ? plans[row.plan].tier : "free"
  };
}

export async function billingStatus(ctx) {
  const config = billingConfig(ctx.env);
  if (!config) return { enabled: false, tier: "free", subscription: null };
  const row = await ctx.db.prepare(`SELECT * FROM olvex_subscriptions WHERE environment = ? AND business_id = ?
    ORDER BY CASE WHEN state IN ('creating','checkout','pending','active','unpaid','canceling') THEN 0 ELSE 1 END,
      created_at DESC, rowid DESC LIMIT 1`).bind(config.environment, ctx.businessId).first();
  const subscription = row ? present(row) : null;
  return { enabled: true, tier: subscription?.tier ?? "free", subscription };
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
  const config = requireBilling(ctx.env);
  if (Object.hasOwn(body, "offerId")) throw new HttpError(503, "Bu teklif için Polar üzerinden ödeme henüz açık değil.");
  if (!Object.hasOwn(plans, body.plan)) throw new HttpError(400, "Geçerli bir plan seçin.");
  const id = identifier(body.requestId);
  const plan = plans[body.plan];
  const planRef = ctx.env[plan.binding];
  const existing = () => ctx.db.prepare("SELECT * FROM olvex_subscriptions WHERE id = ? AND business_id = ? AND environment = ?")
    .bind(id, ctx.businessId, config.environment).first();
  const repeat = row => {
    if (row?.plan !== body.plan) throw new HttpError(409, "Açık bir abonelik işlemi veya kullanımda olan istek kimliği var.");
    return present(row);
  };
  const previous = await existing();
  if (previous) return repeat(previous);
  if (body.plan !== "profesyonel-monthly") throw new HttpError(409, "Bu abonelik yeni satışa kapalı.");
  const customer = customerPayload(body, ctx.user.email);

  const checked = await iyzico(config, "/v2/subscription/pricing-plans/" + planRef);
  const remote = checked.data;
  if (checked.status !== "success" || remote?.referenceCode !== planRef || remote.status !== "ACTIVE" ||
      remote.currencyCode !== "TRY" || minorUnits(remote.price) !== plan.amount || remote.paymentInterval !== plan.interval ||
      remote.paymentIntervalCount !== 1 || remote.planPaymentType !== "RECURRING" || (remote.trialPeriodDays ?? 0) !== 0 ||
      (remote.recurrenceCount ?? 0) !== 0) {
    throw new HttpError(503, "iyzico planı yayımlanan ücret ve ödeme dönemiyle uyuşmuyor.");
  }

  const reserve = await ctx.db.prepare(`INSERT INTO olvex_subscriptions (id, business_id, environment, plan, plan_ref, state)
    SELECT ?, ?, ?, ?, ?, 'creating' FROM business_members WHERE business_id = ? AND user_id = ? AND role = 'owner'
    ON CONFLICT DO NOTHING`).bind(id, ctx.businessId, config.environment, body.plan, planRef, ctx.businessId, ctx.actorId).run();
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
  const paidUntil = sub.orders.reduce((latest, order) => {
    if (order?.orderStatus !== "SUCCESS" || order.currencyCode !== "TRY" ||
        minorUnits(order.price) !== plans[row.plan].amount || !Number.isSafeInteger(order.startPeriod) ||
        !Number.isSafeInteger(order.endPeriod) || order.startPeriod > now || order.endPeriod <= now) return latest;
    return Math.max(latest, order.endPeriod);
  }, 0) || null;
  if (state === row.state && paidUntil === row.paid_until) return present(row, now);
  const updated = await db.prepare(`UPDATE olvex_subscriptions SET state = ?, paid_until = ?, revision = revision + 1
    WHERE id = ? AND revision = ?`).bind(state, paidUntil, row.id, row.revision).run();
  if (!updated.meta.changes) throw new HttpError(503, "Abonelik paralel olarak güncellendi. Tekrar deneyin.");
  return present({ ...row, state, paid_until: paidUntil }, now);
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
  const config = requireBilling(ctx.env);
  const id = identifier(body.id);
  const row = await ctx.db.prepare(`SELECT * FROM olvex_subscriptions WHERE id = ? AND environment = ?
    AND business_id = ? AND provider_ref IS NOT NULL`).bind(id, config.environment, ctx.businessId).first();
  if (!row) throw new HttpError(404, "Abonelik bulunamadı.");
  if (!cancel || row.state === "canceling") return refreshSubscription(ctx.db, config, row);
  if (terminal.includes(row.state)) return present(row);
  if (row.state !== "active") throw new HttpError(409, "İptal için etkin bir abonelik gerekli.");
  const claim = await ctx.db.prepare(`UPDATE olvex_subscriptions SET state = 'canceling', revision = revision + 1
    WHERE id = ? AND revision = ? AND EXISTS (
      SELECT 1 FROM business_members WHERE business_id = ? AND user_id = ? AND role = 'owner'
    )`).bind(id, row.revision, ctx.businessId, ctx.actorId).run();
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
