import { Profile } from '../types';

export const OWNER_EMAIL = 'alissasmith.apps@gmail.com';

// Owner lives in profiles.role. The database constrains subscription_tier to
// free | plus | pro, so it can never hold 'owner' — the tier check below is a
// legacy safety net only, and role is the source of truth.
export const isOwner = (profile: Profile | null): boolean => {
  if (!profile) return false;
  return profile.role === 'owner'
    || profile.email?.toLowerCase() === OWNER_EMAIL
    || (profile.subscription_tier as string) === 'owner';
};

// Premium = unlimited chat. Both Plus and Pro qualify (and owner).
export const hasPremiumAccess = (profile: Profile | null): boolean => {
  if (!profile) return false;
  if (isOwner(profile)) return true;
  return profile.subscription_tier === 'plus' || profile.subscription_tier === 'pro';
};

// Voice (David's spoken voice) is Pro-only (and owner).
export const hasProAccess = (profile: Profile | null): boolean => {
  if (!profile) return false;
  if (isOwner(profile)) return true;
  return profile.subscription_tier === 'pro';
};

// Convenience alias for voice-specific gating; currently equals Pro access.
export const hasVoiceAccess = hasProAccess;
