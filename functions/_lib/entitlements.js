import { polarConfig } from "./polar-config.js";
import { billingConfig } from "./iyzico.js";
import { HttpError, isPreviewRequest } from "./http.js";
import { hasSubscriptionExemption } from "./platform-admin.js";

export const paidMessage = "Aktif aboneliğiniz bulunmuyor. İşletme kayıtlarınızı görüntüleyebilirsiniz.";
export const billingUnavailable = "OLVEX abonelik sistemi hazırlanıyor. İşletme verileriniz güvende. Ücretli erişim açıldığında buradan devam edebilirsiniz.";
export const professionalMessage = "Bu özellik mevcut aboneliğinizin kapsamı dışında.";

export function subscriptionEnvironment({ env, request }) {
  return (env.OLVEX_BILLING === "sandbox" || env.OLVEX_POLAR === "sandbox") && isPreviewRequest(env, request) ? "sandbox" : "live";
}

function paidSubscription(professionalOnly = false, business = "?", environment = "?") {
  return `SELECT ${professionalOnly ? "1" : "plan, paid_until, trial_until"} FROM olvex_subscription_access
    WHERE business_id = ${business} AND environment = ${environment}
      AND MAX(COALESCE(paid_until, 0), COALESCE(trial_until, 0)) >
        CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4) AS INTEGER)
      ${professionalOnly ? "AND plan IN ('profesyonel-monthly','profesyonel-yearly')" : ""}`
}

export const paidAt = (business, environment) => `EXISTS (${paidSubscription(false, business, environment)})`;
export const paidSql = paidAt("?", "?");
export const professionalSql = `EXISTS (${paidSubscription(true)})`;
export const branchLimitSql = `CASE WHEN ${professionalSql} THEN 5 ELSE 1 END`;
export const seatLimitSql = `CASE WHEN ${professionalSql} THEN 10 ELSE 2 END`;
export const pendingInvitesSql = "accepted_by IS NULL AND revoked_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export async function entitlement(ctx) {
  const exempt = await hasSubscriptionExemption(ctx);
  if (exempt) {
    ctx.subscriptionExempt = true;
    return { exempt: true, professional: true, tier: "profesyonel", paidUntil: null, trialUntil: null,
      limits: { businesses: 1, branches: 5, users: 10 } };
  }
  ctx.subscriptionExempt = false;
  const environment = subscriptionEnvironment(ctx);
  const row = await ctx.db.prepare(paidSubscription()).bind(ctx.businessId, environment).first();
  const professional = row?.plan.startsWith("profesyonel-") === true;
  const tier = row ? (professional ? "profesyonel" : "esnaf") : "inactive";
  return { exempt: false, professional, tier, paidUntil: row?.paid_until ?? null, trialUntil: row?.trial_until ?? null,
    limits: row ? { businesses: 1, branches: professional ? 5 : 1, users: professional ? 10 : 2 } : null };
}

export async function requireProfessional(ctx) {
  const plan = await entitlement(ctx);
  if (!plan.professional) throw new HttpError(403, professionalMessage);
  return subscriptionEnvironment(ctx);
}

export async function requirePaidSubscription(ctx, { professional = false } = {}) {
  const environment = subscriptionEnvironment(ctx);
  const plan = await entitlement(ctx);
  if (!plan.exempt && !plan.paidUntil && !plan.trialUntil) {
    throw new HttpError(403, billingAvailable(ctx) ? paidMessage : paidMessage + " " + billingUnavailable);
  }
  if (professional && !plan.professional) throw new HttpError(403, professionalMessage);
  return plan.exempt
    ? { sql: "1", values: () => [] }
    : { sql: professional ? professionalSql : paidSql, values: id => [id, environment] };
}

export function billingAvailable(ctx) {
  const config = billingConfig(ctx.env);
  return Boolean(polarConfig(ctx) || config && config.environment === subscriptionEnvironment(ctx));
}

export function branchCapacity(ctx) {
  const environment = subscriptionEnvironment(ctx);
  const exempt = ctx.subscriptionExempt === true;
  return {
    sql: `(SELECT COUNT(*) FROM olvex_branches WHERE business_id = ?) < ${exempt ? "5" : branchLimitSql}`,
    values: id => exempt ? [id] : [id, id, environment],
    message: "Aboneliğinizin şube sınırı doldu."
  };
}

export function inviteCapacity(ctx, role) {
  const environment = subscriptionEnvironment(ctx);
  const exempt = ctx.subscriptionExempt === true;
  return {
    sql: `(SELECT COUNT(*) FROM business_members WHERE business_id = ?) +
      (SELECT COUNT(*) FROM olvex_invitations WHERE business_id = ? AND ${pendingInvitesSql}) < ${exempt ? "10" : seatLimitSql}
      ${role === "admin" && !exempt ? "AND " + professionalSql : ""}`,
    values: id => exempt ? [id, id] : [id, id, id, environment, ...(role === "admin" ? [id, environment] : [])],
    message: "Paketinizin kullanıcı sınırı doldu veya seçilen rol paketinize dahil değil. Bekleyen davetler kullanıcı sınırına dahildir."
  };
}

export async function packageStatus(ctx) {
  const [plan, counts] = await Promise.all([entitlement(ctx), ctx.db.prepare(`SELECT
    (SELECT COUNT(*) FROM olvex_branches WHERE business_id = ?1) AS branches,
    (SELECT COUNT(*) FROM business_members WHERE business_id = ?1) AS users,
    (SELECT COUNT(*) FROM olvex_invitations WHERE business_id = ?1 AND ${pendingInvitesSql}) AS invitations
  `).bind(ctx.businessId).first()]);
  return { ...plan, counts, billingAvailable: billingAvailable(ctx), polarAvailable: Boolean(polarConfig(ctx)) };
}
