import Stripe from "stripe";

export const config = {
  api: {
    bodyParser: false,
  },
};

const getStripe = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured.");
  return new Stripe(secretKey, { apiVersion: "2023-10-16" as any });
};

import { buffer } from "micro";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sig = req.headers["stripe-signature"];

  let event;

  try {
    const stripe = getStripe();
    const buf = await buffer(req);

    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    console.log("✅ Webhook verified:", event.type);
  } catch (err: any) {
    console.error("❌ Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // 🔥 HANDLE EVENTS
    switch (event.type) {
      case "checkout.session.completed":
      case "invoice.paid":
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const data = event.data.object as any;

        const userId =
          data?.metadata?.userId ||
          data?.metadata?.user_id ||
          data?.client_reference_id;

        console.log("👤 Found userId:", userId);

        if (userId) {
          // 🔥 UPDATE SUPABASE USER
          const { createClient } = await import("@supabase/supabase-js");

          const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          );

          const { error } = await supabase
            .from("profiles")
            .update({
              subscription_tier: "pro",
              subscription_status: "active",
              plan: "pro",
              stripe_subscription_status: "active",
            })
            .eq("id", userId);

          if (error) {
            console.error("❌ Supabase update failed:", error);
          } else {
            console.log("✅ User upgraded to PRO:", userId);
          }
        } else {
          console.error("❌ No userId found in metadata");
        }

        break;
      }

      case "customer.subscription.deleted":
      case "invoice.payment_failed": {
        const data = event.data.object as any;

        const userId =
          data?.metadata?.userId ||
          data?.metadata?.user_id ||
          data?.client_reference_id;

        if (userId) {
          const { createClient } = await import("@supabase/supabase-js");

          const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          );

          await supabase
            .from("profiles")
            .update({
              subscription_tier: "free",
              subscription_status: "inactive",
            })
            .eq("id", userId);

          console.log("⬇️ User downgraded:", userId);
        }

        break;
      }

      default:
        console.log("Unhandled event:", event.type);
    }

    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("❌ Webhook processing error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
