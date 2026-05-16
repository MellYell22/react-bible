import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createServer as createViteServer } from "vite";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { DAVID_PERSONALITY_PROMPT, DAVID_CHAT_TEMPERATURE } from './src/constants/davidPersona';
import { isAlreadyElevenLabsSsml, prepareDavidTtsPayload } from './src/utils/davidSpeechDelivery';
import { resolveDavidVoiceId } from './src/constants/elevenLabsVoice';
import { buildDavidSystemPromptWithMood, resolveMoodKey } from './src/utils/davidMoodContext';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname);

// Prefer .env.local; .env fills in keys not already set (no override)
dotenv.config({ path: path.join(projectRoot, ".env.local") });
dotenv.config({ path: path.join(projectRoot, ".env") });

export const app = express();
const PORT = 3000;

// OpenAI initialization
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  const envVoiceId = process.env.ELEVENLABS_VOICE_ID || process.env.ELEVEN_LABS_VOICE_ID;
  const elevenLabsVoiceId = resolveDavidVoiceId(envVoiceId);
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
  const { messages, stream = false, mood, moodKey, detectedMood, profile } = req.body;
  
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OpenAI API Key is not configured." });
  }

  console.log("OPENAI REQUEST SENT - Chat");

  try {
    const resolvedMoodKey = resolveMoodKey({
      mood,
      moodKey,
      detectedMood,
      profileMood: profile?.mood || profile?.currentMood || profile?.current_mood,
      messages,
    });
    const systemPrompt = buildDavidSystemPromptWithMood(resolvedMoodKey);
    console.log(`[Chat] Mood context: ${resolvedMoodKey || 'none'}`);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true,
        temperature: DAVID_CHAT_TEMPERATURE,
        max_tokens: 120,
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
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        temperature: DAVID_CHAT_TEMPERATURE,
        max_tokens: 120,
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

    let audioBuffer = rawBody;
    let mimeType = contentType.split(';')[0].trim() || 'audio/webm';
    let filename = 'audio.webm';

    if (contentType.includes('multipart/form-data')) {
      const boundary = contentType.split('boundary=')[1]?.trim();
      if (!boundary) {
        return res.status(400).json({ error: 'Missing multipart boundary' });
      }

      const parts = splitBuffer(rawBody, Buffer.from(`--${boundary}`));
      const audioPart = parts.find((part) => {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) return false;
        const headers = part.slice(0, headerEnd).toString();
        return headers.includes('name="audio"') || headers.includes('filename=');
      });

      if (!audioPart) {
        return res.status(400).json({ error: 'No audio file found in request' });
      }

      const headerEnd = audioPart.indexOf('\r\n\r\n');
      const headers = audioPart.slice(0, headerEnd).toString();
      const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
      const filenameMatch = headers.match(/filename="([^"]+)"/i);

      if (contentTypeMatch) mimeType = contentTypeMatch[1].trim().split(';')[0].trim();
      if (filenameMatch) filename = filenameMatch[1];

      audioBuffer = audioPart.slice(headerEnd + 4);
      while (audioBuffer.length > 0 && (audioBuffer[audioBuffer.length - 1] === 10 || audioBuffer[audioBuffer.length - 1] === 13)) {
        audioBuffer = audioBuffer.slice(0, -1);
      }
    }

    console.log(`[Transcribe] Audio file extracted: ${audioBuffer.length} bytes, type: ${mimeType}`);

    const extMap: Record<string, string> = {
      'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4',
      'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/flac': 'flac',
      'audio/x-wav': 'wav', 'audio/m4a': 'm4a',
      'video/webm': 'webm',
    };
    const ext = extMap[mimeType] || 'webm';

    const { OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const safeFilename = filename.includes('.') ? filename : `audio.${ext}`;
    const audioFile = new File([audioBuffer], safeFilename, { type: mimeType });

    const MIN_AUDIO_BYTES = 5000;
    const MIN_MEANINGFUL_WORDS = 2;
    const MIN_MEANINGFUL_LETTERS = 8;
    const junkPatterns = [
      /^[\s.…,!?*-]+$/,
      /^(thank you|thanks for watching|subscribe|you|bye|goodbye|okay|ok|um+|uh+|hmm+|ah+|oh+)[.!?\s]*$/i,
      /^(music|applause|\[silence\]|\[music\]|\[inaudible\])$/i,
      /^(the|a|an|i|it|so|and|but|or|well)[.!?\s]*$/i,
    ];
    const noisePatterns = [
      /^(a+h*|u+h*m*|hmm*|mm+|mhm+|uh+h*|oh+h*)[.!?\s]*$/i,
      /^(cough|coughing|\*cough\*|clears? throat|sniff|sneeze|burp|yawn)[.!?\s]*$/i,
      /^(breathing|inhales?|exhales?|sigh|sighs)[.!?\s]*$/i,
      /^\[.*\]$/,
    ];

    const isMeaningful = (text: string): boolean => {
      const t = text.trim();
      const n = t.toLowerCase();
      if (!t || n.length < 3) return false;
      if (junkPatterns.some(re => re.test(n)) || noisePatterns.some(re => re.test(n))) return false;
      const words = t.split(/\s+/).filter(Boolean);
      if (words.length < MIN_MEANINGFUL_WORDS) return false;
      if (t.replace(/[^a-zA-Z]/g, '').length < MIN_MEANINGFUL_LETTERS) return false;
      return true;
    };

    if (audioBuffer.length < MIN_AUDIO_BYTES) {
      return res.json({ transcript: '', rejected: true, reason: 'audio_too_small' });
    }

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en',
      response_format: 'json',
      prompt: 'Spiritual conversation in English.',
      temperature: 0,
    });

    const rawTranscript = transcription.text?.trim() || '';
    const accepted = isMeaningful(rawTranscript);
    console.log(`[Transcribe] raw="${rawTranscript}" accepted=${accepted}`);
    res.json({
      transcript: accepted ? rawTranscript : '',
      rejected: !accepted,
      reason: accepted ? undefined : 'not_meaningful',
    });
  } catch (error: any) {
    console.error('[Transcribe] Error:', error.message);
    res.status(500).json({ error: 'Transcription failed', message: error.message });
  }
});

