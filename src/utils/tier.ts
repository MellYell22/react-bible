import { Profile } from '../types';

export const OWNER_EMAIL = 'alissasmith.apps@gmail.com';

export const hasProAccess = (profile: Profile | null): boolean => {
  if (!profile) return false;
  if (profile.email === OWNER_EMAIL || profile.subscription_tier === 'owner') return true;
  return profile.subscription_tier === 'pro';
};
