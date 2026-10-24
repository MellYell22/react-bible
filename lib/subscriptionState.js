// Single source of truth for subscription tier logic.
//
// IMPORTANT: There is intentionally NO hardcoded default price ID here.
// A missing/misconfigured Stripe price must fail loudly (or resolve to a
// non-paid tier) rather than silently falling back to a dead test price,
// which previously caused paying customers to be treated as free.

const PAID_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);
const ACCEPTED_CHECKOUT_PAYMENT_STATUSES = new Set(['paid', 'no_payment_required']);

// Environment variable names for each paid tier's Stripe price.
export const PRICE_ENV_BY_TIER = Object.freeze({
  plus: 'STRIPE_PRICE_ID_PLUS',
  pro: 'STRIPE_PRICE_ID_PRO',
});

const isValidPriceId = (value) => typeof value === 'string' && value.startsWith('price_');

export const getStripeId = (value) => {
  if (typeof value === 'string') return value;
  if (value && typeof value.id === 'string') return value.id;
  return null;
};

export const getSubscriptionPriceIds = (subscription) => {
  const items = subscription?.items?.data;
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => item?.price?.id)
    .filter((priceId) => typeof priceId === 'string' && priceId.length > 0);
};

export const isPaidSubscriptionStatus = (status) => PAID_SUBSCRIPTION_STATUSES.has(status);

export const isCheckoutPaymentAccepted = (paymentStatus) => (
  ACCEPTED_CHECKOUT_PAYMENT_STATUSES.has(paymentStatus)
);

export const isExpectedPrice = (priceIds, expectedPriceId) => (
  isValidPriceId(expectedPriceId)
  && Array.isArray(priceIds)
  && priceIds.includes(expectedPriceId)
);

// Reads configured tier prices from the environment. Only returns entries
// that look like real Stripe price IDs; missing/blank/invalid are dropped.
export const getConfiguredTierPrices = (env = (typeof process !== 'undefined' ? process.env : {})) => {
  const prices = {};
  for (const [tier, envName] of Object.entries(PRICE_ENV_BY_TIER)) {
    const value = env?.[envName]?.trim();
    if (isValidPriceId(value)) prices[tier] = value;
  }
  return prices;
};

// Given a set of price IDs on a subscription and a map of configured tier
// prices ({ plus, pro }), return which paid tier matches, or null.
export const matchTierByPriceIds = (priceIds, tierPrices) => {
  if (!Array.isArray(priceIds) || !tierPrices) return null;
  // Pro takes precedence if somehow both match (defensive).
  if (tierPrices.pro && priceIds.includes(tierPrices.pro)) return 'pro';
  if (tierPrices.plus && priceIds.includes(tierPrices.plus)) return 'plus';
  return null;
};

// Multi-tier resolver. Owner is always preserved. A paid status with an
// unrecognized price THROWS, so we never silently downgrade a real payer.
// Non-paid status resolves to 'free'.
export const resolveTierStrict = ({
  currentTier,
  status,
  priceIds,
  tierPrices,
  subscriptionId = 'unknown',
}) => {
  if (currentTier === 'owner') return 'owner';
  if (!isPaidSubscriptionStatus(status)) return 'free';

  const matched = matchTierByPriceIds(priceIds, tierPrices);
  if (matched) return matched;

  throw new Error(
    `Active subscription ${subscriptionId} uses an unconfigured Stripe price `
    + `(${(priceIds || []).join(', ') || 'none'}); refusing to silently downgrade.`,
  );
};

// Backward-compatible single-price resolver used by the existing webhook lib.
// Now delegates to the strict multi-tier logic. If only a single expected
// price is provided (legacy callers passing just proPriceId), it is treated
// as the Pro price. Unknown paid price -> 'free' here (non-throwing) to keep
// the existing lib/stripeWebhook.ts ignore-based flow intact; that lib already
// pre-filters with isExpectedPrice before calling.
/**
 * @param {{ currentTier?: any, status?: any, priceIds?: any, expectedPriceId?: any, tierPrices?: any }} args
 */
