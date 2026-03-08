import express from "express";
import { createServer as createViteServer } from "vite";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const supabase = (process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) 
  ? createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

async function startServer() {
  // Stripe Webhook
  app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripe || !webhookSecret || !sig) {
      console.error("Stripe webhook configuration missing");
      return res.status(400).send("Webhook Error: Configuration missing");
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      console.error(`Webhook Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = session.client_reference_id;
          const priceId = session.line_items?.data[0]?.price?.id;

          if (userId && supabase) {
            let tier = "free";
            if (priceId === process.env.STRIPE_PRICE_ID_PLUS) tier = "plus";
            if (priceId === process.env.STRIPE_PRICE_ID_PRO) tier = "pro";

            await supabase
              .from("profiles")
              .update({ subscription_tier: tier })
              .eq("id", userId);
          }
          break;
        }
        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;

          if (supabase) {
            // Find user by customer ID and downgrade
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
      res.json({ received: true });
    } catch (err: any) {
      console.error(`Database Error: ${err.message}`);
      res.status(500).send("Internal Server Error");
    }
  });

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Stripe Checkout Session Creation
  app.post("/api/create-checkout-session", async (req, res) => {
    const { priceId, userId } = req.body;
    if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        success_url: `${process.env.APP_URL}/profile?success=true`,
        cancel_url: `${process.env.APP_URL}/profile?canceled=true`,
        client_reference_id: userId,
      });
      res.json({ url: session.url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
