import { supabase } from './supabase';

export const createCheckoutSession = async (priceId?: string | null) => {
  console.log("Using Stripe Price ID:", priceId || 'server-configured-pro-price');
  console.log(`[StripeDebug] Initiating upgrade. PriceId: ${priceId || 'server-configured-pro-price'}`);
  
  if (!supabase) {
    throw new Error('Supabase is not configured');
  }

  try {
    // 1. Retrieve the authenticated user using Supabase auth as requested
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      throw new Error("You must be logged in to upgrade.");
    }

    const userId = user.id;
    const { data: { session } } = await supabase.auth.getSession();
    
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

    if (publishableKey) {
      console.log(`[StripeDebug] Frontend Mode: ${publishableKey.startsWith('pk_test_') ? 'TEST' : 'LIVE'}`);
    }

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase configuration missing');
    }

    console.log("Using Stripe Price ID:", priceId || 'server-configured-pro-price');
    console.log("Sending checkout request:", { userId, priceId: priceId || 'server-configured-pro-price' });
    
    const response = await fetch(`${supabaseUrl}/functions/v1/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || supabaseAnonKey}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ userId, ...(priceId ? { priceId } : {}) }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`[StripeDebug] Edge Function error response:`, errorData);
      throw new Error(errorData.error || errorData.message || 'Unable to start checkout. Please try again.');
    }

    const data = await response.json();

    if (data?.url) {
      console.log(`[StripeDebug] Success. Redirecting to: ${data.url}`);
      window.location.href = data.url;
      return;
    } else {
      throw new Error('No checkout URL received from server.');
    }
  } catch (error: any) {
    console.error(`[StripeDebug] Checkout session error: ${error.message}`);
    throw new Error(error.message || 'Unable to start checkout. Please try again.');
  }
};
