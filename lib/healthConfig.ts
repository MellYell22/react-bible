import { stripeModeFromSecretKey } from './subscriptionState.js';

type Environment = Record<string, string | undefined>;

const isConfigured = (value: string | undefined) => Boolean(value?.trim());
const isValidPriceId = (value: string | undefined) => Boolean(value?.trim().startsWith('price_'));

export const getLaunchHealth = (env: Environment) => {
  const core = {
    OPENAI_API_KEY: isConfigured(env.OPENAI_API_KEY),
    VITE_SUPABASE_URL: isConfigured(env.VITE_SUPABASE_URL || env.SUPABASE_URL),
    VITE_SUPABASE_ANON_KEY: isConfigured(env.VITE_SUPABASE_ANON_KEY),
    APP_URL: isConfigured(env.APP_URL),
  };

  const billing = {
    STRIPE_SECRET_KEY: isConfigured(env.STRIPE_SECRET_KEY),
    STRIPE_WEBHOOK_SECRET: isConfigured(env.STRIPE_WEBHOOK_SECRET),
    SUPABASE_WRITE_KEY: isConfigured(
      env.SB_SECRET_KEY || env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    // A tier is only "configured" if it holds a REAL price id. No dead fallback.
    STRIPE_PRICE_ID_PRO: isValidPriceId(env.STRIPE_PRICE_ID_PRO),
    STRIPE_PRICE_ID_PLUS: isValidPriceId(env.STRIPE_PRICE_ID_PLUS),
  };

  const optional = {};

  const coreReady = Object.values(core).every(Boolean);
  const billingReady = Object.values(billing).every(Boolean);
  const launchReady = coreReady && billingReady;

  return {
    status: launchReady ? 'ok' : 'degraded',
    launchReady,
    allConfigured: launchReady,
    configured: core,
    billing: {
      configured: billing,
      ready: billingReady,
      stripeMode: stripeModeFromSecretKey(env.STRIPE_SECRET_KEY),
    },
    optional,
  };
};
