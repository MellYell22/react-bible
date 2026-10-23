import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deriveSubscriptionTier,
  getStripeId,
  getSubscriptionPriceIds,
  matchTierByPriceIds,
} from './subscriptionState.js';

type TierPrices = { plus?: string | null; pro?: string | null };

type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

type ProfileRecord = {
  id: string;
  email: string | null;
  subscription_tier: string | null;
};

type ProfileLookup = {
  profile: ProfileRecord;
  matchedBy: 'user_id' | 'stripe_customer_id' | 'email';
};

export type StripeWebhookResult = {
  processed: boolean;
  ignored?: boolean;
  reason?: string;
  profileId?: string;
  tier?: string;
};

type ProcessStripeEventOptions = {
  event: Stripe.Event;
  stripe: Stripe;
  supabase: SupabaseClient;
  // Configured paid-tier prices. `proPriceId` is still accepted for backward
  // compatibility and is treated as tierPrices.pro when tierPrices is absent.
  tierPrices?: TierPrices;
  proPriceId?: string;
  logger?: Logger;
};

const normalizeTierPrices = (
  tierPrices?: TierPrices,
  proPriceId?: string,
): TierPrices => {
  if (tierPrices && (tierPrices.plus || tierPrices.pro)) return tierPrices;
  return { pro: proPriceId || null };
};

const getCustomerEmail = async (stripe: Stripe, customerId: string | null, logger: Logger) => {
  if (!customerId) return null;

  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ((customer as any).deleted) return null;
    return (customer as Stripe.Customer).email || null;
  } catch (error: any) {
    logger.warn(`[Stripe Webhook] Could not retrieve customer ${customerId}: ${error?.message || error}`);
    return null;
  }
};

