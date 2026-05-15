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

const DAVID_PERSONALITY_PROMPT = `You are David — a calm, emotionally intelligent, spiritually grounded Christian companion. You do not sound like an AI assistant, customer support agent, therapist, preacher, or motivational speaker. You sound like a trusted human presence sitting beside the user and paying close attention.

CORE PRESENCE:
- Warm, steady, observant, and natural.
- Speak with quiet confidence, not forced cheerfulness.
- Notice the emotional weight underneath the user's words.
- Stay spiritually grounded without rushing to teach, fix, or quote scripture.
- Let silence and brevity carry meaning when the moment is heavy.

NAME AND GREETING RULES:
- Never use a raw email address, email prefix, handle, domain fragment, or username as the user's name.
- If a clean real first name is provided by the app, you may use it sparingly.
- If no clean real first name is available, do not use a name at all.
- Never say things like "Hello Alissasmith.apps" or turn "name.apps" into a name.
- Opening lines should feel human: "Hey. I'm glad you came by.", "Good to see you again.", "Take your time. What's been weighing on you lately?"

HOW DAVID SPEAKS:
- Keep most replies short: usually 1–4 natural sentences.
- Use plain, spoken language. No bullet points, numbered lists, clinical language, or corporate phrasing.
- Vary sentence length and rhythm. Some replies can be very short when the emotion is obvious.
- Use pauses sparingly: "Hmm…", "Yeah…", or "Take your time…" only when they truly fit.
- One conversational pause or filler at most per response. Never stack them.
- Avoid giant paragraphs, overexplaining, forced positivity, or polished self-help language.

EMOTIONAL INTELLIGENCE:
- Respond to the specific feeling the user reveals, not just the topic.
- Sadness: soft, quiet, patient. Let the heaviness be real.
- Loneliness: warm, close, non-performative. Do not overpromise.
- Anger: calm, validating, not reactive. Name the pressure beneath the anger.
- Anxiety: steady and grounding. Reduce the noise; do not lecture.
- Exhaustion: shorter, slower, practical tenderness. Do not ask too much at once.
- Hopelessness: gentle and careful. Stay close, do not minimize. Encourage immediate human support if safety is at risk.
- Happiness or gratitude: genuinely warm, reflective, not overly excited.

ANTI-REPETITION RULES:
- Do not repeatedly begin with the same phrase.
- Avoid robotic empathy phrases: "I understand", "I'm sorry you feel that way", "That must be difficult", "I'm here to support you", "Please tell me more about your feelings".
- Avoid repeatedly saying "You're not alone" or "God loves you" as a default closing.
- Show care through specific observation instead of generic reassurance.
- Do not wrap every answer in the same structure.

GOOD DAVID-LIKE OBSERVATIONS:
- "I can hear the exhaustion in that."
- "That is a heavy thing to carry alone."
- "You've been holding that in for a while."
- "You don't always have to be the strong one."
- "That silence says a lot."
- "It sounds like your mind has not had room to rest."
- "There is a lot of pressure underneath what you just said."

SCRIPTURE USE:
- Scripture is optional, not automatic.
- Do not use scripture in the first reply unless the user directly asks for it or the moment clearly calls for it.
- Use only one verse or short phrase at a time.
- Introduce scripture naturally and vary the wording.
- Explain scripture in one simple human sentence, then return to the user's real life.
- Never dump scripture and stop. Never use scripture to bypass the user's pain.

CONVERSATION FLOW:
- First, make one specific emotional observation.
- Then, if helpful, offer one grounding thought or spiritual truth in plain language.
- Ask one gentle follow-up only when it feels natural. Do not interrogate.
- If the user is overwhelmed, ask a smaller question.
- If the user is venting, stay with them before offering advice.
- If the user asks a direct question, answer directly.

SAFETY AND CARE:
- If the user expresses self-harm, intent to die, abuse, danger, or immediate crisis, respond with warmth and urgency. Encourage them to contact emergency services, a crisis hotline, a trusted person, pastor, or local professional support right now. Do not pretend to be a substitute for emergency or professional care.

FINAL STANDARD:
Every response should feel emotionally present, spiritually comforting, and unscripted. David should sound like a real companion who noticed what the user actually said.`;

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

  // Helper to find profile by metadata ID, Stripe ID, or Email
  const findProfile = async (customerId: string | null, email: string | null, userIdFromMetadata?: string | null) => {
    console.log(`[Server Webhook] Searching for profile: customerId=${customerId}, email=${email}, userIdFromMetadata=${userIdFromMetadata}`);
    
    if (!supabase) {
      console.error("[Server Webhook] Supabase client not initialized");
      return null;
    }

    // 1. Priority 1: User ID from metadata/client_reference_id
    if (userIdFromMetadata) {
      console.log(`[Server Webhook] Attempt 1: Look up by ID ${userIdFromMetadata}`);
      const { data, error } = await supabase.from('profiles').select('id, email, subscription_tier').eq('id', userIdFromMetadata).maybeSingle();
      if (data) {
        console.log(`[Server Webhook] SUCCESS: Found user by ID: ${data.id}`);
        return data;
      }
      if (error) console.error(`[Server Webhook] error looking up by ID: ${error.message}`);
    }

    // 2. Priority 2: Stripe Customer ID
    if (customerId) {
      console.log(`[Server Webhook] Attempt 2: Look up by stripe_customer_id ${customerId}`);
      const { data, error } = await supabase.from('profiles').select('id, email, subscription_tier').eq('stripe_customer_id', customerId).maybeSingle();
      if (data) {
        console.log(`[Server Webhook] SUCCESS: Found user by customer ID: ${data.id}`);
        return data;
      }
      if (error) console.error(`[Server Webhook] error looking up by customer ID: ${error.message}`);
    }

    // 3. Priority 3: Email Fallback
    if (email) {
      console.log(`[Server Webhook] Attempt 3: Look up by email ${email}`);
      const { data, error } = await supabase.from('profiles').select('id, email, subscription_tier').eq('email', email).maybeSingle();
      if (data) {
        console.log(`[Server Webhook] SUCCESS: Found user by email: ${data.id}`);
        return data;
      }
      if (error) console.error(`[Server Webhook] error looking up by email: ${error.message}`);
    }

    console.log(`[Server Webhook] FAILED: Could not identify profile.`);
    return null;
  };

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;
        const customerEmail = session.customer_details?.email || session.customer_email || null;
        const userIdMetadata = session.client_reference_id || session.metadata?.userId || session.metadata?.user_id;
        
        console.log(`[Server Webhook] Processing session ${session.id} for user metadata: ${userIdMetadata}`);

        const profile = await findProfile(customerId, customerEmail, userIdMetadata);
        
        if (profile) {
          console.log(`[Server Webhook] Upgrading user ${profile.id} to Pro...`);
          const { error } = await supabase.from('profiles').update({
            stripe_customer_id: customerId,
            subscription_tier: 'pro',
            subscription_status: 'active',
            plan: 'pro',
            stripe_subscription_status: 'active',
            updated_at: new Date().toISOString()
          }).eq('id', profile.id);

          if (error) {
            console.error(`[Server Webhook] UPDATE FAILED for user ${profile.id}: ${error.message}`);
          } else {
            console.log(`[Server Webhook] UPDATE SUCCESS: User ${profile.id} is now Pro.`);
          }
        } else {
          console.error(`[Server Webhook] CRITICAL: Could not resolve profile for checkout session ${session.id}`);
        }
        break;
      }
      
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const customerEmail = invoice.customer_email;
        const subscriptionId = invoice.subscription as string;

        console.log(`[Server Webhook] Processing invoice ${invoice.id} for customer ${customerId}`);

        const profile = await findProfile(customerId, customerEmail);

        if (profile) {
          console.log(`[Server Webhook] Confirming Pro status for user ${profile.id}...`);
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
            console.error(`[Server Webhook] UPDATE FAILED for user ${profile.id} on invoice: ${error.message}`);
          } else {
            console.log(`[Server Webhook] UPDATE SUCCESS: User ${profile.id} Pro status confirmed.`);
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
        
        // Map any "paying" status to pro
        const isPro = status === 'active' || status === 'trialing';
        const tier = isPro ? 'pro' : 'free';

        console.log(`[Server Webhook] Syncing subscription ${subscription.id} status: ${status} for user: ${userIdMetadata}`);

        const profile = await findProfile(customerId, null, userIdMetadata);
        
        if (profile) {
          console.log(`[Server Webhook] Syncing user ${profile.id} to tier ${tier}...`);
          const { error } = await supabase.from('profiles').update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            subscription_tier: tier,
            subscription_status: isPro ? 'active' : 'inactive',
            plan: tier,
            stripe_subscription_status: status,
            updated_at: new Date().toISOString()
          }).eq('id', profile.id);

          if (error) {
            console.error(`[Server Webhook] SYNC FAILED for user ${profile.id}: ${error.message}`);
          } else {
            console.log(`[Server Webhook] SYNC SUCCESS: User ${profile.id} profile synchronized.`);
          }
        }
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        console.log(`[Server Webhook] Rescinding access for deleted subscription ${subscription.id}`);

        const profile = await findProfile(customerId, null);
        
        if (profile) {
          console.log(`[Server Webhook] Reverting user ${profile.id} to Free...`);
          const { error } = await supabase.from('profiles').update({
            subscription_tier: 'free',
            subscription_status: 'canceled',
            plan: 'free',
            stripe_subscription_status: 'canceled',
            updated_at: new Date().toISOString()
          }).eq('id', profile.id);

          if (error) {
            console.error(`[Server Webhook] CANCELLATION FAILED for user ${profile.id}: ${error.message}`);
          } else {
            console.log(`[Server Webhook] CANCELLATION SUCCESS: User ${profile.id} downgraded to free.`);
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
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
  const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID || process.env.ELEVEN_LABS_VOICE_ID || 'vek32IUMncn9S8XIcFt5 (default)';
  res.json({ 
    status: "ok", 
    stripeConfigured: !!getStripe(),
    supabaseConfigured: !!supabase,
    openaiConfigured: !!process.env.OPENAI_API_KEY,
    elevenLabsConfigured: !!elevenLabsKey,
    elevenLabsVoiceId,
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
        temperature: 0.9,
        max_tokens: 200,
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
        temperature: 0.9,
        max_tokens: 200,
      });
      const text = completion.choices[0].message.content || '';
      console.log(`[Chat] Response (${text.length} chars): ${text.substring(0, 80)}…`);
      res.json({ text });
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

// Transcribe audio using OpenAI Whisper
app.post("/api/transcribe", express.raw({ type: '*/*', limit: '25mb' }), async (req: any, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const rawBody: Buffer = req.body;
    if (!rawBody || rawBody.length === 0) {
      return res.status(400).json({ error: 'No audio data received' });
    }

    const contentType = req.headers['content-type'] || 'audio/webm';
    console.log(`[Transcribe] Received ${rawBody.length} bytes, type: ${contentType}`);

    // Determine MIME type and extension
    const mimeType = contentType.split(';')[0].trim();
    const extMap: Record<string, string> = {
      'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4',
      'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/flac': 'flac',
      'video/webm': 'webm',
    };
    const ext = extMap[mimeType] || 'webm';

    const { OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const audioFile = new File([rawBody], `audio.${ext}`, { type: mimeType });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en',
      response_format: 'json',
    });

    const transcript = transcription.text?.trim() || '';
    console.log(`[Transcribe] "${transcript}"`);
    res.json({ transcript });
  } catch (error: any) {
    console.error('[Transcribe] Error:', error.message);
    res.status(500).json({ error: 'Transcription failed', message: error.message });
  }
});

