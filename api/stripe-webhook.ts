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
const PAID_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

const getConfiguredProPriceId = () =>
  process.env.STRIPE_PRICE_ID_PRO || process.env.VITE_STRIPE_PRICE_ID_PRO || '';

const getStringId = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
};

const getSubscriptionDetails = async (subscriptionId: string | null) => {
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

const assertConfiguredProPrice = (context: string) => {
  const proPriceId = getConfiguredProPriceId();
  if (!proPriceId) {
    throw new Error(`[Stripe Webhook] STRIPE_PRICE_ID_PRO is required before granting Pro access (${context})`);
  }
  return proPriceId;
};

const isProEntitlement = (input: { priceId: string | null; status: string | null }, context: string) => {
  const proPriceId = assertConfiguredProPrice(context);
  return input.priceId === proPriceId && !!input.status && PAID_SUBSCRIPTION_STATUSES.has(input.status);
};

const updateProfileOrThrow = async (
  profileId: string,
  updateData: Record<string, unknown>,
  context: string,
) => {
  const { data, error } = await supabase
    .from('profiles')
    .update(updateData)
    .eq('id', profileId)
    .select('id, subscription_tier');

  if (error) {
    throw new Error(`${context} failed for user ${profileId}: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error(`${context} affected 0 rows for user ${profileId}`);
  }

  return data[0];
};

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
      if (error) console.error(`[Stripe Webhook] error looking up by ID: ${error.message}`);
    }

    // 2. Priority 2: Stripe Customer ID
    if (customerId) {
      console.log(`[Stripe Webhook] Attempt 2: Look up by stripe_customer_id ${customerId}`);
      const { data, error } = await supabase.from('profiles').select('id, email, subscription_tier').eq('stripe_customer_id', customerId).maybeSingle();
      if (data) {
        console.log(`[Stripe Webhook] SUCCESS: Found user by customer ID: ${data.id}`);
        return data;
      }
      if (error) console.error(`[Stripe Webhook] error looking up by customer ID: ${error.message}`);
    }

    // 3. Priority 3: Email Fallback
    if (email) {
      console.log(`[Stripe Webhook] Attempt 3: Look up by email ${email}`);
      const { data, error } = await supabase.from('profiles').select('id, email, subscription_tier').eq('email', email).maybeSingle();
      if (data) {
        console.log(`[Stripe Webhook] SUCCESS: Found user by email: ${data.id}`);
        return data;
      }
      if (error) console.error(`[Stripe Webhook] error looking up by email: ${error.message}`);
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

        const profile = await findProfile(customerId, customerEmail, userIdMetadata);
        
        if (!profile) {
          throw new Error(`[Stripe Webhook] Could not resolve profile for checkout session ${session.id}`);
        }

        const subscriptionDetails = await getSubscriptionDetails(getStringId(session.subscription));
        const lineItems = subscriptionDetails.priceId
          ? null
          : await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
        const priceId = subscriptionDetails.priceId || lineItems?.data[0]?.price?.id || null;
        const status = subscriptionDetails.status || (session.payment_status === 'paid' ? 'active' : null);
        const isPro = isProEntitlement({ priceId, status }, `checkout.session.completed ${session.id}`);

        if (!isPro) {
          throw new Error(`[Stripe Webhook] Refusing Pro grant for checkout session ${session.id}: status=${status || 'none'}, price=${priceId || 'none'}`);
        }

        console.log(`[Stripe Webhook] Upgrading user ${profile.id} to Pro...`);
        await updateProfileOrThrow(profile.id, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionDetails.subscriptionId,
            subscription_tier: 'pro',
            subscription_status: 'active',
            plan: 'pro',
            stripe_subscription_status: status,
            stripe_price_id: priceId,
            ...(subscriptionDetails.currentPeriodEnd ? { stripe_current_period_end: subscriptionDetails.currentPeriodEnd } : {}),
            updated_at: new Date().toISOString()
          }, 'checkout.session.completed profile update');
        console.log(`[Stripe Webhook] UPDATE SUCCESS: User ${profile.id} is now Pro.`);
        break;
      }
      
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const customerEmail = invoice.customer_email;
        const subscriptionDetails = await getSubscriptionDetails(getStringId((invoice as any).subscription));
        const subscriptionId = subscriptionDetails.subscriptionId;

        console.log(`[Stripe Webhook] Processing invoice ${invoice.id} for customer ${customerId}`);

        if (!subscriptionId) {
          console.log(`[Stripe Webhook] Invoice ${invoice.id} has no subscription; no Pro entitlement to sync.`);
          break;
        }

        const profile = await findProfile(customerId, customerEmail, subscriptionDetails.userId);

        if (!profile) {
          throw new Error(`[Stripe Webhook] Could not resolve profile for invoice ${invoice.id}`);
        }

        const isPro = isProEntitlement(
          { priceId: subscriptionDetails.priceId, status: subscriptionDetails.status },
          `${event.type} ${invoice.id}`,
        );

        console.log(`[Stripe Webhook] Confirming Pro status for user ${profile.id}...`);
        await updateProfileOrThrow(profile.id, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            subscription_tier: isPro ? 'pro' : 'free',
            subscription_status: isPro ? 'active' : 'inactive',
            plan: isPro ? 'pro' : 'free',
            stripe_subscription_status: subscriptionDetails.status,
            stripe_price_id: subscriptionDetails.priceId,
            ...(subscriptionDetails.currentPeriodEnd ? { stripe_current_period_end: subscriptionDetails.currentPeriodEnd } : {}),
            updated_at: new Date().toISOString()
          }, `${event.type} profile update`);
        console.log(`[Stripe Webhook] UPDATE SUCCESS: User ${profile.id} subscription status confirmed.`);
        break;
      }
      
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const userIdMetadata = subscription.metadata?.userId || subscription.metadata?.user_id;
        const status = subscription.status;
        const priceId = subscription.items.data[0]?.price?.id || null;
        const currentPeriodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null;
        
        const isPro = isProEntitlement({ priceId, status }, `${event.type} ${subscription.id}`);
        const tier = isPro ? 'pro' : 'free';

        console.log(`[Stripe Webhook] Syncing subscription ${subscription.id} status: ${status} for user: ${userIdMetadata}`);

        const profile = await findProfile(customerId, null, userIdMetadata);
        
        if (!profile) {
          throw new Error(`[Stripe Webhook] Could not resolve profile for subscription ${subscription.id}`);
        }

        console.log(`[Stripe Webhook] Syncing user ${profile.id} to tier ${tier}...`);
        await updateProfileOrThrow(profile.id, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            subscription_tier: tier,
            subscription_status: isPro ? 'active' : 'inactive',
            plan: tier,
            stripe_subscription_status: status,
            stripe_price_id: priceId,
            ...(currentPeriodEnd ? { stripe_current_period_end: currentPeriodEnd } : {}),
            updated_at: new Date().toISOString()
          }, `${event.type} profile update`);
        console.log(`[Stripe Webhook] SYNC SUCCESS: User ${profile.id} profile synchronized.`);
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        console.log(`[Stripe Webhook] Rescinding access for deleted subscription ${subscription.id}`);

        const profile = await findProfile(customerId, null);
        
        if (!profile) {
          throw new Error(`[Stripe Webhook] Could not resolve profile for deleted subscription ${subscription.id}`);
        }

        console.log(`[Stripe Webhook] Reverting user ${profile.id} to Free...`);
        await updateProfileOrThrow(profile.id, {
            subscription_tier: 'free',
            subscription_status: 'canceled',
            plan: 'free',
            stripe_subscription_status: 'canceled',
            updated_at: new Date().toISOString()
          }, 'customer.subscription.deleted profile update');
        console.log(`[Stripe Webhook] CANCELLATION SUCCESS: User ${profile.id} downgraded to free.`);
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
