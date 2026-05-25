export type SubscriptionTier = 'free' | 'pro' | 'owner';

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
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  stripe_subscription_status?: string;
  stripe_price_id?: string;
  stripe_current_period_end?: string;
}

export interface Scripture {
  verse: string;
  reference: string;
  explanation: string;
}

export interface SavedScripture extends Scripture {
  id: string;
  user_id: string;
  text: string;
  version: string;
  category?: string;
  is_memorized: boolean;
  created_at: string;
}

export interface MoodResponse {
  scriptures: Scripture[];
  encouragement: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  feedback?: 'up' | 'down';
}