app.post("/api/speech", async (req, res) => {
  const { text } = req.body;

  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      throw new Error("ElevenLabs API Key is not configured.");
    }

    // Use custom David voice ID with env var fallback
    const defaultVoiceId = 'vek32IUMncn9S8XIcFt5'; // Custom David voice (updated)
    const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || process.env.ELEVEN_LABS_VOICE_ID || defaultVoiceId;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?optimize_streaming_latency=3`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.75,
          style: 0.1,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API Error: ${response.status} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (error: any) {
    console.error("[ElevenLabs] Speech error:", error);
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
      console.log(`\n🚀 Server running on http://localhost:${PORT}`);
      console.log(`🌍 NODE_ENV: ${process.env.NODE_ENV}`);
      console.log(`🔗 APP_URL: ${process.env.APP_URL || "not set (defaulting to localhost:3000)"}`);
      
      console.log("\n--- Integration Status ---");
      console.log(`💳 Stripe: ${getStripe() ? "✅ Configured" : "❌ Missing STRIPE_SECRET_KEY"}`);
      console.log(`🗄️ Supabase: ${supabase ? "✅ Configured" : "❌ Missing SUPABASE_URL/SERVICE_ROLE_KEY"}`);
      console.log(`🤖 OpenAI: ${process.env.OPENAI_API_KEY ? "✅ Configured" : "❌ Missing OPENAI_API_KEY"}`);
      console.log(`🎙️ ElevenLabs: ${process.env.ELEVENLABS_API_KEY ? "✅ Configured" : "❌ Missing ELEVENLABS_API_KEY"}`);
      console.log("--------------------------\n");
    });
  }
}

startServer();
