// Version the commercial terms independently of the window for new enrollments.
const professionalMonthlyOffers = Object.freeze({
  "professional-standard-v1": Object.freeze({
    currency: "TRY",
    monthlyKurus: 99900,
    trialDays: 14
  }),
  "professional-launch-v1": Object.freeze({
    currency: "TRY",
    monthlyKurus: 99900,
    trialDays: 0,
    discountedKurus: 69900,
    discountedPeriods: 3
  })
});

export const packagePrices = Object.freeze({
  "esnaf-monthly": 49900,
  "esnaf-yearly": 479040,
  "profesyonel-monthly": professionalMonthlyOffers["professional-standard-v1"].monthlyKurus,
  "profesyonel-yearly": 959040
});

export function professionalCharge(offerId, paidPeriod) {
  if (!Object.hasOwn(professionalMonthlyOffers, offerId) || !Number.isSafeInteger(paidPeriod) || paidPeriod < 1) return null;
  const offer = professionalMonthlyOffers[offerId];
  return {
    currency: offer.currency,
    amountKurus: paidPeriod <= (offer.discountedPeriods ?? 0) ? offer.discountedKurus : offer.monthlyKurus
  };
}

function utcTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return NaN;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value.replace("Z", ".000Z") ? timestamp : NaN;
}

export function publicPricing(env, now = Date.now()) {
  const standard = professionalMonthlyOffers["professional-standard-v1"];
  const starts = env.OLVEX_LAUNCH_OFFER_STARTS_AT ? utcTimestamp(env.OLVEX_LAUNCH_OFFER_STARTS_AT) : -Infinity;
  const ends = env.OLVEX_LAUNCH_OFFER_ENDS_AT ? utcTimestamp(env.OLVEX_LAUNCH_OFFER_ENDS_AT) : Infinity;
  const offerId = "professional-launch-v1";
  const launch = professionalMonthlyOffers[offerId];
  const savingsPerPeriod = professionalCharge(offerId, launch.discountedPeriods + 1).amountKurus -
    professionalCharge(offerId, 1).amountKurus;
  return {
    professional: {
      standard,
      launch: env.OLVEX_LAUNCH_OFFER === "on" && starts <= now && now < ends ? {
        ...launch,
        id: offerId,
        savingsKurus: savingsPerPeriod * launch.discountedPeriods,
        discountPercent: Math.round(savingsPerPeriod / launch.monthlyKurus * 100)
      } : null
    }
  };
}
