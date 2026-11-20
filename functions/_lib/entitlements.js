import { HttpError, isPreviewRequest } from "./http.js";

export const professionalMessage = "Bu özellik Profesyonel pakette kullanılabilir.";

export function subscriptionEnvironment({ env, request }) {
  return env.OLVEX_BILLING === "sandbox" && isPreviewRequest(env, request) ? "sandbox" : "live";
}

function paidSubscription(professionalOnly = false) {
  return `SELECT ${professionalOnly ? "1" : "plan, paid_until"} FROM olvex_subscriptions
    WHERE business_id = ? AND environment = ? AND state IN ('active','canceling')
      AND paid_until > CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4) AS INTEGER)
      AND provider_ref IS NOT NULL AND customer_ref IS NOT NULL
      ${professionalOnly ? "AND plan IN ('profesyonel-monthly','profesyonel-yearly')" : ""}`;
}

export const professionalSql = `EXISTS (${paidSubscription(true)})`;
export const branchLimitSql = `CASE WHEN ${professionalSql} THEN 5 ELSE 1 END`;
export const seatLimitSql = `CASE WHEN ${professionalSql} THEN 10 ELSE 2 END`;
export const pendingInvitesSql = "accepted_by IS NULL AND revoked_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export async function entitlement(ctx) {
  const environment = subscriptionEnvironment(ctx);
  const row = await ctx.db.prepare(paidSubscription()).bind(ctx.businessId, environment).first();
  const professional = row?.plan.startsWith("profesyonel-") === true;
  const tier = row ? (professional ? "profesyonel" : "esnaf") : "free";
  return { professional, tier, paidUntil: row?.paid_until ?? null,
    limits: { businesses: 1, branches: professional ? 5 : 1, users: professional ? 10 : 2 } };
}

export async function requireProfessional(ctx) {
  const plan = await entitlement(ctx);
  if (!plan.professional) throw new HttpError(403, professionalMessage);
  return subscriptionEnvironment(ctx);
}

export function professionalGuard(environment) {
  return {
    sql: professionalSql, values: id => [id, environment], message: professionalMessage
  };
}

export function branchCapacity(ctx) {
  const environment = subscriptionEnvironment(ctx);
  return {
    sql: `(SELECT COUNT(*) FROM olvex_branches WHERE business_id = ?) < ${branchLimitSql}`,
    values: id => [id, id, environment],
    message: "Paketinizin şube sınırı doldu. Esnaf 1, Profesyonel 5 şube destekler."
  };
}

export function inviteCapacity(ctx, role) {
  const environment = subscriptionEnvironment(ctx);
  return {
    sql: `(SELECT COUNT(*) FROM business_members WHERE business_id = ?) +
      (SELECT COUNT(*) FROM olvex_invitations WHERE business_id = ? AND ${pendingInvitesSql}) < ${seatLimitSql}
      ${role === "admin" ? "AND " + professionalSql : ""}`,
    values: id => [id, id, id, environment, ...(role === "admin" ? [id, environment] : [])],
    message: "Paketinizin kullanıcı sınırı doldu veya seçilen rol paketinize dahil değil. Bekleyen davetler kullanıcı sınırına dahildir."
  };
}

export async function packageStatus(ctx) {
  const [plan, counts] = await Promise.all([entitlement(ctx), ctx.db.prepare(`SELECT
    (SELECT COUNT(*) FROM olvex_branches WHERE business_id = ?1) AS branches,
    (SELECT COUNT(*) FROM business_members WHERE business_id = ?1) AS users,
    (SELECT COUNT(*) FROM olvex_invitations WHERE business_id = ?1 AND ${pendingInvitesSql}) AS invitations
  `).bind(ctx.businessId).first()]);
  return { ...plan, counts };
}
