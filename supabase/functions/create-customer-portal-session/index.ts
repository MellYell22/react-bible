import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FALLBACK_PUBLISHABLE_KEY = "sb_publishable_XpVDXroi6heBFrljTrWGrA__tFu6PTp";

const json = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
);

const resolveAuthApiKey = (): string => {
  for (const candidate of [
    Deno.env.get("SB_PUBLISHABLE_KEY"),
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
  ]) {
    if (candidate?.startsWith("sb_publishable_")) return candidate;
  }
  return FALLBACK_PUBLISHABLE_KEY;
};

const getSafeAppOrigin = (req: Request): string | null => {
  const configured = Deno.env.get("APP_URL")?.trim().replace(/\/$/, "");
  if (configured?.startsWith("https://")) return configured;

  const requestOrigin = req.headers.get("origin")?.replace(/\/$/, "");
  if (requestOrigin?.startsWith("http://localhost:") || requestOrigin?.startsWith("http://127.0.0.1:")) {
    return requestOrigin;
  }

  return null;
};

/**
 * Opens the Stripe Customer Portal for the signed-in user so they can manage
 * their existing subscription (update card, view invoices, cancel). This function
 * also reads subscription status and schedules authenticated, confirmed
 * cancellations for the end of the paid period.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const appOrigin = getSafeAppOrigin(req);

    if (!authHeader) return json({ error: "Please sign in to manage your subscription." }, 401);
    if (!supabaseUrl || !stripeSecretKey) {
      console.error("[create-customer-portal-session] Missing required server configuration.");
      return json({ error: "Subscription management is temporarily unavailable because billing is not fully configured." }, 500);
    }

    const authClient = createClient(supabaseUrl, resolveAuthApiKey(), {
      global: { headers: { Authorization: authHeader } },
    });
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken);

    if (userError || !user) {
      return json({ error: "Your sign-in session expired. Please sign in again to manage your subscription." }, 401);
    }

    const { data: profile, error: profileError } = await authClient
      .from("profiles")
      .select("id, email, stripe_customer_id, stripe_subscription_id, subscription_tier")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) return json({ error: "Your account profile is still being created. Please try again in a moment." }, 409);

    const customerId: string | null = profile.stripe_customer_id || null;
    if (!customerId) {
      return json({ error: "No active subscription was found for this account." }, 409);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const keyIsLive = stripeSecretKey.startsWith("sk_live_");
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (("deleted" in customer && customer.deleted) || customer.livemode !== keyIsLive) {
        return json({ error: "No active subscription was found for this account." }, 409);
      }
    } catch (error: any) {
      console.warn(`[create-customer-portal-session] Could not verify Stripe customer ${customerId}: ${error?.message || error}`);
      return json({ error: "No active subscription was found for this account." }, 409);
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'portal';
    if (!['portal', 'status', 'cancel'].includes(action)) return json({ error: 'Invalid billing action.' }, 400);
    if (action !== 'portal') {
      const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
      const subscription = subscriptions.data.find((item) => item.id === profile.stripe_subscription_id)
        || subscriptions.data.find((item) => ['active', 'trialing', 'past_due'].includes(item.status));
      if (!subscription) return json({ error: 'No Stripe subscription is linked to this account. Please contact support.' }, 409);
      let current = subscription;
      if (action === 'cancel') {
        if (body.confirm !== true) return json({ error: 'Please confirm cancellation first.' }, 400);
        if (!['active', 'trialing', 'past_due'].includes(current.status)) return json({ error: 'This subscription is already ended.' }, 409);
        if (!current.cancel_at_period_end) {
          current = await stripe.subscriptions.update(current.id, { cancel_at_period_end: true });
        }
      }
      return json({
        status: current.status,
        cancelAtPeriodEnd: current.cancel_at_period_end,
        currentPeriodEnd: current.current_period_end,
        plan: profile.subscription_tier,
      });
    }

    if (!appOrigin) return json({ error: "Subscription portal return URL is not configured." }, 503);
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appOrigin}/`,
    });

    if (!portalSession.url) throw new Error(`Stripe returned portal session ${portalSession.id} without a URL.`);

    console.log(`[create-customer-portal-session] Created portal session for user ${user.id}.`);
    return json({ url: portalSession.url });
  } catch (error: any) {
    console.error("[create-customer-portal-session] Failed:", error?.message || error);
    return json({ error: "Unable to open the subscription portal right now. Please try again shortly." }, 500);
  }
});
