import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-01-27.acacia' as any,
});

// Initialize Supabase - using Service Role Key for admin access
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(readable: any) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

const getRequiredProPriceId = () => {
  const proPriceId = process.env.STRIPE_PRICE_ID_PRO || process.env.VITE_STRIPE_PRICE_ID_PRO;
  if (!proPriceId) {
    throw new Error('STRIPE_PRICE_ID_PRO is not configured');
  }
  return proPriceId;
};

const isPaidSubscriptionStatus = (status?: string | null) =>
  status === 'active' || status === 'trialing';

const getSubscriptionPriceId = (subscription: Stripe.Subscription) =>
  subscription.items.data[0]?.price?.id || null;

const getCurrentPeriodEnd = (subscription: Stripe.Subscription) => {
  const periodEnd = (subscription as any).current_period_end;
  return typeof periodEnd === 'number' ? new Date(periodEnd * 1000).toISOString() : null;
};

const assertPaidProPrice = (priceId: string | null, context: string) => {
  const proPriceId = getRequiredProPriceId();
  if (priceId !== proPriceId) {
    throw new Error(`${context} used unexpected paid price ${priceId || 'none'}`);
  }
};

const updateProfileOrThrow = async (
  profileId: string,
  update: Record<string, unknown>,
  context: string,
) => {
  const { data, error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', profileId)
    .select('id, subscription_tier');

  if (error) {
    throw new Error(`${context} failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error(`${context} affected 0 profile rows`);
  }

  return data[0];
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error("[Stripe Webhook] Error: Missing signature or webhook secret");
    return res.status(400).send('Webhook Error: Missing signature or webhook secret');
  }

  if (!process.env.STRIPE_SECRET_KEY || !supabaseUrl || !supabaseServiceKey) {
    console.error("[Stripe Webhook] Error: Missing Stripe or Supabase server configuration");
    return res.status(500).send('Webhook Error: Missing server configuration');
  }

  let event: Stripe.Event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error(`[Stripe Webhook] Error: Verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[Stripe Webhook] Received event: ${event.type}`);

  // Helper to find profile by metadata ID, Stripe ID, or Email
  const findProfile = async (customerId: string | null, email: string | null, userIdFromMetadata?: string | null) => {
    console.log(`[Stripe Webhook] Searching for profile: customerId=${customerId}, email=${email}, userIdFromMetadata=${userIdFromMetadata}`);
    
    // 1. Priority 1: User ID from metadata/client_reference_id
    if (userIdFromMetadata) {
      console.log(`[Stripe Webhook] Attempt 1: Look up by ID ${userIdFromMetadata}`);
      const { data, error } = await supabase.from('profiles').select('id, email, subscription_tier').eq('id', userIdFromMetadata).maybeSingle();
      if (data) {
        console.log(`[Stripe Webhook] SUCCESS: Found user by ID: ${data.id}`);
        return data;
      }
      if (error) throw new Error(`Profile lookup by ID failed: ${error.message}`);
    }

    // 2. Priority 2: Stripe Customer ID
    if (customerId) {
      console.log(`[Stripe Webhook] Attempt 2: Look up by stripe_customer_id ${customerId}`);
      const { data, error } = await supabase.from('profiles').select('id, email, subscription_tier').eq('stripe_customer_id', customerId).maybeSingle();
      if (data) {
        console.log(`[Stripe Webhook] SUCCESS: Found user by customer ID: ${data.id}`);
        return data;
      }
      if (error) throw new Error(`Profile lookup by customer ID failed: ${error.message}`);
    }

    // 3. Priority 3: Email Fallback
    if (email) {
      console.log(`[Stripe Webhook] Attempt 3: Look up by email ${email}`);
      const { data, error } = await supabase.from('profiles').select('id, email, subscription_tier').eq('email', email).maybeSingle();
      if (data) {
        console.log(`[Stripe Webhook] SUCCESS: Found user by email: ${data.id}`);
        return data;
      }
      if (error) throw new Error(`Profile lookup by email failed: ${error.message}`);
    }

    console.log(`[Stripe Webhook] FAILED: Could not identify profile.`);
    return null;
  };

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;
        const customerEmail = session.customer_details?.email || session.customer_email || null;
        const userIdMetadata = session.client_reference_id || session.metadata?.userId || session.metadata?.user_id;
        
        console.log(`[Stripe Webhook] Processing session ${session.id} for user metadata: ${userIdMetadata}`);

        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
        const priceId = lineItems.data[0]?.price?.id || null;
        assertPaidProPrice(priceId, `Checkout session ${session.id}`);

        const subscription = session.subscription
          ? await stripe.subscriptions.retrieve(session.subscription as string)
          : null;
        if (subscription && !isPaidSubscriptionStatus(subscription.status)) {
          throw new Error(`Checkout subscription ${subscription.id} is not active/trialing: ${subscription.status}`);
        }

        const profile = await findProfile(customerId, customerEmail, userIdMetadata);
        
        if (profile) {
          console.log(`[Stripe Webhook] Upgrading user ${profile.id} to Pro...`);
          const updated = await updateProfileOrThrow(profile.id, {
            stripe_customer_id: customerId,
            subscription_tier: 'pro',
            stripe_subscription_id: subscription?.id || session.subscription || undefined,
            stripe_subscription_status: subscription?.status || 'active',
            stripe_price_id: priceId,
            stripe_current_period_end: subscription ? getCurrentPeriodEnd(subscription) : undefined,
            updated_at: new Date().toISOString()
          }, `Checkout profile update for user ${profile.id}`);
          console.log(`[Stripe Webhook] UPDATE SUCCESS: User ${updated.id} is now ${updated.subscription_tier}.`);
        } else {
          throw new Error(`Could not resolve profile for checkout session ${session.id}`);
        }
        break;
      }
      
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const customerEmail = invoice.customer_email;
        const subscriptionId = invoice.subscription as string;

        console.log(`[Stripe Webhook] Processing invoice ${invoice.id} for customer ${customerId}`);

        const subscription = subscriptionId
          ? await stripe.subscriptions.retrieve(subscriptionId)
          : null;
        const priceId = subscription ? getSubscriptionPriceId(subscription) : null;
        const isPaidPro = Boolean(subscription && isPaidSubscriptionStatus(subscription.status));
        if (isPaidPro) {
          assertPaidProPrice(priceId, `Invoice ${invoice.id}`);
        }
        const userIdMetadata = subscription?.metadata?.userId || subscription?.metadata?.user_id || null;

        const profile = await findProfile(customerId, customerEmail, userIdMetadata);

        if (profile) {
          console.log(`[Stripe Webhook] Confirming subscription status for user ${profile.id}...`);
          const updated = await updateProfileOrThrow(profile.id, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            subscription_tier: isPaidPro ? 'pro' : 'free',
            stripe_subscription_status: subscription?.status || 'active',
            stripe_price_id: priceId,
            stripe_current_period_end: subscription ? getCurrentPeriodEnd(subscription) : undefined,
            updated_at: new Date().toISOString()
          }, `Invoice profile update for user ${profile.id}`);
          console.log(`[Stripe Webhook] UPDATE SUCCESS: User ${updated.id} tier is ${updated.subscription_tier}.`);
        } else {
          throw new Error(`Could not resolve profile for invoice ${invoice.id}`);
        }
        break;
      }
      
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const userIdMetadata = subscription.metadata?.userId || subscription.metadata?.user_id;
        const status = subscription.status;
        const priceId = getSubscriptionPriceId(subscription);
        
        const isPro = isPaidSubscriptionStatus(status);
        if (isPro) {
          assertPaidProPrice(priceId, `Subscription ${subscription.id}`);
        }
        const tier = isPro ? 'pro' : 'free';

        console.log(`[Stripe Webhook] Syncing subscription ${subscription.id} status: ${status} for user: ${userIdMetadata}`);

        const profile = await findProfile(customerId, null, userIdMetadata);
        
        if (profile) {
          console.log(`[Stripe Webhook] Syncing user ${profile.id} to tier ${tier}...`);
          const updated = await updateProfileOrThrow(profile.id, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            subscription_tier: tier,
            stripe_subscription_status: status,
            stripe_price_id: priceId,
            stripe_current_period_end: getCurrentPeriodEnd(subscription),
            updated_at: new Date().toISOString()
          }, `Subscription profile update for user ${profile.id}`);
          console.log(`[Stripe Webhook] SYNC SUCCESS: User ${updated.id} tier is ${updated.subscription_tier}.`);
        } else {
          throw new Error(`Could not resolve profile for subscription ${subscription.id}`);
        }
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        console.log(`[Stripe Webhook] Rescinding access for deleted subscription ${subscription.id}`);

        const profile = await findProfile(customerId, null);
        
        if (profile) {
          console.log(`[Stripe Webhook] Reverting user ${profile.id} to Free...`);
          const updated = await updateProfileOrThrow(profile.id, {
            subscription_tier: 'free',
            stripe_subscription_status: 'canceled',
            updated_at: new Date().toISOString()
          }, `Cancellation profile update for user ${profile.id}`);
          console.log(`[Stripe Webhook] CANCELLATION SUCCESS: User ${updated.id} downgraded to free.`);
        } else {
          throw new Error(`Could not resolve profile for deleted subscription ${subscription.id}`);
        }
        break;
      }
      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error(`[Stripe Webhook] Fatal error processing webhook: ${error.message}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
