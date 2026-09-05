import { supabase } from './supabase';

const getSupabaseFunctionConfig = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase configuration missing');
  }

  return { supabaseUrl, supabaseAnonKey };
};

const getAuthenticatedRequestHeaders = async () => {
  if (!supabase) {
    throw new Error('Supabase is not configured');
  }

  const { data: { session } } = await supabase.auth.getSession();
  const { supabaseAnonKey } = getSupabaseFunctionConfig();

  if (!session?.access_token) {
    throw new Error('Your sign-in session expired. Please sign in again before upgrading.');
  }

  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
    'apikey': supabaseAnonKey,
  };
};

const getFunctionErrorMessage = async (response: Response, fallback: string) => {
  const errorData = await response.json().catch(() => ({}));
  return errorData.error || errorData.message || fallback;
};

export type CheckoutPlan = 'plus' | 'pro';

export const createCheckoutSession = async (plan: CheckoutPlan = 'pro') => {
  if (plan !== 'plus' && plan !== 'pro') {
    throw new Error('Invalid subscription plan selected.');
  }

  console.log(`[StripeDebug] Initiating ${plan} checkout.`);

  if (!supabase) {
    throw new Error('Supabase is not configured');
  }

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      throw new Error("You must be logged in to upgrade.");
    }

    const { supabaseUrl } = getSupabaseFunctionConfig();
    const headers = await getAuthenticatedRequestHeaders();
    const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

    if (publishableKey) {
      console.log(`[StripeDebug] Frontend Mode: ${publishableKey.startsWith('pk_test_') ? 'TEST' : 'LIVE'}`);
    }

    console.log(`[StripeDebug] Sending authenticated ${plan} checkout request.`);

    const response = await fetch(`${supabaseUrl}/functions/v1/create-checkout-session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ plan }),
    });

    if (!response.ok) {
      throw new Error(await getFunctionErrorMessage(response, 'Unable to start checkout. Please try again.'));
    }

    const data = await response.json();

    if (data?.url) {
      console.log(`[StripeDebug] Success. Redirecting to: ${data.url}`);
      window.location.assign(data.url);
      return;
    } else {
      throw new Error('No checkout URL received from server.');
    }
  } catch (error: any) {
    console.error(`[StripeDebug] Checkout session error: ${error.message}`);
    throw new Error(error.message || 'Unable to start checkout. Please try again.');
  }
};

/**
 * Open the Stripe Customer Portal so the user can manage their existing
 * subscription (update payment method, cancel, view invoices). This ONLY opens
 * the portal — it does not create, change, or cancel anything itself. All
 * products, prices, webhooks, and billing logic are untouched.
 */
export const openCustomerPortal = async () => {
  if (!supabase) {
    throw new Error('Supabase is not configured');
  }

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error('You must be logged in to manage your subscription.');
    }

    const { supabaseUrl } = getSupabaseFunctionConfig();
    const headers = await getAuthenticatedRequestHeaders();

    const response = await fetch(`${supabaseUrl}/functions/v1/create-customer-portal-session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(await getFunctionErrorMessage(response, 'Unable to open the subscription portal. Please try again.'));
    }

    const data = await response.json();

    if (data?.url) {
      window.location.assign(data.url);
      return;
    }

    throw new Error('No portal URL received from server.');
  } catch (error: any) {
    console.error(`[StripeDebug] Customer portal error: ${error.message}`);
    throw new Error(error.message || 'Unable to open the subscription portal. Please try again.');
  }
};

export const syncCheckoutSession = async (sessionId: string) => {
  if (!sessionId) {
    throw new Error('Missing Stripe Checkout Session ID.');
  }

  const { supabaseUrl } = getSupabaseFunctionConfig();
  const headers = await getAuthenticatedRequestHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/sync-checkout-session`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    throw new Error(await getFunctionErrorMessage(response, 'Unable to verify your completed checkout.'));
  }

  return response.json();
};
