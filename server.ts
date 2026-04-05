import express from "express";
import { createServer as createViteServer } from "vite";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = 3000;

// Lazy Stripe initialization to avoid top-level crashes
let stripeInstance: Stripe | null = null;
function getStripe() {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      console.error("[StripeAPI] STRIPE_SECRET_KEY is missing from environment variables");
      return null;
    }
    stripeInstance = new Stripe(key, {
      apiVersion: "2025-01-27.acacia" as any,
    });
  }
  return stripeInstance;
}

// Supabase configuration for server-side (using Service Role Key for admin access)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (supabaseUrl && supabaseServiceKey) 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// Stripe Webhook - MUST be before express.json()
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  const stripe = getStripe();
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
        const priceId = session.line_items?.data?.[0]?.price?.id || (session as any).metadata?.priceId;

        console.log(`[StripeWebhook] Checkout completed for user: ${userId}, priceId: ${priceId}`);

        if (userId && supabase) {
          let tier = "free";
          const plusPriceId = process.env.VITE_STRIPE_PRICE_ID_PLUS || process.env.STRIPE_PRICE_ID_PLUS;
          const proPriceId = process.env.VITE_STRIPE_PRICE_ID_PRO || process.env.STRIPE_PRICE_ID_PRO;

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

// Request Logger
app.use((req, res, next) => {
  console.log(`[Server] ${req.method} ${req.url}`);
  next();
});

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    stripeConfigured: !!getStripe(),
    supabaseConfigured: !!supabase,
    env: process.env.NODE_ENV,
    appUrl: process.env.APP_URL || "not set"
  });
});

// Stripe Checkout Session Creation
app.post("/api/create-checkout-session", async (req, res, next) => {
  try {
    const { priceId, userId } = req.body;
    const stripe = getStripe();
    
    console.log(`[StripeAPI] Received request for checkout session. User: ${userId}, Price: ${priceId}`);

    if (!stripe) {
      console.error("[StripeAPI] Stripe is not configured on the server");
      return res.status(500).json({ error: "Stripe is not configured on the server. Check STRIPE_SECRET_KEY." });
    }

    if (!userId) {
      console.error("[StripeAPI] Missing userId in request");
      return res.status(400).json({ error: "Missing userId" });
    }

    if (!priceId) {
      console.error("[StripeAPI] Missing priceId in request");
      return res.status(400).json({ error: "Missing priceId" });
    }

    // Map plan names to price IDs if necessary
    let targetPriceId = priceId;
    if (priceId === 'plus') {
      targetPriceId = process.env.STRIPE_PRICE_ID_PLUS || process.env.VITE_STRIPE_PRICE_ID_PLUS;
    } else if (priceId === 'pro') {
      targetPriceId = process.env.STRIPE_PRICE_ID_PRO || process.env.VITE_STRIPE_PRICE_ID_PRO;
    }
    
    // Fallback to a generic STRIPE_PRICE_ID if still not found
    if (!targetPriceId) {
      targetPriceId = process.env.STRIPE_PRICE_ID;
    }

    if (!targetPriceId) {
      console.error(`[StripeAPI] Price ID not found for plan: ${priceId}`);
      return res.status(400).json({ error: `Price ID not found for plan: ${priceId}` });
    }

    // Try to get the base URL from the request if APP_URL is not set
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers.host;
    const defaultUrl = `${protocol}://${host}`;
    
    const appUrl = process.env.APP_URL || defaultUrl;
    // Ensure no trailing slash for consistency
    const baseUrl = appUrl.endsWith('/') ? appUrl.slice(0, -1) : appUrl;

    console.log(`[StripeAPI] Creating session with baseUrl: ${baseUrl}, priceId: ${targetPriceId}`);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: targetPriceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${baseUrl}/profile?success=true`,
      cancel_url: `${baseUrl}/profile?canceled=true`,
      client_reference_id: userId,
      metadata: {
        userId,
        priceId: targetPriceId
      }
    });
    
    console.log(`[StripeAPI] Session created: ${session.id}`);
    res.json({ url: session.url });
  } catch (err: any) {
    console.error(`[StripeAPI] Stripe Error: ${err.message}`);
    next(err); // Pass to global error handler
  }
});

// 404 for API routes - MUST be after all API routes
app.all("/api/*", (req, res) => {
  console.warn(`[Server] 404 on API route: ${req.method} ${req.url}`);
  res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
});

// Global Error Handler - Ensures JSON response for all errors
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(`[Server Error] ${err.stack || err.message}`);
  res.status(err.status || 500).json({ 
    error: "Internal Server Error",
    message: err.message || "An unexpected error occurred"
  });
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Only listen if not on Vercel
  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
      console.log(`APP_URL: ${process.env.APP_URL || "not set (defaulting to localhost:3000)"}`);
      console.log(`Stripe Configured: ${!!getStripe()}`);
      console.log(`Supabase Configured: ${!!supabase}`);
    });
  }
}

startServer();
