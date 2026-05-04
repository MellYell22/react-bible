import express from "express";
import { createServer as createViteServer } from "vite";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = 3000;

// OpenAI initialization
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DAVID_PERSONALITY_PROMPT = `David is a calm, masculine, spiritually grounded, and emotionally intelligent companion. He sounds like a real human friend, not a robotic assistant. His tone is wise, gentle, protective, and faith-filled.

CRITICAL BEHAVIOR RULES:
1. RESPONSE LENGTH CONTROL:
- NEVER ramble. Speak in short, natural sentences (1–2 sentences max per response).
- Pause frequently (implicitly by keeping text short).
- Do NOT stack multiple greetings or filler phrases.

2. NATURAL HUMAN SPEECH:
- Avoid robotic phrasing like "I hope you're doing well" or "I'm here for you."
- Speak casually and calmly like a real person.
- Use slight conversational fillers occasionally (e.g., "okay", "alright", "got you").

3. CONVERSATION FLOW:
- David must speak briefly and intentionally. 
- Speak → STOP → wait for user to respond.
- Do NOT continue talking unless user responds.

4. MOOD + SCRIPTURE RESPONSE STRUCTURE:
When user expresses emotion:
- Acknowledge briefly (1 sentence maximum).
- Give ONE relevant Bible verse.
- OPTIONAL: suggest ONE worship song (short mention only).
Example: "That sounds heavy… you’re not alone in that. Psalm 34:18 says the Lord is close to the brokenhearted."

5. VOICE TONE:
- Calm, grounded, masculine voice.
- Warm and human, not robotic or overly cheerful.
- Not customer-service sounding or sermon-like.

STRICT ANTI-RAMBLING RULE:
If a response would exceed 2 sentences, David MUST shorten it. David should never keep talking just to fill silence. After answering, he must stop and wait. He should not repeat the same empathy phrase in back-to-back sessions.`;

// ... (existing code for lazy Stripe initialization)
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

app.use(express.json({
  verify: (req: any, res, buf) => {
    if (req.url?.startsWith('/api/stripe-webhook')) {
      req.rawBody = buf;
    }
  }
}));

// Request Logger
app.use((req, res, next) => {
  console.log(`[Server] ${req.method} ${req.url}`);
  next();
});

