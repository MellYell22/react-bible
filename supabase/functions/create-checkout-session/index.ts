import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();
    console.log("[create-checkout-session] Received body:", JSON.stringify(body));
    const { priceId } = body;

    if (!priceId) {
      console.error("[create-checkout-session] Error: Missing priceId");
      return new Response(
        JSON.stringify({ error: "Missing priceId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user strictly from JWT to verify and get identity
    let userId: string | undefined = undefined;
    let userEmail: string | undefined = undefined;
    
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("[create-checkout-session] Error: Missing Authorization header");
      return new Response(
        JSON.stringify({ error: "Unauthorized: Missing auth header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      console.error(`[create-checkout-session] Auth error or user not found: ${userError?.message}`);
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid token or user not found" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    userId = user.id;
    userEmail = user.email;

    // Fetch profile to see if they already have a stripe_customer_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    const existingCustomerId = profile?.stripe_customer_id;
    console.log(`[create-checkout-session] Authenticated user: ${userId}, Existing Stripe ID: ${existingCustomerId || 'none'}`);

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      console.error("[create-checkout-session] CRITICAL: STRIPE_SECRET_KEY is not set in Supabase secrets.");
      return new Response(
        JSON.stringify({ error: "Server configuration error: Stripe key missing." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isTestMode = stripeSecretKey.startsWith("sk_test_");
    console.log(`[create-checkout-session] Stripe Mode: ${isTestMode ? "TEST" : "LIVE"}`);

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Get origin for success/cancel URLs. Always return to the SPA root so React can catch the payment params.
    const origin = req.headers.get("origin") || Deno.env.get("APP_URL") || "http://localhost:3000";
    const normalizedOrigin = origin.replace(/\/$/, "");
    console.log(`[create-checkout-session] Creating session for user: ${userId}, price: ${priceId}, origin: ${normalizedOrigin}`);

    try {
      const sessionOptions: any = {
        payment_method_types: ["card"],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: "subscription",
        subscription_data: {
          metadata: {
            userId,
            user_id: userId,
          },
        },
        success_url: `${normalizedOrigin}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${normalizedOrigin}/?canceled=true&showPricing=true`,
        client_reference_id: userId,
        metadata: {
          userId,
          user_id: userId,
        },
      };

      if (existingCustomerId) {
        sessionOptions.customer = existingCustomerId;
      } else if (userEmail) {
        sessionOptions.customer_email = userEmail;
      }

      const session = await stripe.checkout.sessions.create(sessionOptions);

      console.log(`[create-checkout-session] Session created successfully: ${session.id}, URL: ${session.url}`);
      return new Response(
        JSON.stringify({ url: session.url }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (stripeError: any) {
      console.error(`[create-checkout-session] Stripe API Error: ${stripeError.message}`);
      return new Response(
        JSON.stringify({ error: `Stripe Error: ${stripeError.message}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error: any) {
    console.error(`[create-checkout-session] Unexpected Error: ${error.message}`);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please check server logs." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
