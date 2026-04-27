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
    const { priceId, userId: bodyUserId } = await req.json();

    if (!priceId) {
      return new Response(
        JSON.stringify({ error: "Missing priceId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user ID from JWT if not in body
    let userId = bodyUserId;
    if (!userId) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
          console.error(`[create-checkout-session] Auth error: ${userError?.message}`);
        } else {
          userId = user.id;
        }
      }
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Missing userId" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      console.error("[create-checkout-session] CRITICAL: STRIPE_SECRET_KEY is not set in Supabase secrets.");
      return new Response(
        JSON.stringify({ error: "Server configuration error: Stripe key missing." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Get origin for success/cancel URLs
    const origin = req.headers.get("origin") || Deno.env.get("APP_URL") || "http://localhost:3000";
    console.log(`[create-checkout-session] Creating session for user: ${userId}, price: ${priceId}, origin: ${origin}`);

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: "subscription",
        success_url: `${origin}/success`,
        cancel_url: `${origin}/cancel`,
        client_reference_id: userId,
        metadata: {
          userId,
        },
      });

      console.log(`[create-checkout-session] Session created successfully: ${session.id}`);
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