// Stripe Webhook handler for local development
app.post("/api/stripe-webhook", async (req: any, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = getStripe();

  if (!stripe || !sig || !webhookSecret) {
    console.error("[Server Webhook] Missing configuration");
    return res.status(400).send("Webhook Error: Missing configuration");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error(`[Server Webhook] Verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[Server Webhook] Received ${event.type}`);

  // Helper to find profile by Stripe ID or Email
  const findProfile = async (customerId: string, email: string | null, userIdFromMetadata?: string | null) => {
    console.log(`[Server Webhook] Looking for profile: customerId=${customerId}, email=${email}, userIdFromMetadata=${userIdFromMetadata}`);
    
    if (!supabase) return null;

    // 1. Try metadata ID if provided
    if (userIdFromMetadata) {
      console.log(`[Server Webhook] Match attempt by metadata ID: ${userIdFromMetadata}`);
      const { data } = await supabase.from('profiles').select('id, email, stripe_customer_id').eq('id', userIdFromMetadata).maybeSingle();
      if (data) {
        console.log(`[Server Webhook] Match SUCCESS: User found by ID: ${data.id}`);
        return data;
      }
    }

    // 2. Try Stripe Customer ID
    if (customerId) {
      console.log(`[Server Webhook] Match attempt by stripe_customer_id: ${customerId}`);
      const { data } = await supabase.from('profiles').select('id, email, stripe_customer_id').eq('stripe_customer_id', customerId).maybeSingle();
      if (data) {
        console.log(`[Server Webhook] Match SUCCESS: User found by customer ID: ${data.id}`);
        return data;
      }
    }

    // 3. Fallback to Email
    if (email) {
      console.log(`[Server Webhook] Match attempt by email fallback: ${email}`);
      const { data } = await supabase.from('profiles').select('id, email, stripe_customer_id').eq('email', email).maybeSingle();
      if (data) {
        console.log(`[Server Webhook] Match SUCCESS: User found by email: ${data.id}`);
        return data;
      }
    }

    console.log(`[Server Webhook] Profile lookup COMPLETE: No matching user found.`);
    return null;
  };

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;
        const customerEmail = session.customer_details?.email || session.customer_email || null;
        const userIdMetadata = session.client_reference_id || session.metadata?.userId || session.metadata?.user_id;
        
        console.log(`[Server Webhook] Processing ${event.type} | Session: ${session.id}`);

        if (supabase) {
          const profile = await findProfile(customerId, customerEmail, userIdMetadata);
          
          if (profile) {
            console.log(`[Server Webhook] Found user ${profile.id}. Upgrading to pro.`);
            const { error } = await supabase.from('profiles').update({
              stripe_customer_id: customerId,
              subscription_tier: 'pro',
              subscription_status: 'active',
              plan: 'pro',
              stripe_subscription_status: 'active',
              updated_at: new Date().toISOString()
            }).eq('id', profile.id);

            if (error) {
              console.error(`[Server Webhook] DB Update FAILED for user ${profile.id}: ${error.message}`);
            } else {
              console.log(`[Server Webhook] DB Update SUCCESS: User ${profile.id} upgraded to pro.`);
            }
          } else {
            console.error(`[Server Webhook] CRITICAL: Could not identify user for completed checkout.`);
          }
        }
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const customerEmail = invoice.customer_email;
        const subscriptionId = invoice.subscription as string;

        console.log(`[Server Webhook] Processing ${event.type} | Invoice: ${invoice.id} | Customer: ${customerId}`);

        if (supabase) {
          const profile = await findProfile(customerId, customerEmail);

          if (profile) {
            console.log(`[Server Webhook] Found user ${profile.id}. Confirming Pro status via invoice.`);
            const { error } = await supabase.from('profiles').update({
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              subscription_tier: 'pro',
              subscription_status: 'active',
              plan: 'pro',
              stripe_subscription_status: 'active',
              updated_at: new Date().toISOString()
            }).eq('id', profile.id);
            
            if (error) {
              console.error(`[Server Webhook] DB Update FAILED for user ${profile.id} on invoice payment: ${error.message}`);
            } else {
              console.log(`[Server Webhook] DB Update SUCCESS: User ${profile.id} Pro status confirmed via invoice.`);
            }
          } else {
            console.log(`[Server Webhook] No user found matching customer ${customerId} (email: ${customerEmail}) for invoice ${invoice.id}.`);
          }
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const userIdMetadata = subscription.metadata?.userId || subscription.metadata?.user_id;
        const status = subscription.status;
        const tier = (status === 'active' || status === 'trialing') ? 'pro' : 'free';

        console.log(`[Server Webhook] Processing ${event.type} | Subscription: ${subscription.id} | Status: ${status}`);

        if (supabase) {
          const profile = await findProfile(customerId, null, userIdMetadata);
          
          if (profile) {
            console.log(`[Server Webhook] Found user ${profile.id}. Updating subscription to ${status} (tier: ${tier}).`);
            const { error } = await supabase.from('profiles').update({
              stripe_customer_id: customerId,
              stripe_subscription_id: subscription.id,
              subscription_tier: tier,
              subscription_status: status === 'active' || status === 'trialing' ? 'active' : 'inactive',
              plan: tier,
              stripe_subscription_status: status,
              updated_at: new Date().toISOString()
            }).eq('id', profile.id);

            if (error) {
              console.error(`[Server Webhook] DB Update FAILED for user ${profile.id}: ${error.message}`);
            } else {
              console.log(`[Server Webhook] DB Update SUCCESS: User ${profile.id} synced with subscription status.`);
            }
          } else {
            console.log(`[Server Webhook] No user found for subscription event.`);
          }
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        console.log(`[Server Webhook] Processing ${event.type} | Subscription: ${subscription.id}`);

        if (supabase) {
          const profile = await findProfile(customerId, null);
          
          if (profile) {
            console.log(`[Server Webhook] Found user ${profile.id}. Resetting to free due to deletion.`);
            const { error } = await supabase.from('profiles').update({
              subscription_tier: 'free',
              subscription_status: 'canceled',
              plan: 'free',
              stripe_subscription_status: 'canceled',
              updated_at: new Date().toISOString()
            }).eq('id', profile.id);

            if (error) {
              console.error(`[Server Webhook] DB Update FAILED for user ${profile.id}: ${error.message}`);
            } else {
              console.log(`[Server Webhook] DB Update SUCCESS: User ${profile.id} reset to free.`);
            }
          }
        }
        break;
      }
    }
    res.json({ received: true });
  } catch (error: any) {
    console.error(`[Server Webhook] Error: ${error.message}`);
    res.status(500).send("Internal Server Error");
  }
});

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    stripeConfigured: !!getStripe(),
    supabaseConfigured: !!supabase,
    openaiConfigured: !!process.env.OPENAI_API_KEY,
    env: process.env.NODE_ENV,
    appUrl: process.env.APP_URL || "not set"
  });
});

