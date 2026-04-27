import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

  // Validate environment and signature
  if (!signature) {
    console.error("[Stripe Webhook] Error: Missing stripe-signature header");
    return new Response(JSON.stringify({ error: "Missing signature" }), { status: 400, headers: corsHeaders });
  }

  if (!webhookSecret) {
    console.error("[Stripe Webhook] Error: STRIPE_WEBHOOK_SECRET not set");
    return new Response(JSON.stringify({ error: "Server config error" }), { status: 500, headers: corsHeaders });
  }

  if (!stripeSecretKey) {
    console.error("[Stripe Webhook] Error: STRIPE_SECRET_KEY not set");
    return new Response(JSON.stringify({ error: "Server config error" }), { status: 500, headers: corsHeaders });
  }

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
        const userId = session.client_reference_id || session.metadata?.userId;
        const customerId = session.customer as string;

        if (userId) {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
          const priceId = lineItems.data[0]?.price?.id;
          
          let tier = "free";
          const plusPriceId = Deno.env.get("STRIPE_PRICE_ID_PLUS");
          const proPriceId = Deno.env.get("STRIPE_PRICE_ID_PRO");

          if (priceId === plusPriceId) tier = "plus";
          else if (priceId === proPriceId) tier = "pro";

          console.log(`[Stripe Webhook] Session completed for ${userId}. Tier: ${tier}`);

          const { error } = await supabase
            .from("profiles")
            .update({
              subscription_tier: tier,
              stripe_customer_id: customerId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", userId);

          if (error) throw error;
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const subscriptionId = invoice.subscription as string;

        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = subscription.items.data[0]?.price?.id;
          
          let tier = "free";
          const plusPriceId = Deno.env.get("STRIPE_PRICE_ID_PLUS");
          const proPriceId = Deno.env.get("STRIPE_PRICE_ID_PRO");

          if (priceId === plusPriceId) tier = "plus";
          else if (priceId === proPriceId) tier = "pro";

          console.log(`[Stripe Webhook] Payment succeeded for customer ${customerId}. Updating to ${tier}`);

          const { error } = await supabase
            .from("profiles")
            .update({
              subscription_tier: tier,
              stripe_customer_id: customerId,
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_customer_id", customerId);

          if (error) throw error;
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const priceId = subscription.items.data[0]?.price?.id;

        let tier = "free";
        const plusPriceId = Deno.env.get("STRIPE_PRICE_ID_PLUS");
        const proPriceId = Deno.env.get("STRIPE_PRICE_ID_PRO");

        if (priceId === plusPriceId) tier = "plus";
        else if (priceId === proPriceId) tier = "pro";

        console.log(`[Stripe Webhook] Subscription changed for customer ${customerId}. New tier: ${tier}`);

        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_tier: tier,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId);

        if (error) throw error;
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
