import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, stripe-signature",
};

const PAID_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

const getConfiguredProPriceId = () =>
  Deno.env.get("STRIPE_PRICE_ID_PRO") || Deno.env.get("VITE_STRIPE_PRICE_ID_PRO") || "";

const getStringId = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "id" in value && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
};

const assertConfiguredProPrice = (context: string) => {
  const proPriceId = getConfiguredProPriceId();
  if (!proPriceId) {
    throw new Error(`[Stripe Webhook] STRIPE_PRICE_ID_PRO is required before granting Pro access (${context})`);
  }
  return proPriceId;
};

const isProEntitlement = (
  input: { priceId: string | null; status: string | null },
  context: string,
) => {
  const proPriceId = assertConfiguredProPrice(context);
  return input.priceId === proPriceId && !!input.status && PAID_SUBSCRIPTION_STATUSES.has(input.status);
};

const getSubscriptionDetails = async (stripe: any, subscriptionId: string | null) => {
  if (!subscriptionId) {
    return {
      subscriptionId: null,
      status: null,
      priceId: null,
      currentPeriodEnd: null,
      userId: null,
    };
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return {
    subscriptionId,
    status: subscription.status,
    priceId: subscription.items.data[0]?.price?.id || null,
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    userId: subscription.metadata?.userId || subscription.metadata?.user_id || null,
  };
};

const findProfile = async (
  supabase: any,
  customerId: string | null,
  email: string | null,
  userIdFromMetadata?: string | null,
) => {
  console.log(`[Stripe Webhook] Searching for profile: customerId=${customerId}, email=${email}, userIdFromMetadata=${userIdFromMetadata}`);

  if (userIdFromMetadata) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, subscription_tier")
      .eq("id", userIdFromMetadata)
      .maybeSingle();
    if (data) return data;
    if (error) console.error(`[Stripe Webhook] error looking up by ID: ${error.message}`);
  }

  if (customerId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, subscription_tier")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (data) return data;
    if (error) console.error(`[Stripe Webhook] error looking up by customer ID: ${error.message}`);
  }

  if (email) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, subscription_tier")
      .eq("email", email)
      .maybeSingle();
    if (data) return data;
    if (error) console.error(`[Stripe Webhook] error looking up by email: ${error.message}`);
  }

  return null;
};

