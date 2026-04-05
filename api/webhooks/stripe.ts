import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-01-27.acacia' as any,
});

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (supabaseUrl && supabaseServiceKey) 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

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
    console.error("Stripe webhook configuration missing");
    return res.status(400).send("Webhook Error: Configuration missing");
  }

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const priceId = session.line_items?.data?.[0]?.price?.id || (session as any).metadata?.priceId;

        console.log(`[StripeWebhook] Checkout completed for user: ${userId}, priceId: ${priceId}`);

        if (userId && supabase) {
          let tier = "free";
          const plusPriceId = process.env.STRIPE_PRICE_ID_PLUS || process.env.VITE_STRIPE_PRICE_ID_PLUS;
          const proPriceId = process.env.STRIPE_PRICE_ID_PRO || process.env.VITE_STRIPE_PRICE_ID_PRO;

          if (priceId === plusPriceId) tier = "plus";
          if (priceId === proPriceId) tier = "pro";

          console.log(`[StripeWebhook] Updating user ${userId} to tier: ${tier}`);

          const { error } = await supabase
            .from("profiles")
            .update({ subscription_tier: tier })
            .eq("id", userId);
          
          if (error) console.error(`[StripeWebhook] Supabase error: ${error.message}`);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        if (supabase) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .single();

          if (profile) {
            await supabase
              .from("profiles")
              .update({ subscription_tier: "free" })
              .eq("id", profile.id);
          }
        }
        break;
      }
    }
    res.status(200).json({ received: true });
  } catch (err: any) {
    console.error(`Database Error: ${err.message}`);
    res.status(500).send("Internal Server Error");
  }
}
