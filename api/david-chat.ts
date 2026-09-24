import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { DAVID_PERSONA, DAVID_NO_FABRICATION_RULE } from '../src/constants/persona.js';
import { DAVID_SELF_INTRODUCTION_RULE, normalizeDavidSelfIntroduction } from '../src/utils/davidIdentity.js';
import { detectConversationOpening } from '../src/utils/conversationOpening.mjs';
import { buildOpeningRules } from '../src/utils/davidOpeningRules.mjs';
import { detectDavidFlowStage, shapeDavidReply } from '../src/utils/davidConversationFlow.mjs';
import {
  buildContinuityBriefing,
  summarizeTurn,
  toRecentTranscript,
} from '../src/utils/davidContinuity.mjs';

const FREE_DAILY_LIMIT = 5;

/**
 * How far back David actually remembers. The full window feeds the continuity
 * briefing (what keeps coming back, what he already said); only the newest few
 * turns are replayed verbatim, which keeps the thread coherent without paying
 * for the whole history on every request.
 */
const MEMORY_WINDOW = 24;
const VERBATIM_TURNS = 8;
/** Turns newer than this belong to the conversation the person is in right now. */
const CURRENT_SITTING_MS = 45 * 60 * 1000;

const VOICE_ADDENDUM = `

VOICE MODE: This response will be spoken aloud. Keep it especially short, smooth, and natural. One or two complete spoken sentences with normal punctuation, no filler sounds, no stage directions, no strings of ellipses.`;

const buildSystemPrompt = (options: {
  continuity: string;
  mode: 'chat' | 'voice';
  opening: 'greeting' | 'small-talk' | 'low-signal' | null;
  stage: 'feeling-only' | 'ready-for-scripture' | 'after-scripture' | 'general';
  latestUserText: string;
  isReturning: boolean;
}): string => {
  const { continuity, mode, opening, stage, latestUserText, isReturning } = options;

  const turnRules = `
THIS TURN:
- Answer only what they actually just said: "${latestUserText.replace(/"/g, "'").slice(0, 400)}"
- Continue naturally from it. ${isReturning ? 'Do NOT restart the conversation or open with a fresh greeting — you are already in this with them.' : ''}
- Never mention, recommend, or offer videos, clips, or external media unless they explicitly ask for it.
- Never say "As an AI", and never mention memory, records, history, logs, or "our previous conversation" as a system. You simply remember them, the way a friend does.
- What you remember about them is ONLY what appears above in the continuity notes and in this conversation. That is the complete list. If a detail is not there, you do not know it — do not supply it, and do not imply you know more than you do.`;

  return [
    DAVID_PERSONA,
    DAVID_SELF_INTRODUCTION_RULE,
    continuity,
    turnRules,
    // Opening turns get the light-touch rules; every other turn gets the
    // rules for where this conversation actually is (friend first, then one
    // verse once David knows what happened, then plain conversation).
    buildOpeningRules(opening, { stage }),
    mode === 'voice' ? VOICE_ADDENDUM : '',
    // Last position on purpose: this is the rule that must survive everything
    // above it, and recency is the cheapest way to buy that.
    DAVID_NO_FABRICATION_RULE,
  ]
    .filter(Boolean)
    .join('\n\n');
};

/**
 * Same shape guarantee every David surface gets: plain sentences, at most one
 * question, no ramble. Then the identity normalizer so he only ever calls
 * himself David.
 */
const cleanReply = (text: string): string => {
  const value = shapeDavidReply(text, { maxSentences: 4 });
  if (!value) return '';
  return normalizeDavidSelfIntroduction(value);
};

const getBearerToken = (authorization: unknown): string | null => {
  if (typeof authorization !== 'string') return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

/** Only a real, human-looking first name — never an email or an id fragment. */
const cleanFirstName = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('@') || trimmed.length > 40 || /\d/.test(trimmed)) return '';
  const first = trimmed.split(/\s+/)[0];
  return first.length > 1 && first.length <= 20 ? first : '';
};