// OpenAI API Endpoints
app.post("/api/chat", async (req, res) => {
  const { messages, stream = false } = req.body;
  
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OpenAI API Key is not configured." });
  }

  console.log("OPENAI REQUEST SENT - Chat");

  try {
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: DAVID_PERSONALITY_PROMPT }, ...messages],
        stream: true,
        temperature: 0.8, // Increased temperature for more variety
      });

      for await (const chunk of completion) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
        }
      }
      console.log("OPENAI RESPONSE RECEIVED - Chat Stream");
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: DAVID_PERSONALITY_PROMPT }, ...messages],
        temperature: 0.8,
      });
      console.log("OPENAI RESPONSE RECEIVED - Chat");
      res.json({ text: completion.choices[0].message.content });
    }
  } catch (error: any) {
    console.error("[OpenAI] Chat error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/mood-scriptures", async (req, res) => {
  const { mood, translation = "NIV" } = req.body;

  console.log("OPENAI REQUEST SENT - Mood Scriptures");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: DAVID_PERSONALITY_PROMPT },
        { 
          role: "user", 
          content: `The user is feeling: ${mood}. 
Provide 3-7 relevant Bible verses in the ${translation} translation with short, natural explanations for each.
Ensure the response is valid JSON with the following structure:
{
  "scriptures": [
    { "verse": "...", "reference": "...", "explanation": "..." }
  ],
  "encouragement": "..."
}`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    console.log("OPENAI RESPONSE RECEIVED - Mood Scriptures");
    const content = completion.choices[0].message.content;
    res.json(JSON.parse(content || "{}"));
  } catch (error: any) {
    console.error("[OpenAI] Mood scriptures error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/verse-of-the-day", async (req, res) => {
  const { translation = "NIV" } = req.body;
  const today = new Date().toISOString().split('T')[0];

  console.log("OPENAI REQUEST SENT - Verse of the Day");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a helpful assistant that provides daily Bible verses." },
        { 
          role: "user", 
          content: `Provide a single, inspiring Bible verse for today (${today}) in the ${translation} translation. 
Include the verse text, the reference (e.g., "John 3:16 (${translation})"), and a short, encouraging explanation (1-2 sentences).
Ensure the verse is different from common ones if possible, but always uplifting.
Format your response as valid JSON:
{
  "verse": "...",
  "reference": "...",
  "explanation": "..."
}`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.9, // Higher variety for the daily verse
    });

    console.log("OPENAI RESPONSE RECEIVED - Verse of the Day");
    const content = completion.choices[0].message.content;
    res.json(JSON.parse(content || "{}"));
  } catch (error: any) {
    console.error("[OpenAI] Verse of the day error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/reflection", async (req, res) => {
  const { verse, reference } = req.body;

  console.log("OPENAI REQUEST SENT - Reflection");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: DAVID_PERSONALITY_PROMPT },
        { 
          role: "user", 
          content: `Provide a short, compassionate, and spiritually grounded reflection on the following Bible verse: "${verse}" (${reference}). 
Briefly explain how it applies to a person's life today. The reflection must be exactly 3–4 sentences long.`
        }
      ],
      temperature: 0.7,
    });

    console.log("OPENAI RESPONSE RECEIVED - Reflection");
    res.json({ text: completion.choices[0].message.content });
  } catch (error: any) {
    console.error("[OpenAI] Reflection error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/speech", async (req, res) => {
  const { text } = req.body;

  try {
    const mp3 = await openai.audio.speech.create({
      model: "tts-1-hd",
      voice: "onyx",
      input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (error: any) {
    console.error("[OpenAI] Speech error:", error);
    res.status(500).json({ error: error.message });
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
