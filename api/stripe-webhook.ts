import Stripe from "stripe";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const DEFAULT_PRO_PRICE_ID = "price_1TRTQuGDw0P2L0A1MsgZiMeM";
const hasPaidProStatus = (status: string | null | undefined) => status === "active" || status === "trialing";

const getRawBody = (req: any) => new Promise<Buffer>((resolve, reject) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});

const getStripe = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured.");
  return new Stripe(secretKey, { apiVersion: "2023-10-16" as any });
};

const getSupabase = () => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase webhook credentials are not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
};

const getId = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id || null;

const findProfileId = async (
  supabase: SupabaseClient,
  { userId, customerId, email }: { userId?: string | null; customerId?: string | null; email?: string | null },
) => {
  if (userId) {
    const { data, error } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (error) throw error;
    if (data) return data.id;
  }

  if (customerId) {
    const { data, error } = await supabase.from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
    if (error) throw error;
    if (data) return data.id;
  }

  if (email) {
    const { data, error } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
    if (error) throw error;
    if (data) return data.id;
  }

  return null;
};

const saveSubscription = async (
  supabase: SupabaseClient,
  profileId: string,
  customerId: string | null,
  subscription: Stripe.Subscription,
) => {
  const priceId = subscription.items.data[0]?.price?.id;
  const proPriceId = process.env.STRIPE_PRICE_ID_PRO || DEFAULT_PRO_PRICE_ID;
  const isPro = priceId === proPriceId && hasPaidProStatus(subscription.status);

  const { error } = await supabase
    .from("profiles")
    .update({
      subscription_tier: isPro ? "pro" : "free",
      subscription_status: isPro ? "active" : "inactive",
      plan: isPro ? "pro" : "free",
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      stripe_subscription_status: subscription.status,
      stripe_price_id: priceId,
      stripe_current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", profileId);

  if (error) throw error;
  console.log(`[Stripe Webhook] Profile ${profileId} synchronized to ${isPro ? "Pro" : "Free"}.`);
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");

    const stripe = getStripe();
    const signature = req.headers["stripe-signature"];
    if (!signature) return res.status(400).json({ error: "Missing Stripe signature" });

    const event = stripe.webhooks.constructEvent(await getRawBody(req), signature, webhookSecret);
    const supabase = getSupabase();

    console.log(`[Stripe Webhook] Received ${event.type}.`);

    switch (event.type) {
      case "checkout.session.completed": {
        const checkout = event.data.object as Stripe.Checkout.Session;
        if (checkout.mode !== "subscription" || checkout.payment_status !== "paid" || !checkout.subscription) break;

        const userId = checkout.client_reference_id || checkout.metadata?.userId || checkout.metadata?.user_id;
        const customerId = getId(checkout.customer);
        const profileId = await findProfileId(supabase, {
          userId,
          customerId,
          email: checkout.customer_details?.email || checkout.customer_email,
        });
        if (!profileId) throw new Error(`No profile found for completed checkout ${checkout.id}.`);

        const subscription = await stripe.subscriptions.retrieve(getId(checkout.subscription)!);
        await saveSubscription(supabase, profileId, customerId, subscription);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = getId(subscription.customer);
        const profileId = await findProfileId(supabase, {
          userId: subscription.metadata?.userId || subscription.metadata?.user_id,
          customerId,
        });
        if (!profileId) throw new Error(`No profile found for subscription ${subscription.id}.`);

        await saveSubscription(supabase, profileId, customerId, subscription);
        break;
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = getId(invoice.customer);
        const subscriptionId = getId(invoice.subscription);
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const profileId = await findProfileId(supabase, {
          userId: subscription.metadata?.userId || subscription.metadata?.user_id,
          customerId,
          email: invoice.customer_email,
        });
        if (!profileId) throw new Error(`No profile found for paid invoice ${invoice.id}.`);

        await saveSubscription(supabase, profileId, customerId, subscription);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = getId(subscription.customer);
        const profileId = await findProfileId(supabase, { customerId });
        if (!profileId) throw new Error(`No profile found for canceled subscription ${subscription.id}.`);

        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_tier: "free",
            subscription_status: "canceled",
            plan: "free",
            stripe_subscription_status: "canceled",
            updated_at: new Date().toISOString(),
          })
          .eq("id", profileId);
        if (error) throw error;
        break;
      }

      case "invoice.payment_failed":
        console.warn("[Stripe Webhook] Invoice payment failed; retaining access until Stripe marks the subscription inactive or canceled.");
        break;

      default:
        console.log(`[Stripe Webhook] Ignoring ${event.type}.`);
    }

    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error("[Stripe Webhook] Processing failed:", error?.message || error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}