export const deriveSubscriptionTier = ({
  currentTier,
  status,
  priceIds,
  expectedPriceId,
  tierPrices,
} = {}) => {
  if (currentTier === 'owner') return 'owner';
  if (!isPaidSubscriptionStatus(status)) return 'free';

  const prices = tierPrices || (isValidPriceId(expectedPriceId) ? { pro: expectedPriceId } : {});
  return matchTierByPriceIds(priceIds, prices) || 'free';
};

export const stripeModeFromSecretKey = (secretKey) => {
  if (typeof secretKey !== 'string') return 'unknown';
  if (secretKey.startsWith('sk_live_')) return 'live';
  if (secretKey.startsWith('sk_test_')) return 'test';
  return 'unknown';
};

// ---------------------------------------------------------------------------
// Entitlements: who actually gets paid features RIGHT NOW.
//
// A profile's `subscription_tier` is only a cached label written by the Stripe
// webhook. It can go stale (a lost webhook, a subscription from an old Stripe
// account, a trial that ended months ago, a hand-edited row). Every gate in
// the app — UI and server — must go through resolveAccessTier() instead of
// reading subscription_tier directly.
// ---------------------------------------------------------------------------

export const OWNER_EMAIL = 'alissasmith.apps@gmail.com';

// How long past the recorded period end we keep access while waiting for the
// renewal webhook to land. Protects paying customers from a late webhook
// without letting an abandoned subscription live on for weeks.
export const PERIOD_END_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

const PAID_TIERS = new Set(['plus', 'pro']);

const toTime = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

/**
 * Owner access is separate from billing. Only the owner role or the one
 * designated owner email qualifies — never a tier label, never a test account.
 * @param {any} profile
 * @param {string | null} [userEmail] verified email from the auth session
 */
export const isOwnerAccount = (profile, userEmail = null) => {
  if (profile?.role === 'owner') return true;
  const email = (userEmail || profile?.email || '').trim().toLowerCase();
  return email === OWNER_EMAIL;
};

/**
 * True only when the profile carries a real, current Stripe subscription:
 * a Stripe customer, a Stripe subscription id, an active/trialing status,
 * and a billing period that has not run out.
 * @param {any} profile
 * @param {Date | number} [now]
 */
export const hasActivePaidSubscription = (profile, now = Date.now()) => {
  if (!profile) return false;
  const subscriptionId = profile.stripe_subscription_id;
  const customerId = profile.stripe_customer_id;
  if (typeof subscriptionId !== 'string' || !subscriptionId.startsWith('sub_')) return false;
  if (typeof customerId !== 'string' || !customerId.startsWith('cus_')) return false;
  if (!isPaidSubscriptionStatus(profile.stripe_subscription_status)) return false;

  const periodEnd = toTime(profile.stripe_current_period_end);
  if (periodEnd === null) return false;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  return periodEnd + PERIOD_END_GRACE_MS > nowMs;
};

/**
 * The tier a person may use right now: 'owner' | 'pro' | 'plus' | 'free'.
 * @param {{ profile: any, userEmail?: string | null, now?: Date | number }} args
 */
export const resolveAccessTier = ({ profile, userEmail = null, now = Date.now() } = /** @type {any} */ ({})) => {
  if (isOwnerAccount(profile, userEmail)) return 'owner';
  const tier = profile?.subscription_tier;
  if (!PAID_TIERS.has(tier)) return 'free';
  return hasActivePaidSubscription(profile, now) ? tier : 'free';
};

/** Unlimited text chat: Plus, Pro, or owner. */
export const canUsePremium = (accessTier) => accessTier === 'owner' || accessTier === 'pro' || accessTier === 'plus';

/** David's voice and other Pro-only features: Pro or owner. */
export const canUsePro = (accessTier) => accessTier === 'owner' || accessTier === 'pro';

/** Columns every server gate must select to call resolveAccessTier. */
export const ENTITLEMENT_COLUMNS = 'role, email, subscription_tier, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, stripe_current_period_end';
