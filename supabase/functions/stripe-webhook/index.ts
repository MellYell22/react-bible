import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, stripe-signature",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Stripe webhooks are always POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { 
      status: 405, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

  // Validate environment and signature
  if (!signature) {
    console.error("[Stripe Webhook] Error: Missing stripe-signature header");
    return new Response(JSON.stringify({ error: "Missing signature" }), { 
      status: 400, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  if (!webhookSecret) {
    console.error("[Stripe Webhook] Error: STRIPE_WEBHOOK_SECRET not set");
    return new Response(JSON.stringify({ error: "Server config error" }), { status: 500, headers: corsHeaders });
  }

  if (!stripeSecretKey) {
    console.error("[Stripe Webhook] Error: STRIPE_SECRET_KEY not set");
    return new Response(JSON.stringify({ error: "Server config error" }), { status: 500, headers: corsHeaders });
  }

  const isTestMode = stripeSecretKey.startsWith("sk_test_");
  console.log(`[Stripe Webhook] Stripe Mode: ${isTestMode ? "TEST" : "LIVE"}`);

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event;
  try {
    const body = await req.text();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error(`[Stripe Webhook] Signature verification failed: ${err.message}`);
    return new Response(JSON.stringify({ error: `Webhook Error: ${err.message}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log(`[Stripe Webhook] Handling event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        let userId = session.client_reference_id || session.metadata?.userId;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const customerEmail = session.customer_details?.email;

        console.log(`[Stripe Webhook] Session completed. userId: ${userId}, email: ${customerEmail}, customerId: ${customerId}`);

        if (!userId && customerEmail) {
          console.log(`[Stripe Webhook] userId missing, attempting lookup by email: ${customerEmail}`);
          const { data: profileData, error: profileError } = await supabase
            .from("profiles")
            .select("id")
            .eq("email", customerEmail)
            .maybeSingle();
          
          if (profileData) {
            userId = profileData.id;
            console.log(`[Stripe Webhook] Found userId ${userId} for email ${customerEmail}`);
          } else if (profileError) {
            console.error(`[Stripe Webhook] Error looking up user by email: ${profileError.message}`);
          }
        }

        if (!userId) {
          console.error("[Stripe Webhook] CRITICAL: No userId found in session and email lookup failed. Cannot update profile.");
          return new Response(JSON.stringify({ error: "Missing userId in session" }), { 
            status: 400, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        const priceId = lineItems.data[0]?.price?.id;
        
        let tier = "free";
        const proPriceId = Deno.env.get("STRIPE_PRICE_ID_PRO");

        console.log(`[Stripe Webhook] Price ID from session: ${priceId}, Expected Pro ID: ${proPriceId}`);

        if (priceId === proPriceId) {
          tier = "pro";
          console.log("[Stripe Webhook] Tier determined: pro (Matched Price ID)");
        } else if (!proPriceId && priceId) {
          console.warn("[Stripe Webhook] WARNING: STRIPE_PRICE_ID_PRO is not set in environment. Defaulting to 'pro' because priceId is present.");
          tier = "pro";
        } else {
          console.log(`[Stripe Webhook] Tier determined: ${tier} (No match)`);
        }

        // Get subscription details if available
        let subscriptionDetails = {};
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          subscriptionDetails = {
            stripe_subscription_id: subscriptionId,
            stripe_subscription_status: sub.status,
            stripe_price_id: priceId,
            stripe_current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          };
        }

        console.log(`[Stripe Webhook] Performing update for user ${userId} to tier: ${tier}`);

        const updateData = {
          subscription_tier: tier,
          stripe_customer_id: customerId,
          ...subscriptionDetails,
          updated_at: new Date().toISOString(),
        };
        
        console.log(`[Stripe Webhook] Update payload: ${JSON.stringify(updateData)}`);

        const { data, error } = await supabase
          .from("profiles")
          .update(updateData)
          .eq("id", userId)
          .select();

        if (error) {
          console.error(`[Stripe Webhook] Error updating profile for ${userId}:`, error);
          throw error;
        }
        
        if (!data || data.length === 0) {
          console.warn(`[Stripe Webhook] WARNING: Profile update for ${userId} affected 0 rows. User might not exist in Supabase yet.`);
        } else {
          console.log(`[Stripe Webhook] Successfully updated profile for ${userId}. New tier in DB: ${data[0].subscription_tier}`);
        }
        break;
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const subscriptionId = invoice.subscription as string;

        console.log(`[Stripe Webhook] ${event.type} for invoice: ${invoice.id}, Customer: ${customerId}`);

        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = subscription.items.data[0]?.price?.id;
          
          let tier = "free";
          const proPriceId = Deno.env.get("STRIPE_PRICE_ID_PRO");

          if (priceId === proPriceId) tier = "pro";

          console.log(`[Stripe Webhook] Updating customer ${customerId} to tier: ${tier}`);

          const { data, error } = await supabase
            .from("profiles")
            .update({
              subscription_tier: tier,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              stripe_subscription_status: subscription.status,
              stripe_price_id: priceId,
              stripe_current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_customer_id", customerId)
            .select();

          if (error) {
            console.error(`[Stripe Webhook] Error updating profile for customer ${customerId}:`, error);
            throw error;
          }
          
          if (!data || data.length === 0) {
            console.warn(`[Stripe Webhook] WARNING: Profile update for customer ${customerId} affected 0 rows. customerId not found.`);
          } else {
            console.log(`[Stripe Webhook] Profile update result: SUCCESS for customer ${customerId}. New tier: ${data[0].subscription_tier}`);
          }
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const priceId = subscription.items.data[0]?.price?.id;

        let tier = "free";
        const proPriceId = Deno.env.get("STRIPE_PRICE_ID_PRO");

        if (priceId === proPriceId) tier = "pro";

        console.log(`[Stripe Webhook] Subscription changed for customer ${customerId}. New tier: ${tier}, Status: ${subscription.status}`);

        const { data, error } = await supabase
          .from("profiles")
          .update({
            subscription_tier: tier,
            stripe_subscription_id: subscription.id,
            stripe_subscription_status: subscription.status,
            stripe_price_id: priceId,
            stripe_current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId)
          .select();

        if (error) {
          console.error(`[Stripe Webhook] Error updating subscription for customer ${customerId}:`, error);
          throw error;
        }

        if (!data || data.length === 0) {
          console.warn(`[Stripe Webhook] WARNING: Subscription update for customer ${customerId} affected 0 rows.`);
        } else {
          console.log(`[Stripe Webhook] Profile update result: SUCCESS for customer ${customerId} (Subscription ${event.type}). New tier: ${data[0].subscription_tier}`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        console.log(`[Stripe Webhook] Subscription deleted for customer ${customerId}`);

        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_tier: "free",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId);

        if (error) throw error;
        break;
      }
    }

    // Always return 200 for successful receipt
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error(`[Stripe Webhook] Error processing event: ${err.message}`);
    // We return 200 here to acknowledge receipt, but log the error for debugging.
    // Stripe will see this as successful and won't disable the webhook endpoint.
    return new Response(JSON.stringify({ received: true, error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
