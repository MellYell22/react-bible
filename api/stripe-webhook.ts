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

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id || session.metadata?.userId;
        const customerId = session.customer as string;
        
        console.log(`[Stripe Webhook] Checkout session completed for user: ${userId}, customer: ${customerId}`);

        if (userId) {
          const { error } = await supabase
            .from('profiles')
            .update({
              stripe_customer_id: customerId,
              subscription_tier: 'pro',
              updated_at: new Date().toISOString(),
            })
            .eq('id', userId);

          if (error) {
            console.error(`[Stripe Webhook] Error updating profile for checkout: ${error.message}`);
          } else {
            console.log(`[Stripe Webhook] Successfully updated user ${userId} to pro tier.`);
          }
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const userId = subscription.metadata?.userId;
        const status = subscription.status;

        console.log(`[Stripe Webhook] Subscription ${event.type}: customer: ${customerId}, userId: ${userId}, status: ${status}`);

        // Only update if status is active or trialing
        const tier = (status === 'active' || status === 'trialing') ? 'pro' : 'free';

        let query = supabase.from('profiles').update({
          subscription_tier: tier,
          updated_at: new Date().toISOString(),
        });

        if (userId) {
          query = query.eq('id', userId);
        } else {
          query = query.eq('stripe_customer_id', customerId);
        }

        const { error } = await query;

        if (error) {
          console.error(`[Stripe Webhook] Error updating profile for subscription ${event.type}: ${error.message}`);
        } else {
          console.log(`[Stripe Webhook] Updated customer ${customerId} tier to ${tier}.`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        console.log(`[Stripe Webhook] Subscription deleted for customer: ${customerId}`);

        const { error } = await supabase
          .from('profiles')
          .update({
            subscription_tier: 'free',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId);

        if (error) {
          console.error(`[Stripe Webhook] Error resetting profile on subscription deletion: ${error.message}`);
        } else {
          console.log(`[Stripe Webhook] Successfully reset customer ${customerId} to free tier.`);
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