app.post("/api/speech", async (req, res) => {
  // LemonFox TTS — replaces ElevenLabs
  // Docs: https://www.lemonfox.ai/apis/text-to-speech
  const { text } = req.body ?? {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    console.warn('[Speech] Missing or empty text parameter');
    return res.status(400).json({ error: 'Missing text parameter' });
  }

  // Strip any SSML tags — LemonFox uses plain text only
  const cleanText = text.trim().replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!cleanText) {
    return res.status(400).json({ error: 'Text was empty after stripping markup' });
  }

  const apiKey = process.env.LEMONFOX_API_KEY;
  if (!apiKey) {
    console.error('[Speech] LEMONFOX_API_KEY is not configured');
    return res.status(500).json({ error: 'LemonFox API key not configured. Add LEMONFOX_API_KEY to environment.' });
  }

  const callLemonFox = (voice: string) =>
    fetch('https://api.lemonfox.ai/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        input: cleanText,
        voice,
        language: 'en-us',
        response_format: 'mp3',
        speed: 0.95,
      }),
    });

  try {
    const attempts = [
      { voice: 'onyx',  label: 'LemonFox/onyx (primary)' },
      { voice: 'eric',  label: 'LemonFox/eric (fallback)' },
    ];

    let lastStatus = 500;
    let lastBody = '';

    for (const attempt of attempts) {
      console.log(`[Speech] Trying ${attempt.label}...`);
      const response = await callLemonFox(attempt.voice);

      if (response.ok) {
        console.log(`[Speech] Success with ${attempt.label}`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.setHeader('Content-Type', 'audio/mpeg');
        return res.send(buffer);
      }

      lastStatus = response.status;
      lastBody = await response.text();
      console.warn(`[Speech] ${attempt.label} failed: HTTP ${lastStatus} — ${lastBody.substring(0, 300)}`);

      if (lastStatus === 401) {
        return res.status(401).json({ error: 'LemonFox API key invalid. Check LEMONFOX_API_KEY.', details: lastBody });
      }
      if (lastStatus === 402 || lastStatus === 429) {
        return res.status(lastStatus).json({ error: 'LemonFox quota or rate limit hit.', details: lastBody });
      }
    }

    return res.status(500).json({ error: 'All LemonFox TTS attempts failed', lastStatus, details: lastBody });
  } catch (error: any) {
    console.error('[Speech] Unexpected error:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Speech generation failed' });
  }
});

function splitBuffer(buf: Buffer, delimiter: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  let idx = buf.indexOf(delimiter, start);

  while (idx !== -1) {
    parts.push(buf.slice(start, idx));
    start = idx + delimiter.length;
    idx = buf.indexOf(delimiter, start);
  }

  parts.push(buf.slice(start));
  return parts.filter((part) => part.length > 2);
}

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
      console.log(`🎙️ LemonFox TTS: ${process.env.LEMONFOX_API_KEY ? "✅ Configured" : "❌ Missing LEMONFOX_API_KEY"}`);
      console.log(`🗣️ David Voice: onyx (LemonFox)`);
      console.log("--------------------------\n");
    });
  }
}

startServer();
