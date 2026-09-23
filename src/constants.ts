export const APP_NAME = 'Bible Mood Search';
export const AUTHOR_CREDIT = 'Created by AA Designs';

export const PLANS = {
  FREE: {
    id: 'free',
    name: 'Free Plan',
    price: '$0',
    interval: 'month',
    priceId: null,
    features: [
      'Daily Verse of the Day',
      '5 messages a day with David',
      '3 reflections a day',
    ],
  },
  PLUS: {
    id: 'plus',
    name: 'Bible Plus',
    price: '$9.99',
    interval: 'month',
    // No dead fallback: unset env means Plus checkout is unavailable, by design.
    priceId: import.meta.env.VITE_STRIPE_PRICE_ID_PLUS || null,
    features: [
      'Unlimited chat with David',
      'Unlimited reflections',
      'Saved favorites & bookmarks',
      'Chat history sync',
      'Ad-free experience',
    ],
  },
  PRO: {
    id: 'pro',
    name: "David's Voice Pro",
    price: '$12.99',
    interval: 'month',
    // No dead fallback: unset env means Pro checkout is unavailable, by design.
    priceId: import.meta.env.VITE_STRIPE_PRICE_ID_PRO || null,
    features: [
      'Everything in Bible Plus',
      "David's voice chat",
      'Deeper scripture reflections',
      'Priority responses',
    ],
  },
};
