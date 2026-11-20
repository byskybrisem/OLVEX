export const monthlyPriceKurus = 99900;

const standard = Object.freeze({ currency: "TRY", monthlyKurus: monthlyPriceKurus, trialDays: 14 });
const launch = Object.freeze({
  id: "olvex-monthly-launch-v1",
  currency: "TRY",
  monthlyKurus: monthlyPriceKurus,
  trialDays: 0,
  discountedKurus: 70000,
  discountedPeriods: 3
});

// The launch window applies to new signups only. Once sold, keep the versioned terms.
export function launchCharge(offerId, paidPeriod) {
  if (offerId !== launch.id || !Number.isSafeInteger(paidPeriod) || paidPeriod < 1) return null;
  return {
    currency: launch.currency,
    amountKurus: paidPeriod <= launch.discountedPeriods ? launch.discountedKurus : launch.monthlyKurus
  };
}

function utcTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return NaN;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value.replace("Z", ".000Z") ? timestamp : NaN;
}

export function publicPricing(env, now = Date.now()) {
  const starts = env.OLVEX_LAUNCH_OFFER_STARTS_AT ? utcTimestamp(env.OLVEX_LAUNCH_OFFER_STARTS_AT) : -Infinity;
  const ends = env.OLVEX_LAUNCH_OFFER_ENDS_AT ? utcTimestamp(env.OLVEX_LAUNCH_OFFER_ENDS_AT) : Infinity;
  return { olvex: { standard, launch: env.OLVEX_LAUNCH_OFFER === "on" && starts <= now && now < ends ? launch : null } };
}
