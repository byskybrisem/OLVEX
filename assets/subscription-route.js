export function subscriptionOffer(value) {
  return value === "standard" || value === "launch" ? value : null;
}

export function subscriptionDestination(offer, business) {
  const params = new URLSearchParams();
  if (business) params.set("business", business);
  if (subscriptionOffer(offer)) params.set("offer", offer);
  return "/billing.html" + (params.size ? "?" + params : "");
}
