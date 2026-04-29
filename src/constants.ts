export const APP_NAME = 'Bible Mood Search';
export const AUTHOR_CREDIT = 'Created by AA Designs';

export const PLANS = {
  FREE: {
    id: 'free',
    name: 'Free Plan',
    price: '$0',
    interval: 'mo',
    priceId: null,
    features: [
      'Daily Verse of the Day',
      'Basic Mood Search (3/day)',
      'Short AI Reflections',
    ],
  },
  PRO: {
    id: 'pro',
    name: 'Pro Plan',
    price: '$9.99',
    interval: 'mo',
    priceId: import.meta.env.VITE_STRIPE_PRICE_ID_PRO,
    features: [
      'Unlimited Everything',
      'Long AI Reflections',
      'Live Voice Chat with David',
      'Advanced AI Companion',
      'Early Access to Features',
    ],
  },
};
