import { Profile } from '../types';
import {
  OWNER_EMAIL as SHARED_OWNER_EMAIL,
  canUsePremium,
  canUsePro,
  isOwnerAccount,
  resolveAccessTier,
} from '../../lib/subscriptionState.js';

export const OWNER_EMAIL = SHARED_OWNER_EMAIL;

// Owner access is independent of Stripe billing (owner role or the one
// designated owner email only).
export const isOwner = (profile: Profile | null): boolean => {
  if (!profile) return false;
  return isOwnerAccount(profile);
};

/**
 * The tier this person can actually use right now. Never trusts the cached
 * subscription_tier label alone — it must be backed by a current Stripe
 * subscription (customer id, subscription id, active/trialing status and a
 * billing period that has not run out). The server applies the same rule.
 */
export const getAccessTier = (profile: Profile | null): 'owner' | 'pro' | 'plus' | 'free' => {
  if (!profile) return 'free';
  return resolveAccessTier({ profile }) as 'owner' | 'pro' | 'plus' | 'free';
};

// Premium = unlimited chat for valid Plus/Pro subscriptions or the owner.
export const hasPremiumAccess = (profile: Profile | null): boolean => canUsePremium(getAccessTier(profile));

// Pro-only features, including David's voice.
export const hasProAccess = (profile: Profile | null): boolean => canUsePro(getAccessTier(profile));

export const hasVoiceAccess = hasProAccess;
