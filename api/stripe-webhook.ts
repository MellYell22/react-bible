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

  // Helper to find profile by Stripe ID or Email
  const findProfile = async (customerId: string, email: string | null, userIdFromMetadata?: string | null) => {
    console.log(`[Stripe Webhook] Looking for profile: customerId=${customerId}, email=${email}, userIdFromMetadata=${userIdFromMetadata}`);
    
    // 1. Try metadata ID if provided
    if (userIdFromMetadata) {
      console.log(`[Stripe Webhook] Attempting match by metadata ID/client_reference_id: ${userIdFromMetadata}`);
      const { data } = await supabase.from('profiles').select('id, email, stripe_customer_id').eq('id', userIdFromMetadata).maybeSingle();
      if (data) {
        console.log(`[Stripe Webhook] Match SUCCESS: User found by metadata ID: ${data.id}`);
        return data;
      }
      console.log(`[Stripe Webhook] Match FAILED: No user found with ID: ${userIdFromMetadata}`);
    }

    // 2. Try Stripe Customer ID
    if (customerId) {
      console.log(`[Stripe Webhook] Attempting match by stripe_customer_id: ${customerId}`);
      const { data } = await supabase.from('profiles').select('id, email, stripe_customer_id').eq('stripe_customer_id', customerId).maybeSingle();
      if (data) {
        console.log(`[Stripe Webhook] Match SUCCESS: User found by stripe_customer_id: ${data.id}`);
        return data;
      }
      console.log(`[Stripe Webhook] Match FAILED: No user found with stripe_customer_id: ${customerId}`);
    }

    // 3. Fallback to Email
    if (email) {
      console.log(`[Stripe Webhook] Attempting match by email fallback: ${email}`);
      const { data } = await supabase.from('profiles').select('id, email, stripe_customer_id').eq('email', email).maybeSingle();
      if (data) {
        console.log(`[Stripe Webhook] Match SUCCESS: User found by email fallback: ${data.id}`);
        return data;
      }
      console.log(`[Stripe Webhook] Match FAILED: No user found with email: ${email}`);
    }

    console.log(`[Stripe Webhook] Profile lookup COMPLETE: No matching user found for customerId: ${customerId}, email: ${email}`);
    return null;
  };

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;
        const customerEmail = session.customer_details?.email || session.customer_email || null;
        const userIdMetadata = session.client_reference_id || session.metadata?.userId || session.metadata?.user_id;
        
        console.log(`[Stripe Webhook] Processing event: ${event.type} | Session: ${session.id} | Customer: ${customerId} | Email: ${customerEmail}`);
        
        const profile = await findProfile(customerId, customerEmail, userIdMetadata);

        if (profile) {
          console.log(`[Stripe Webhook] Found user ${profile.id}. Proceeding with Pro upgrade.`);
          const { error } = await supabase
            .from('profiles')
            .update({
              stripe_customer_id: customerId,
              subscription_tier: 'pro',
              subscription_status: 'active',
              plan: 'pro',
              stripe_subscription_status: 'active',
              updated_at: new Date().toISOString(),
            })
            .eq('id', profile.id);

          if (error) {
            console.error(`[Stripe Webhook] DB Update FAILED for user ${profile.id}: ${error.message}`);
          } else {
            console.log(`[Stripe Webhook] DB Update SUCCESS: User ${profile.id} is now Pro.`);
          }
        } else {
          console.error(`[Stripe Webhook] CRITICAL: Could not identify user for completed checkout session.`);
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const customerEmail = invoice.customer_email;
        const subscriptionId = invoice.subscription as string;

        console.log(`[Stripe Webhook] Processing event: ${event.type} | Invoice: ${invoice.id} | Customer: ${customerId} | Email: ${customerEmail}`);

        const profile = await findProfile(customerId, customerEmail);

        if (profile) {
          console.log(`[Stripe Webhook] Found user ${profile.id}. Processing paid invoice.`);
          const { error } = await supabase
            .from('profiles')
            .update({
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              subscription_tier: 'pro',
              subscription_status: 'active',
              plan: 'pro',
              stripe_subscription_status: 'active',
              updated_at: new Date().toISOString(),
            })
            .eq('id', profile.id);
            
          if (error) {
            console.error(`[Stripe Webhook] DB Update FAILED for user ${profile.id} on invoice payment: ${error.message}`);
          } else {
            console.log(`[Stripe Webhook] DB Update SUCCESS: User ${profile.id} Pro status confirmed via invoice payment.`);
          }
        } else {
          console.log(`[Stripe Webhook] No user found for paid invoice ${invoice.id}.`);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const userIdMetadata = subscription.metadata?.userId || subscription.metadata?.user_id;
        const status = subscription.status;
        
        console.log(`[Stripe Webhook] Processing event: ${event.type} | Subscription: ${subscription.id} | Customer: ${customerId} | Status: ${status}`);

        const profile = await findProfile(customerId, null, userIdMetadata);

        if (profile) {
          const tier = (status === 'active' || status === 'trialing') ? 'pro' : 'free';
          console.log(`[Stripe Webhook] Found user ${profile.id}. Updating status to ${status} (Tier: ${tier}).`);
          
          const { error } = await supabase
            .from('profiles')
            .update({
              subscription_tier: tier,
              subscription_status: status === 'active' || status === 'trialing' ? 'active' : 'inactive',
              plan: tier,
              stripe_subscription_status: status,
              stripe_subscription_id: subscription.id,
              stripe_customer_id: customerId,
              updated_at: new Date().toISOString(),
            })
            .eq('id', profile.id);

          if (error) {
            console.error(`[Stripe Webhook] DB Update FAILED for user ${profile.id} on subscription event ${event.type}: ${error.message}`);
          } else {
            console.log(`[Stripe Webhook] DB Update SUCCESS: User ${profile.id} profile synchronized with Stripe subscription.`);
          }
        } else {
          console.log(`[Stripe Webhook] No user found for subscription event ${event.id}.`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        console.log(`[Stripe Webhook] Processing event: ${event.type} | Subscription: ${subscription.id} | Customer: ${customerId}`);

        const profile = await findProfile(customerId, null);

        if (profile) {
          console.log(`[Stripe Webhook] Found user ${profile.id}. Downgrading to free tier due to cancelled subscription.`);
          const { error } = await supabase
            .from('profiles')
            .update({
              subscription_tier: 'free',
              subscription_status: 'canceled',
              plan: 'free',
              stripe_subscription_status: 'canceled',
              updated_at: new Date().toISOString(),
            })
            .eq('id', profile.id);

          if (error) {
            console.error(`[Stripe Webhook] DB Update FAILED for user ${profile.id} on subscription deletion: ${error.message}`);
          } else {
            console.log(`[Stripe Webhook] DB Update SUCCESS: User ${profile.id} reverted to free tier.`);
          }
        } else {
          console.log(`[Stripe Webhook] No user found for subscription deletion ${subscription.id}.`);
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
