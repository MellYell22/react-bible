export type SubscriptionTier = 'free' | 'plus' | 'pro' | 'owner';

export type BibleTranslation = 'KJV' | 'NIV' | 'ESV' | 'NKJV' | 'NASB' | 'NLT' | 'CSB' | 'AMP' | 'MSG';

export type ResponseLength = 'short' | 'medium' | 'long';

export interface Profile {
  id: string;
  email: string;
  subscription_tier: SubscriptionTier;
  created_at: string;
  has_completed_onboarding: boolean;
  preferred_translation: BibleTranslation;
  preferred_response_length: ResponseLength;
  verse_of_the_day_enabled: boolean;
  verse_of_the_day_time: string; // ISO time string or HH:mm
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
