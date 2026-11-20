import { polarClient, verifyPolarSignature } from "./polar-http.js";
import { HttpError } from "./http.js";
import { polarConfig, uuid } from "./polar-config.js";
import { launchCharge, monthlyPriceKurus, publicPricing } from "./pricing.js";

const DAY = 86400000;
const legacyOpen = "('creating','checkout','pending','active','unpaid','canceling')";
const date = value => typeof value === "string" ? Date.parse(value) : NaN;
const eligibleEvents = new Set([
  "checkout.updated", "checkout.expired", "subscription.created", "subscription.updated", "subscription.active", "subscription.cycled",
  "subscription.canceled", "subscription.uncanceled", "subscription.revoked", "subscription.past_due",
  "subscription.paused", "subscription.resumed", "order.created", "order.updated", "order.paid", "order.refunded",
  "refund.created", "refund.updated"
]);

function required(ctx) {
  const config = polarConfig(ctx);
  if (!config) throw new HttpError(503, "Polar ödemeleri bu ortamda kapalı.");
  return config;
}

function hostedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.port || url.username || url.password ||
      !["polar.sh", "sandbox.polar.sh", "buy.polar.sh", "buy.sandbox.polar.sh"].includes(url.hostname)) {
    throw new HttpError(502, "Polar bağlantısı doğrulanamadı.");
  }
  return url.href;
}

export async function polarStatus(ctx) {
  const config = polarConfig(ctx);
  if (!config) return { enabled: false };
  const row = await ctx.db.prepare(`SELECT state, offer, paid_until AS paidUntil, trial_until AS trialUntil,
      subscription_id IS NOT NULL AS canManage, closed
    FROM olvex_polar_checkouts WHERE business_id = ? AND environment = ? ORDER BY closed ASC, created_at DESC LIMIT 1`)
    .bind(ctx.businessId, config.mode).first();
  return { enabled: true, launch: Boolean(publicPricing(ctx.env).olvex.launch), subscription: row };
}

