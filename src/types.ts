export type SubscriptionTier = 'free' | 'plus' | 'pro' | 'owner';

export type BibleTranslation = 'KJV' | 'NIV' | 'ESV' | 'NKJV' | 'NASB';

export interface Profile {
  id: string;
  email: string;
  subscription_tier: SubscriptionTier;
  created_at: string;
  has_completed_onboarding: boolean;
  preferred_translation: BibleTranslation;
}

export interface Scripture {
  verse: string;
  reference: string;
  explanation: string;
}

export interface MoodResponse {
  scriptures: Scripture[];
  encouragement: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  feedback?: 'up' | 'down';
}
