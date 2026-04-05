import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-01-27.acacia' as any,
});

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { priceId, userId } = req.body;
    
    console.log(`[StripeAPI] Received request for checkout session. User: ${userId}, Price: ${priceId}`);

    if (!process.env.STRIPE_SECRET_KEY) {
      console.error("[StripeAPI] STRIPE_SECRET_KEY is missing");
      return res.status(500).json({ error: "Stripe is not configured on the server." });
    }

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    if (!priceId) {
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
    res.status(200).json({ url: session.url });
  } catch (err: any) {
    console.error(`[StripeAPI] Stripe Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
}