const getSupabaseUserClient = (accessToken: string) => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_ANON_KEY
    || process.env.SB_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase server configuration is missing.');
  }

  return createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'no-store');

  const accessToken = getBearerToken(req.headers?.authorization);
  if (!accessToken) {
    return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Please sign in again.' });
  }

  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const mood = typeof req.body?.mood === 'string' ? req.body.mood.trim() : '';
  const mode = req.body?.mode === 'voice' ? 'voice' : 'chat';

  // A single character ("k", "?") is still a real turn — only empty or
  // oversized messages are refused.
  if (!message || message.length > 4000) {
    return res.status(400).json({ error: 'Invalid message', ignored: true });
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('[David Chat] OPENAI_API_KEY is missing in Vercel.');
    return res.status(503).json({
      code: 'AI_NOT_CONFIGURED',
      error: 'David is temporarily unavailable. Please try again shortly.',
    });
  }

  try {
    const supabase = getSupabaseUserClient(accessToken);
    const authClient: any = supabase.auth;
    const { data: { user }, error: userError } = await authClient.getUser(accessToken);
    if (userError || !user) {
      return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Your sign-in session expired. Please sign in again.' });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier, role')
      .eq('id', user.id)
      .maybeSingle();

    const isOwner = profile?.role === 'owner' || profile?.subscription_tier === 'owner';
    const isPremium = isOwner
      || profile?.subscription_tier === 'plus'
      || profile?.subscription_tier === 'pro';

    if (!isPremium) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      const { count, error: usageCountError } = await supabase
        .from('daily_feature_usage')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('feature', 'chat')
        .gte('created_at', startOfDay.toISOString());

      if (usageCountError) {
        console.error('[David Chat] Could not read daily usage:', usageCountError.message);
      }

      if ((count ?? 0) >= FREE_DAILY_LIMIT) {
        return res.status(429).json({
          limitReached: true,
          code: 'DAILY_LIMIT_REACHED',
          feature: 'chat',
          limit: FREE_DAILY_LIMIT,
        });
      }
    }

    // ---- memory ----
    // Newest first. The whole window shapes the briefing; only the newest few
    // turns get replayed to the model verbatim.
    const { data: history, error: historyError } = await supabase
      .from('david_conversation_memory')
      .select('user_message, david_response, verse_used, opening_phrase, short_summary, mood_key, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(MEMORY_WINDOW);

    if (historyError) {
      console.error('[David Chat] Memory read failed:', historyError.message);
    }

    // A memory failure must never cost the user their conversation — David
    // simply meets them fresh instead of erroring out.
    const rows = Array.isArray(history) ? history : [];
    const isReturning = rows.length > 0;

    const firstName =
      cleanFirstName(user.user_metadata?.first_name)
      || cleanFirstName(user.user_metadata?.full_name)
      || cleanFirstName(user.user_metadata?.name);

    const priorUserTexts = rows.map((row: any) => row?.user_message).filter(Boolean);
    const opening = detectConversationOpening(message, priorUserTexts);

    const continuity = buildContinuityBriefing(rows, { now: new Date(), firstName });

    // Only turns from this sitting decide the Scripture stage. A verse David
    // gave last week must not stop him from meeting a fresh situation today.
    const sittingCutoff = Date.now() - CURRENT_SITTING_MS;
    const sittingRows = rows.filter((row: any) => {
      const at = new Date(row?.created_at || 0).getTime();
      return Number.isFinite(at) && at >= sittingCutoff;
    });
    const stage = opening
      ? 'general'
      : detectDavidFlowStage([
        ...(toRecentTranscript(sittingRows, VERBATIM_TURNS) as Array<{ role: 'user' | 'assistant'; content: string }>),
        { role: 'user', content: message },
      ]);

    const systemPrompt = buildSystemPrompt({
      continuity,
      mode,
      opening,
      stage,
      latestUserText: message,
      isReturning,
    });

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...(toRecentTranscript(rows, VERBATIM_TURNS) as Array<{ role: 'user' | 'assistant'; content: string }>),
    ];

    // A mood the user picked is context, not an instruction to preach at it.
    const moodNote = mood && !opening ? ` (Context only: they tagged today as ${mood}. Do not lead with it.)` : '';
    messages.push({ role: 'user', content: message + moodNote });

    console.log('[David Chat] Turn context:', {
      mode,
      opening: opening || null,
      stage,
      historyRows: rows.length,
      isReturning,
      hasFirstName: Boolean(firstName),
      systemPromptLength: systemPrompt.length,
    });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const configuredModel = process.env.OPENAI_MODEL?.trim();
    const model = configuredModel || 'gpt-4.1-mini';

    // Higher temperature plus strong presence/frequency penalties is what keeps
    // David from settling into one groove across sessions.
    const completionOptions = {
      messages,
      max_tokens: mode === 'voice' ? 160 : 300,
      temperature: 0.9,
      top_p: 0.95,
      presence_penalty: 0.75,
      frequency_penalty: 0.6,
    };

    let completion;
    try {
      completion = await openai.chat.completions.create({ model, ...completionOptions });
    } catch (primaryError: any) {
      const status = Number(primaryError?.status || 0);
      const code = String(primaryError?.code || primaryError?.error?.code || '');
      const shouldTryKnownModel = Boolean(configuredModel)
        && (status === 404 || code.includes('model'))
        && configuredModel !== 'gpt-4.1-mini';

      if (!shouldTryKnownModel) throw primaryError;

      console.warn(`[David Chat] Configured model ${configuredModel} failed; retrying with gpt-4.1-mini.`);
      completion = await openai.chat.completions.create({ model: 'gpt-4.1-mini', ...completionOptions });
    }

    const rawReply = completion.choices[0]?.message?.content?.trim() || '';
    const reply = cleanReply(rawReply) || 'Sorry, I lost you for a second. Say that again?';

    // Persist the turn WITH its metadata. These columns already existed but
    // nothing filled them, which is why David kept reusing the same openings
    // and the same verses day after day.
    const turnMetadata = summarizeTurn(message, reply);
    const { error: memoryInsertError } = await supabase
      .from('david_conversation_memory')
      .insert({
        user_id: user.id,
        mood_key: mood || null,
        user_message: message,
        david_response: reply,
        verse_used: turnMetadata.verseUsed,
        opening_phrase: turnMetadata.openingPhrase,
        short_summary: turnMetadata.shortSummary,
      });

    if (memoryInsertError) {
      console.error('[David Chat] Memory insert failed:', memoryInsertError.message);
    }

    if (!isPremium) {
      const { error: usageInsertError } = await supabase
        .from('daily_feature_usage')
        .insert({ user_id: user.id, feature: 'chat' });

      if (usageInsertError) {
        console.error('[David Chat] Usage insert failed:', usageInsertError.message);
      }
    }

    return res.status(200).json({ reply });
  } catch (error: any) {
    const status = Number(error?.status || 0);
    const providerCode = String(error?.code || error?.error?.code || '');
    console.error('[David Chat] Request failed:', {
      status: status || null,
      code: providerCode || null,
      message: error?.message || String(error),
    });

    if (status === 401 || providerCode === 'invalid_api_key') {
      return res.status(503).json({
        code: 'AI_CREDENTIAL_ERROR',
        error: 'David is temporarily unavailable. Please try again shortly.',
      });
    }

    if (status === 429) {
      return res.status(503).json({
        code: 'AI_RATE_LIMITED',
        error: 'David is busy for a moment. Please try again shortly.',
      });
    }

    return res.status(503).json({
      code: 'AI_PROVIDER_UNAVAILABLE',
      error: 'David is temporarily unavailable. Please try again shortly.',
    });
  }
}
