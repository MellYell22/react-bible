import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!signature || !webhookSecret) {
    return new Response(JSON.stringify({ error: "Missing signature or webhook secret" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const stripe = new Stripe(stripeSecretKey!, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event;
  try {
    const body = await req.text();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return new Response(JSON.stringify({ error: `Webhook Error: ${err.message}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log(`Received event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id || session.metadata?.userId;
        
        // Get the price ID from the session
        // Note: For subscriptions, you might want to look at line_items or subscription object
        // But we passed it in metadata or it's in the first line item
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        const priceId = lineItems.data[0]?.price?.id;

        console.log(`Checkout completed for user ${userId} with price ${priceId}`);

        if (userId) {
          let tier = "free";
          const plusPriceId = Deno.env.get("STRIPE_PRICE_ID_PLUS");
          const proPriceId = Deno.env.get("STRIPE_PRICE_ID_PRO");

          if (priceId === plusPriceId) tier = "plus";
          else if (priceId === proPriceId) tier = "pro";

          const { error } = await supabase
            .from("profiles")
            .update({
              subscription_tier: tier,
              stripe_customer_id: session.customer as string,
              updated_at: new Date().toISOString(),
            })
            .eq("id", userId);

          if (error) throw error;
          console.log(`Successfully updated user ${userId} to ${tier}`);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const { data: profile, error: fetchError } = await supabase
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (fetchError) {
          console.error(`Error fetching profile for customer ${customerId}: ${fetchError.message}`);
        } else if (profile) {
          const { error: updateError } = await supabase
            .from("profiles")
            .update({
              subscription_tier: "free",
              updated_at: new Date().toISOString(),
            })
            .eq("id", profile.id);

          if (updateError) throw updateError;
          console.log(`Reset user ${profile.id} to free tier`);
        }
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`Error processing webhook: ${err.message}`);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