export async function polarCheckout(ctx, body, client) {
  const config = required(ctx);
  if (body.offer !== "standard" && body.offer !== "launch") throw new HttpError(400, "Geçerli bir teklif seçin.");
  const launch = body.offer === "launch";
  const pricing = publicPricing(ctx.env).olvex;
  if (launch && !pricing.launch) throw new HttpError(409, "Lansman teklifi yeni başvurulara kapalı.");
  const product = launch ? config.launch : config.standard;
  const discount = launch ? config.discount : null;
  const latest = () => ctx.db.prepare("SELECT * FROM olvex_polar_checkouts WHERE business_id = ? AND environment = ? AND closed = 0")
    .bind(ctx.businessId, config.mode).first();

  const previous = await latest();
  if (previous) {
    if (previous.state === "open" && previous.expires_at > Date.now() && previous.offer === body.offer &&
        previous.actor_id === ctx.actorId) return { url: hostedUrl(previous.checkout_url) };
    throw new HttpError(409, "Bu işletmenin açık bir ödeme veya abonelik işlemi var.");
  }
  const id = crypto.randomUUID();
  const reserved = await ctx.db.prepare(`INSERT INTO olvex_polar_checkouts
    (id,business_id,actor_id,environment,offer,product_id,discount_id,created_at)
    SELECT ?,?,?,?,?,?,?,? FROM business_members
    WHERE business_id = ? AND user_id = ? AND role = 'owner'
      AND NOT EXISTS (SELECT 1 FROM olvex_subscriptions WHERE business_id = ? AND environment = ? AND state IN ${legacyOpen})
      AND (? = 'launch' OR NOT EXISTS (SELECT 1 FROM olvex_polar_checkouts
        WHERE business_id = ? AND environment = ? AND used_trial = 1))
    ON CONFLICT DO NOTHING`).bind(id, ctx.businessId, ctx.actorId, config.mode, body.offer, product, discount, Date.now(),
      ctx.businessId, ctx.actorId, ctx.businessId, config.mode, body.offer, ctx.businessId, config.mode).run();
  if (!reserved.meta.changes) throw new HttpError(409, "Bu işletme için yeni ödeme veya deneme başlatılamıyor.");

  const endpoint = new URL("/billing.html", config.origin);
  endpoint.searchParams.set("business", ctx.businessId);
  const success = new URL(endpoint);
  success.searchParams.set("returned", "1");
  // Keep ambiguous provider failures reserved for reconciliation rather than creating a second session.
  try {
    const checkout = await (client ?? polarClient(config)).checkouts.create({
      products: [product], currency: "try", customer_email: ctx.user.email,
      external_customer_id: ctx.businessId, metadata: { olvex_checkout: id },
      allow_discount_codes: false, allow_trial: !launch,
      ...(launch ? { discount_id: discount } : { trial_interval: "day", trial_interval_count: pricing.standard.trialDays }),
      return_url: endpoint.href, success_url: success.href
    });
    const trialMatches = launch ? checkout.allow_trial === false && !checkout.active_trial_interval :
      checkout.active_trial_interval === "day" && checkout.active_trial_interval_count === pricing.standard.trialDays &&
      checkout.is_payment_setup_required === true;
    const priceMatches = checkout.product_price?.price_amount === monthlyPriceKurus && checkout.tax_behavior === "inclusive" &&
      checkout.product?.recurring_interval === "month" && checkout.product?.recurring_interval_count === 1;
    if (!uuid(checkout.id) || checkout.status !== "open" || checkout.product_id !== product ||
        checkout.external_customer_id !== ctx.businessId || checkout.metadata?.olvex_checkout !== id ||
        (checkout.discount_id ?? null) !== discount || checkout.currency !== "try" ||
        checkout.allow_discount_codes !== false || !trialMatches || !priceMatches ||
        !Number.isFinite(date(checkout.expires_at)) ||
        (launch && (checkout.total_amount !== pricing.launch.discountedKurus ||
          checkout.discount?.duration !== "repeating" || checkout.discount.duration_in_months !== pricing.launch.discountedPeriods))) {
      throw new Error("Checkout terms mismatch");
    }
    const url = hostedUrl(checkout.url);
    const saved = await ctx.db.prepare(`UPDATE olvex_polar_checkouts SET checkout_id = ?, checkout_url = ?, expires_at = ?, state = 'open'
      WHERE id = ? AND state = 'creating' AND EXISTS (
        SELECT 1 FROM business_members WHERE business_id = ? AND user_id = ? AND role = 'owner')`)
      .bind(checkout.id, url, date(checkout.expires_at), id, ctx.businessId, ctx.actorId).run();
    if (!saved.meta.changes) throw new Error("Checkout reservation changed");
    return { url };
  } catch {
    throw new HttpError(502, "Polar ödeme oturumu doğrulanamadı. İşlem durumunu kontrol edin.");
  }
}

export async function polarPortal(ctx, _body, client) {
  const config = required(ctx);
  const row = await ctx.db.prepare(`SELECT 1 FROM olvex_polar_checkouts
    WHERE business_id = ? AND environment = ? AND subscription_id IS NOT NULL LIMIT 1`)
    .bind(ctx.businessId, config.mode).first();
  if (!row) throw new HttpError(404, "Yönetilecek Polar aboneliği bulunamadı.");
  const back = new URL("/billing.html", config.origin);
  back.searchParams.set("business", ctx.businessId);
  try {
    const session = await (client ?? polarClient(config)).customerSessions.create({ external_customer_id: ctx.businessId, return_url: back.href });
    return { url: hostedUrl(session.customer_portal_url) };
  } catch {
    throw new HttpError(502, "Polar müşteri paneli açılamadı.");
  }
}