const updateProfileOrThrow = async (
  supabase: any,
  profileId: string,
  updateData: Record<string, unknown>,
  context: string,
) => {
  const { data, error } = await supabase
    .from("profiles")
    .update(updateData)
    .eq("id", profileId)
    .select("id, subscription_tier");

  if (error) {
    throw new Error(`${context} failed for user ${profileId}: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error(`${context} affected 0 rows for user ${profileId}`);
  }

  return data[0];
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
        let userId = session.client_reference_id || session.metadata?.userId || session.metadata?.user_id;
        const customerId = session.customer as string;
        const subscriptionId = getStringId(session.subscription);
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

        const subscriptionDetails = await getSubscriptionDetails(stripe, subscriptionId);
        const lineItems = subscriptionDetails.priceId
          ? null
          : await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
        const priceId = subscriptionDetails.priceId || lineItems?.data[0]?.price?.id || null;
        const status = subscriptionDetails.status || (session.payment_status === "paid" ? "active" : null);
        const isPro = isProEntitlement({ priceId, status }, `checkout.session.completed ${session.id}`);

        if (!isPro) {
          throw new Error(`[Stripe Webhook] Refusing Pro grant for checkout session ${session.id}: status=${status || "none"}, price=${priceId || "none"}`);
        }

        console.log(`[Stripe Webhook] Performing update for user ${userId} to tier: pro`);

        const updateData = {
          subscription_tier: "pro",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionDetails.subscriptionId,
          subscription_status: "active",
          plan: "pro",
          stripe_subscription_status: status,
          stripe_price_id: priceId,
          ...(subscriptionDetails.currentPeriodEnd ? { stripe_current_period_end: subscriptionDetails.currentPeriodEnd } : {}),
          updated_at: new Date().toISOString(),
        };
        
        console.log(`[Stripe Webhook] Update payload: ${JSON.stringify(updateData)}`);

        const data = await updateProfileOrThrow(supabase, userId, updateData, "checkout.session.completed profile update");
        console.log(`[Stripe Webhook] Successfully updated profile for ${userId}. New tier in DB: ${data.subscription_tier}`);
        break;
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const subscriptionDetails = await getSubscriptionDetails(stripe, getStringId(invoice.subscription));
        const subscriptionId = subscriptionDetails.subscriptionId;

        console.log(`[Stripe Webhook] ${event.type} for invoice: ${invoice.id}, Customer: ${customerId}`);

        if (!subscriptionId) {
          console.log(`[Stripe Webhook] Invoice ${invoice.id} has no subscription; no Pro entitlement to sync.`);
          break;
        }

        const profile = await findProfile(supabase, customerId, invoice.customer_email, subscriptionDetails.userId);
        if (!profile) {
          throw new Error(`[Stripe Webhook] Could not resolve profile for invoice ${invoice.id}`);
        }

        const isPro = isProEntitlement(
          { priceId: subscriptionDetails.priceId, status: subscriptionDetails.status },
          `${event.type} ${invoice.id}`,
        );
        const tier = isPro ? "pro" : "free";

        console.log(`[Stripe Webhook] Updating customer ${customerId} to tier: ${tier}`);

        const data = await updateProfileOrThrow(supabase, profile.id, {
          subscription_tier: tier,
          subscription_status: isPro ? "active" : "inactive",
          plan: tier,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          stripe_subscription_status: subscriptionDetails.status,
          stripe_price_id: subscriptionDetails.priceId,
          ...(subscriptionDetails.currentPeriodEnd ? { stripe_current_period_end: subscriptionDetails.currentPeriodEnd } : {}),
          updated_at: new Date().toISOString(),
        }, `${event.type} profile update`);

        console.log(`[Stripe Webhook] Profile update result: SUCCESS for customer ${customerId}. New tier: ${data.subscription_tier}`);
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const priceId = subscription.items.data[0]?.price?.id;
        const status = subscription.status;
        const currentPeriodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null;

        const isPro = isProEntitlement({ priceId, status }, `${event.type} ${subscription.id}`);
        const tier = isPro ? "pro" : "free";

        console.log(`[Stripe Webhook] Subscription changed for customer ${customerId}. New tier: ${tier}, Status: ${status}`);

        const profile = await findProfile(
          supabase,
          customerId,
          null,
          subscription.metadata?.userId || subscription.metadata?.user_id,
        );
        if (!profile) {
          throw new Error(`[Stripe Webhook] Could not resolve profile for subscription ${subscription.id}`);
        }

        const data = await updateProfileOrThrow(supabase, profile.id, {
          subscription_tier: tier,
          subscription_status: isPro ? "active" : "inactive",
          plan: tier,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
          stripe_subscription_status: status,
          stripe_price_id: priceId,
          ...(currentPeriodEnd ? { stripe_current_period_end: currentPeriodEnd } : {}),
          updated_at: new Date().toISOString(),
        }, `${event.type} profile update`);

        console.log(`[Stripe Webhook] Profile update result: SUCCESS for customer ${customerId} (Subscription ${event.type}). New tier: ${data.subscription_tier}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        console.log(`[Stripe Webhook] Subscription deleted for customer ${customerId}`);

        const profile = await findProfile(
          supabase,
          customerId,
          null,
          subscription.metadata?.userId || subscription.metadata?.user_id,
        );
        if (!profile) {
          throw new Error(`[Stripe Webhook] Could not resolve profile for deleted subscription ${subscription.id}`);
        }

        await updateProfileOrThrow(supabase, profile.id, {
          subscription_tier: "free",
          subscription_status: "canceled",
          plan: "free",
          stripe_subscription_status: "canceled",
          updated_at: new Date().toISOString(),
        }, "customer.subscription.deleted profile update");
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
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
