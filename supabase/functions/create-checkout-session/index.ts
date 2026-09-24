import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OWNER_EMAIL = "alissasmith.apps@gmail.com";
const PAID_STATUSES = new Set(["active", "trialing"]);

const PRICE_ENV_BY_PLAN = { plus: "STRIPE_PRICE_ID_PLUS", pro: "STRIPE_PRICE_ID_PRO" } as const;
type CheckoutPlan = keyof typeof PRICE_ENV_BY_PLAN;
const EXPECTED_MONTHLY_CENTS: Record<CheckoutPlan, number> = { plus: 999, pro: 1299 };

const getPlanLabel = (plan: CheckoutPlan) => (plan === "plus" ? "Bible Plus" : "Bible Pro");

const parsePlan = (value: unknown): CheckoutPlan => {
  if (value === "plus" || value === "pro") return value;
  throw new Error(`INVALID_PLAN:${String(value)}`);
};

const resolvePriceIdForPlan = (plan: CheckoutPlan): string | null => {
  const raw = Deno.env.get(PRICE_ENV_BY_PLAN[plan])?.trim();
  return raw && raw.startsWith("price_") ? raw : null;
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const appOrigin = getSafeAppOrigin(req);

    if (!authHeader || !supabaseUrl || !stripeSecretKey || !appOrigin) {
      console.error("[create-checkout-session] Missing required server configuration.");
      return json({ error: "Checkout is temporarily unavailable because billing is not fully configured." }, 500);
    }

    let requestedPlan: CheckoutPlan;
    try {
      const body = await req.json().catch(() => ({}));
      requestedPlan = parsePlan(body?.plan ?? "pro");
    } catch {
      return json({ error: "Invalid subscription plan requested." }, 400);
    }

    const selectedPriceId = resolvePriceIdForPlan(requestedPlan);
    if (!selectedPriceId) {
      console.error(`[create-checkout-session] ${PRICE_ENV_BY_PLAN[requestedPlan]} is not configured with a valid price id.`);
      return json({ error: `Checkout is temporarily unavailable because ${getPlanLabel(requestedPlan)} billing is not configured.` }, 500);
    }

    const authClient = createClient(supabaseUrl, resolveAuthApiKey(), {
      global: { headers: { Authorization: authHeader } },
    });
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken);

    if (userError || !user) {
      return json({ error: "Your sign-in session expired. Please sign in again before upgrading." }, 401);
    }

    const { data: profile, error: profileError } = await authClient
      .from("profiles")
      .select("id, email, subscription_tier, stripe_customer_id, stripe_subscription_id, stripe_subscription_status")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) return json({ error: "Your account profile is still being created. Please try again in a moment." }, 409);

    const isOwner = user.email?.toLowerCase() === OWNER_EMAIL || profile.subscription_tier === "owner";
    const alreadyOnThisPlan = profile.subscription_tier === requestedPlan
      && PAID_STATUSES.has(profile.stripe_subscription_status);
    if (isOwner) {
      return json({ error: "This account already has full access." }, 409);
    }
    if (alreadyOnThisPlan) {
      return json({ error: `This account is already subscribed to ${getPlanLabel(requestedPlan)}.` }, 409);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const price = await stripe.prices.retrieve(selectedPriceId);
    const keyIsLive = stripeSecretKey.startsWith("sk_live_");
    if (!price.active || price.type !== "recurring" || price.recurring?.interval !== "month" || price.livemode !== keyIsLive) {
      console.error(`[create-checkout-session] ${getPlanLabel(requestedPlan)} price is inactive, non-recurring/non-monthly, or in the wrong Stripe mode.`);
      return json({ error: `The ${getPlanLabel(requestedPlan)} plan is not available right now. Please contact support.` }, 500);
    }

    // Must match the prices shown in the app (src/constants.ts PLANS). Logged,
    // not blocked, so a drift is visible in logs without stopping sales.
    const expectedCents = EXPECTED_MONTHLY_CENTS[requestedPlan];
    if (price.unit_amount !== expectedCents || price.currency !== "usd") {
      console.error(`[create-checkout-session] PRICE MISMATCH: ${getPlanLabel(requestedPlan)} is ${price.unit_amount} ${price.currency} in Stripe but the app shows ${expectedCents} usd.`);
    }

    let existingCustomerId: string | null = profile.stripe_customer_id || null;
    if (existingCustomerId) {
      try {
        const customer = await stripe.customers.retrieve(existingCustomerId);
        if (("deleted" in customer && customer.deleted) || customer.livemode !== keyIsLive) {
          existingCustomerId = null;
        }
      } catch (error: any) {
        console.warn(`[create-checkout-session] Ignoring stale Stripe customer ${existingCustomerId}: ${error?.message || error}`);
        existingCustomerId = null;
      }
    }

    const metadata = { userId: user.id, user_id: user.id, app: "bible-mood-search", plan: requestedPlan };
    const sessionOptions: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: selectedPriceId, quantity: 1 }],
      client_reference_id: user.id,
      metadata,
      // No free trial — subscriptions bill immediately.
      subscription_data: { metadata },
      success_url: `${appOrigin}/?success=true&plan=${requestedPlan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appOrigin}/?canceled=true&showPricing=true&plan=${requestedPlan}`,
    };

    if (existingCustomerId) sessionOptions.customer = existingCustomerId;
    else if (user.email) sessionOptions.customer_email = user.email;

    const checkout = await stripe.checkout.sessions.create(sessionOptions);
    if (!checkout.url) throw new Error(`Stripe returned checkout ${checkout.id} without a URL.`);

    console.log(`[create-checkout-session] Created ${checkout.id} (${requestedPlan}) for user ${user.id}.`);
    return json({ url: checkout.url });
  } catch (error: any) {
    console.error("[create-checkout-session] Failed:", error?.message || error);
    return json({ error: "Unable to start checkout right now. Please try again shortly." }, 500);
  }
});
