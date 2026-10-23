import { Profile } from '../types';

export const OWNER_EMAIL = 'alissasmith.apps@gmail.com';

// Owner access is independent of Stripe billing.
export const isOwner = (profile: Profile | null): boolean => {
  if (!profile) return false;
  return profile.role === 'owner'
    || profile.email?.toLowerCase() === OWNER_EMAIL
    || (profile.subscription_tier as string) === 'owner';
};

// Never trust a cached tier alone: it can remain Pro after checkout fails
// or a subscription is canceled. Stripe webhooks synchronize this status.
const hasValidSubscription = (profile: Profile | null): boolean => {
  if (!profile?.stripe_subscription_id) return false;
  return profile.stripe_subscription_status === 'active'
    || profile.stripe_subscription_status === 'trialing';
};

// Premium = unlimited chat for valid Plus/Pro subscriptions or the owner.
export const hasPremiumAccess = (profile: Profile | null): boolean => {
  if (!profile) return false;
  if (isOwner(profile)) return true;
  return (profile.subscription_tier === 'plus' || profile.subscription_tier === 'pro')
    && hasValidSubscription(profile);
};

// Pro-only features, including voice. This changes entitlement checks only,
// not David's voice, audio settings, or conversation behavior.
export const hasProAccess = (profile: Profile | null): boolean => {
  if (!profile) return false;
  if (isOwner(profile)) return true;
  return profile.subscription_tier === 'pro' && hasValidSubscription(profile);
};

export const hasVoiceAccess = hasProAccess;
