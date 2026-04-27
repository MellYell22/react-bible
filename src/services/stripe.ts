import { supabase } from './supabase';

export const createCheckoutSession = async (userId: string, priceId: string) => {
  console.log(`[StripeDebug] Initiating upgrade. UserId: ${userId}, PriceId: ${priceId}`);
  
  if (!supabase) {
    throw new Error('Supabase is not configured');
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase configuration missing');
    }

    console.log("Sending checkout request:", { userId, priceId });
    
    const response = await fetch(`${supabaseUrl}/functions/v1/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || supabaseAnonKey}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ userId, priceId }),
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
    // If the error already has a descriptive message from the server, use it.
    // Otherwise, use a fallback.
    const message = error.message && error.message !== '[object Object]' 
      ? error.message 
      : 'Unable to start checkout. Please try again.';
    throw new Error(message);
  }
};