export function polarAccess(row, subscription, orders, now = Date.now()) {
  const start = date(subscription.current_period_start);
  const end = date(subscription.current_period_end);
  const trialStart = date(subscription.trial_start);
  const trialEnd = date(subscription.trial_end);
  const trial = row.offer === "standard" && subscription.status === "trialing" &&
    trialStart >= row.created_at - 300000 && trialStart <= now && trialEnd > now &&
    trialEnd - trialStart === 14 * DAY;
  const validOrders = orders.filter(o => (o.paid === true || ["refunded", "partially_refunded"].includes(o.status)) && o.total_amount > 0 &&
    ["subscription_create", "subscription_cycle"].includes(o.billing_reason))
    .sort((a, b) => date(a.created_at) - date(b.created_at) || a.id.localeCompare(b.id));
  const matches = validOrders.every((order, index) => {
    const expected = row.offer === "launch" ?
      launchCharge("olvex-monthly-launch-v1", index + 1).amountKurus : monthlyPriceKurus;
    return order.subscription_id === subscription.id && order.customer_id === subscription.customer_id &&
      order.product_id === row.product_id && order.currency === "try" && order.total_amount === expected &&
      Number.isFinite(date(order.created_at)) && order.applied_balance_amount === 0;
  });
  const latest = validOrders.at(-1);
  const paid = subscription.status === "active" && start <= now && end > now && matches && latest?.status === "paid" &&
    latest.refunded_amount === 0 && latest.refunded_tax_amount === 0 && date(latest.created_at) >= start - 300000 &&
    date(latest.created_at) < end;
  return { paidUntil: paid ? end : null, trialUntil: trial ? trialEnd : null };
}

export async function processPolarEvent(ctx, config, event, delivery, client = polarClient(config)) {
  if (!eligibleEvents.has(event.type)) return;
  const data = event.data;
  const checkoutEvent = event.type.startsWith("checkout.");
  const subscriptionEvent = event.type.startsWith("subscription.");
  const subscriptionId = subscriptionEvent ? data.id : data.subscription_id;
  const local = checkoutEvent || subscriptionEvent ? data.metadata?.olvex_checkout : null;
  if (!uuid(data.id) || (!uuid(local) && !uuid(subscriptionId))) return;
  const db = ctx.env.DB;
  if (await db.prepare("SELECT 1 FROM olvex_polar_events WHERE environment = ? AND delivery_id = ?")
    .bind(config.mode, delivery).first()) return;
  let row = await db.prepare("SELECT * FROM olvex_polar_checkouts WHERE environment = ? AND (id = ? OR subscription_id = ?)")
    .bind(config.mode, uuid(local) ? local : null, uuid(subscriptionId) ? subscriptionId : null).first();
  let subscription;
  if (!row && uuid(subscriptionId)) {
    subscription = await client.subscriptions.get(subscriptionId);
    const metadataId = subscription.metadata?.olvex_checkout;
    if (!uuid(metadataId)) return;
    row = await db.prepare("SELECT * FROM olvex_polar_checkouts WHERE environment = ? AND id = ?")
      .bind(config.mode, metadataId).first();
  }
  if (!row) return;
  const verifiedExpiry = checkoutEvent && data.status === "expired" && data.external_customer_id === row.business_id &&
    data.product_id === row.product_id && local === row.id;
  if (!row.checkout_id && !verifiedExpiry) throw new HttpError(503, "Polar oturumu henüz işlenmedi.");

  let values;
  if (checkoutEvent && !uuid(subscriptionId)) {
    if (!verifiedExpiry || (row.checkout_id && data.id !== row.checkout_id) || !["open", "creating"].includes(row.state)) return;
    values = ["expired", 1, null, null, null, 0];
  } else {
    if (!uuid(subscriptionId) || (row.subscription_id && row.subscription_id !== subscriptionId)) return;
    subscription = await client.subscriptions.get(subscriptionId);
    if (subscription.id !== subscriptionId || subscription.checkout_id !== row.checkout_id ||
        subscription.metadata?.olvex_checkout !== row.id || subscription.customer?.external_id !== row.business_id ||
        subscription.product_id !== row.product_id || subscription.currency !== "try" ||
        subscription.recurring_interval !== "month" || subscription.recurring_interval_count !== 1) {
      throw new HttpError(502, "Polar aboneliği işletmeyle eşleştirilemedi.");
    }

    const orders = [];
    let page = 1;
    for (;;) {
      const result = await client.orders.list({ subscription_id: subscriptionId, page, limit: 100 });
      orders.push(...result.items);
      if (page >= result.pagination.max_page) break;
      if (++page > 24) throw new HttpError(503, "Polar sipariş geçmişi uzlaştırma gerektiriyor.");
    }
    if (new Set(orders.map(order => order.id)).size !== orders.length) throw new HttpError(503, "Polar sipariş listesi değişti.");
    const refundedId = event.type === "order.refunded" ? data.id :
      event.type.startsWith("refund.") && data.status === "succeeded" ? data.order_id : null;
    const access = polarAccess(row, subscription, refundedId ?
      orders.map(order => order.id === refundedId ? { ...order, status: "refunded" } : order) : orders);
    // For trialing, confirm the original hosted checkout succeeded before enabling the bounded trial.
    if (access.trialUntil) {
      const receipt = await client.checkouts.get(row.checkout_id);
      if (receipt.status !== "succeeded" || receipt.subscription_id !== subscriptionId ||
          receipt.customer_id !== subscription.customer_id) throw new HttpError(503, "Deneme doğrulaması bekleniyor.");
    }
    const closed = ["canceled", "incomplete_expired", "trial_ended"].includes(subscription.status);
    values = [subscription.status, Number(closed), access.paidUntil, access.trialUntil, subscriptionId, Number(Boolean(access.trialUntil))];
  }

  const [updated] = await db.batch([
    db.prepare(`UPDATE olvex_polar_checkouts SET state = ?, closed = ?, paid_until = ?, trial_until = ?, subscription_id = ?,
      used_trial = MAX(used_trial, ?), last_event = ?, revision = revision + 1 WHERE id = ? AND revision = ?
      AND NOT EXISTS (SELECT 1 FROM olvex_polar_events WHERE environment = ? AND delivery_id = ?)`)
      .bind(...values, delivery, row.id, row.revision, config.mode, delivery),
    db.prepare(`INSERT INTO olvex_polar_events
      SELECT ?, ?, id, ?, ?, ?, state, paid_until, trial_until FROM olvex_polar_checkouts WHERE id = ? AND revision = ? AND last_event = ?
      ON CONFLICT DO NOTHING`).bind(config.mode, delivery, event.type, data.id, Date.now(), row.id, row.revision + 1, delivery)
  ]);
  if (!updated.meta.changes && !await db.prepare("SELECT 1 FROM olvex_polar_events WHERE environment = ? AND delivery_id = ?")
    .bind(config.mode, delivery).first()) throw new HttpError(503, "Abonelik durumu değişti. Bildirim yeniden denenmeli.");
}