const findProfile = async (
  supabase: SupabaseClient,
  {
    userId,
    customerId,
    email,
  }: {
    userId?: string | null;
    customerId?: string | null;
    email?: string | null;
  },
): Promise<ProfileLookup | null> => {
  if (userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, subscription_tier')
      .eq('id', userId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return { profile: data as ProfileRecord, matchedBy: 'user_id' };
  }

  if (customerId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, subscription_tier')
      .eq('stripe_customer_id', customerId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return { profile: data as ProfileRecord, matchedBy: 'stripe_customer_id' };
  }

  if (email) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, subscription_tier')
      .ilike('email', email)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return { profile: data as ProfileRecord, matchedBy: 'email' };
  }

  return null;
};

const ignore = (logger: Logger, reason: string): StripeWebhookResult => {
  logger.warn(`[Stripe Webhook] Ignored event: ${reason}`);
  return { processed: false, ignored: true, reason };
};

const saveSubscription = async (
  supabase: SupabaseClient,
  profile: ProfileRecord,
  customerId: string | null,
  subscription: Stripe.Subscription,
  tierPrices: TierPrices,
  logger: Logger,
): Promise<StripeWebhookResult> => {
  const priceIds = getSubscriptionPriceIds(subscription);
  const nextTier = deriveSubscriptionTier({
    currentTier: profile.subscription_tier,
    status: subscription.status,
    priceIds,
    tierPrices,
  });
  const hasPaidAccess = nextTier === 'pro' || nextTier === 'plus' || nextTier === 'owner';
  const periodEnd = typeof (subscription as any).current_period_end === 'number'
    ? new Date((subscription as any).current_period_end * 1000).toISOString()
    : null;

  const update: Record<string, unknown> = {
    subscription_status: hasPaidAccess ? 'active' : subscription.status,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_subscription_status: subscription.status,
    stripe_price_id: priceIds[0] || null,
  };

  if (periodEnd) update.stripe_current_period_end = periodEnd;
  if (profile.subscription_tier !== 'owner') update.subscription_tier = nextTier;

  const { data, error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', profile.id)
    .select('id, subscription_tier')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error(`Profile ${profile.id} disappeared before its subscription could be updated.`);

  logger.log(`[Stripe Webhook] Profile ${profile.id} synchronized to ${data.subscription_tier}.`);
  return {
    processed: true,
    profileId: profile.id,
    tier: data.subscription_tier,
  };
};

const resolveProfileForSubscription = async (
  stripe: Stripe,
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
  fallbackEmail: string | null,
  logger: Logger,
) => {
  const customerId = getStripeId(subscription.customer);
  const metadataUserId = subscription.metadata?.userId || subscription.metadata?.user_id || null;
  const customerEmail = fallbackEmail || await getCustomerEmail(stripe, customerId, logger);
  const lookup = await findProfile(supabase, {
    userId: metadataUserId,
    customerId,
    email: customerEmail,
  });

  return { lookup, customerId };
};

const processSubscription = async (
  stripe: Stripe,
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
  tierPrices: TierPrices,
  logger: Logger,
  fallbackEmail: string | null = null,
) => {
  const priceIds = getSubscriptionPriceIds(subscription);
  if (!matchTierByPriceIds(priceIds, tierPrices)) {
    return ignore(
      logger,
      `subscription ${subscription.id} uses a different app price (${priceIds.join(', ') || 'none'})`,
    );
  }

  const { lookup, customerId } = await resolveProfileForSubscription(
    stripe,
    supabase,
    subscription,
    fallbackEmail,
    logger,
  );

  if (!lookup) {
    return ignore(
      logger,
      `no Bible Mood Search profile matches subscription ${subscription.id}; this is likely a legacy or another-app subscription`,
    );
  }

  logger.log(`[Stripe Webhook] Matched subscription ${subscription.id} by ${lookup.matchedBy}.`);
  return saveSubscription(supabase, lookup.profile, customerId, subscription, tierPrices, logger);
};

export const processStripeEvent = async ({
  event,
  stripe,
  supabase,
  tierPrices: tierPricesInput,
  proPriceId,
  logger = console,
}: ProcessStripeEventOptions): Promise<StripeWebhookResult> => {
  const tierPrices = normalizeTierPrices(tierPricesInput, proPriceId);
  switch (event.type) {
    case 'checkout.session.completed': {
      const checkout = event.data.object as Stripe.Checkout.Session;
      if (checkout.mode !== 'subscription' || !checkout.subscription) {
        return ignore(logger, `checkout ${checkout.id} is not a subscription checkout`);
      }

      const subscriptionId = getStripeId(checkout.subscription);
      if (!subscriptionId) return ignore(logger, `checkout ${checkout.id} has no subscription ID`);

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const metadataUserId = checkout.client_reference_id
        || checkout.metadata?.userId
        || checkout.metadata?.user_id
        || null;

      if (metadataUserId && !subscription.metadata?.userId && !subscription.metadata?.user_id) {
        subscription.metadata = { ...subscription.metadata, userId: metadataUserId, user_id: metadataUserId };
      }

      return processSubscription(
        stripe,
        supabase,
        subscription,
        tierPrices,
        logger,
        checkout.customer_details?.email || checkout.customer_email || null,
      );
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return processSubscription(
        stripe,
        supabase,
        event.data.object as Stripe.Subscription,
        tierPrices,
        logger,
      );

    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = getStripeId((invoice as any).subscription);
      if (!subscriptionId) return ignore(logger, `invoice ${invoice.id} has no subscription`);

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      return processSubscription(
        stripe,
        supabase,
        subscription,
        tierPrices,
        logger,
        invoice.customer_email || null,
      );
    }

    case 'invoice.payment_failed': {
      // Do not rely on a later webhook arriving: reconcile against Stripe now.
      // Stripe may legitimately keep a subscription active during retries,
      // so use its current status rather than revoking access blindly.
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = getStripeId((invoice as any).subscription);
      if (!subscriptionId) return ignore(logger, `failed invoice ${invoice.id} has no subscription`);

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      return processSubscription(
        stripe,
        supabase,
        subscription,
        tierPrices,
        logger,
        invoice.customer_email || null,
      );
    }

    default:
      return ignore(logger, `unsupported event type ${event.type}`);
  }
};