export async function polarWebhook(ctx) {
  const config = required(ctx);
  const delivery = ctx.request.headers.get("webhook-id") ?? "";
  if (!/^[\w-]{1,160}$/.test(delivery)) throw new HttpError(403, "Polar imzası doğrulanamadı.");
  const reader = ctx.request.body?.getReader();
  if (!reader) throw new HttpError(400, "Bildirim gövdesi gerekli.");
  const buffer = new Uint8Array(262144);
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (size + value.length > buffer.length) {
      await reader.cancel();
      throw new HttpError(413, "Bildirim çok büyük.");
    }
    buffer.set(value, size);
    size += value.length;
  }
  let requestText;
  try {
    requestText = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
  } catch {
    throw new HttpError(400, "Geçersiz bildirim metni.");
  }
  if (!await verifyPolarSignature(requestText, ctx.request.headers, config.secret)) {
    throw new HttpError(403, "Polar imzası doğrulanamadı.");
  }
  let event;
  try {
    event = JSON.parse(requestText);
    if (typeof event?.type !== "string" || !event.data || typeof event.data !== "object" ||
        (event.api_version && event.api_version !== "2026-10")) throw new Error();
  } catch {
    throw new HttpError(400, "Polar bildirim biçimi doğrulanamadı.");
  }
  await processPolarEvent(ctx, config, event, delivery);
  return { received: true };
}
