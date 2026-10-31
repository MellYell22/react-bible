import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ENTITLEMENT_COLUMNS,
  canUsePremium,
  canUsePro,
  resolveAccessTier,
} from './subscriptionState.js';

/**
 * Server-side entitlement gate for `/api/chat`.
 *
 * The app's own UI only reaches this endpoint from VoiceScreen, always with
 * `liveVoice: true` — text chat goes through the `david-chat` Supabase edge
 * function instead, which has its own separate limit in api/david-chat.ts.
 * `liveVoice` requests are resolved by the premium check, then by the free
 * voice intro trial (the same 60 minutes the Voice screen shows, metered by
 * api/david-trial.ts), and only then by the Pro-only denial. That means the
 * `under-limit` / `denied` text counting path below is never exercised by
 * the app today.
 *
 * It stays in place anyway. `/api/chat` is a public HTTP endpoint — anyone
 * can POST to it directly with `liveVoice: false` or omitted, bypassing the
 * UI entirely — so this is the backstop for that request shape, and for any
 * future caller that sends it. Counting matches the edge function: one row
 * per completed exchange in `david_conversation_memory`, counted from UTC
 * midnight.
 */

export const FREE_DAILY_MESSAGE_LIMIT = 5;

/**
 * One-time free trial of David's spoken voice, in seconds. Must match
 * VOICE_SECONDS_LIMIT in api/david-trial.ts and the check constraint on
 * `david_intro_trial_usage.voice_seconds_used`.
 */
export const FREE_VOICE_TRIAL_SECONDS = 60 * 60;

const USAGE_TABLE = 'david_conversation_memory';
const VOICE_TRIAL_TABLE = 'david_intro_trial_usage';

export type ChatAccessDenialBody = {
  error: string;
  message: string;
  limitReached?: boolean;
  limit?: number;
  used?: number;
  tier?: string | null;
};

/**
 * Deliberately one flat shape rather than a discriminated union: this project
 * does not compile with `strict`, so narrowing on `allowed` is not reliable at
 * the call site. `status` and `body` are set only when `allowed` is false.
 */
export type ChatAccessResult = {
  allowed: boolean;
  reason: 'premium' | 'voice-trial' | 'under-limit' | 'unidentified' | 'billing-not-configured' | 'denied';
  tier: string | null;
  used: number | null;
  limit: number | null;
  status?: number;
  body?: ChatAccessDenialBody;
};

const firstConfigured = (...candidates: Array<string | undefined>): string => {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return '';
};

const getSupabaseUrl = (): string => firstConfigured(
  process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_URL,
);

/** Key used only to verify the caller's JWT. Never used to write. */
const getVerifyKey = (): string => firstConfigured(
  process.env.SUPABASE_ANON_KEY,
  process.env.VITE_SUPABASE_ANON_KEY,
  process.env.SB_PUBLISHABLE_KEY,
  process.env.SUPABASE_PUBLISHABLE_KEY,
);

/** Optional. When present, usage counting bypasses RLS and is more robust. */
const getServiceKey = (): string => firstConfigured(
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.SB_SECRET_KEY,
  process.env.SUPABASE_SECRET_KEY,
);

export const getBearerToken = (req: any): string => {
  const headers = req?.headers || {};
  const raw = headers.authorization || headers.Authorization || '';
  if (typeof raw !== 'string') return '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const startOfUtcDayIso = (): string => {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
};

const countTodaysMessages = async (
  client: SupabaseClient,
  userId: string,
): Promise<number | null> => {
  const { count, error } = await client
    .from(USAGE_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startOfUtcDayIso());

  if (error) {
    console.warn('[ChatAccess] Usage count failed:', error.message);
    return null;
  }
  return count ?? 0;
};

/**
 * Seconds of the free voice trial this person has already used. No row yet
 * means they have not started the trial, so 0. Returns null only when the
 * lookup itself fails.
 */
const getVoiceTrialSecondsUsed = async (
  client: SupabaseClient,
  userId: string,
): Promise<number | null> => {
  const { data, error } = await client
    .from(VOICE_TRIAL_TABLE)
    .select('voice_seconds_used')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[ChatAccess] Voice trial lookup failed:', error.message);
    return null;
  }

  const used = Number((data as any)?.voice_seconds_used ?? 0);
  return Number.isFinite(used) && used > 0 ? used : 0;
};

const allow = (
  reason: ChatAccessResult['reason'],
  tier: string | null = null,
  used: number | null = null,
  limit: number | null = null,
): ChatAccessResult => ({ allowed: true, reason, tier, used, limit });

const deny = (status: number, body: ChatAccessDenialBody): ChatAccessResult => ({
  allowed: false,
  reason: 'denied',
  tier: body.tier ?? null,
  used: body.used ?? null,
  limit: body.limit ?? null,
  status,
  body,
});

/**
 * Decides whether this request may talk to David.
 *
 * Fails open only when Supabase is not configured at all — a misconfigured
 * deploy should not take chat down. Every other path is decided on real data.
 */
export const checkChatAccess = async (
  req: any,
  options: { liveVoice?: boolean } = {},
): Promise<ChatAccessResult> => {
  const supabaseUrl = getSupabaseUrl();
  const verifyKey = getVerifyKey();

  if (!supabaseUrl || !verifyKey) {
    console.warn('[ChatAccess] Supabase is not configured; skipping entitlement check.');
    return allow('billing-not-configured');
  }

  const token = getBearerToken(req);
  if (!token) {
    // Guest sessions are fabricated client-side and carry no JWT. They are
    // still capped in the UI; there is no server identity to meter here.
    return allow('unidentified');
  }

  const authClient = createClient(supabaseUrl, verifyKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user } = { user: null }, error: userError } = await (authClient.auth as any).getUser(token);

  if (userError || !user) {
    return deny(401, {
      error: 'Unauthorized',
      message: 'Your sign-in session expired. Please sign in again to keep talking with David.',
    });
  }

  const { data: profile, error: profileError } = await authClient
    .from('profiles')
    .select(ENTITLEMENT_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    console.warn('[ChatAccess] Profile lookup failed:', profileError.message);
  }

  // Never trust the cached tier label: it must be backed by a current Stripe
  // subscription. A stale "pro" row is treated as free.
  const tier = resolveAccessTier({ profile, userEmail: user.email || null });

  // Live voice is a Pro feature. Plus covers unlimited text only. The Voice
  // screen gates this in the UI; this closes the hole on the server so the
  // flag cannot be forged.
  if (options.liveVoice ? canUsePro(tier) : canUsePremium(tier)) {
    return allow('premium', tier, null, null);
  }

  const serviceKey = getServiceKey();
  const usageClient = serviceKey
    ? createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    : authClient;

  if (options.liveVoice) {
    // Every account without Pro gets a one-time intro trial of David's voice.
    // The Voice screen shows that trial and reports elapsed seconds to
    // api/david-trial.ts. This gate must honor the same trial — otherwise the
    // screen lets someone start talking and the server refuses every turn.
    const trialUsed = await getVoiceTrialSecondsUsed(usageClient, user.id);

    // Same rule as the text counter below: a failed lookup must not lock out
    // someone the Voice screen says still has time. Allow the turn and log
    // it — the next turn re-checks.
    if (trialUsed === null) {
      return allow('voice-trial', tier, null, FREE_VOICE_TRIAL_SECONDS);
    }

    if (trialUsed < FREE_VOICE_TRIAL_SECONDS) {
      return allow('voice-trial', tier, trialUsed, FREE_VOICE_TRIAL_SECONDS);
    }

    return deny(402, {
      error: 'Upgrade required',
      message: 'Your free David voice time is used up. Upgrade to Pro to keep talking.',
      limitReached: true,
      tier,
    });
  }

  const used = await countTodaysMessages(usageClient, user.id);

  // A failed count must not silently unlock unlimited chat, but it also must
  // not lock out a paying-eligible user on a transient database blip. Allow
  // the turn and log it — the next turn re-checks.
  if (used === null) return allow('under-limit', tier, null, FREE_DAILY_MESSAGE_LIMIT);

  if (used >= FREE_DAILY_MESSAGE_LIMIT) {
    return deny(402, {
      error: 'Daily limit reached',
      message: "You've reached today's free conversations with David.",
      limitReached: true,
      limit: FREE_DAILY_MESSAGE_LIMIT,
      used,
      tier,
    });
  }

  return allow('under-limit', tier, used, FREE_DAILY_MESSAGE_LIMIT);
};

/**
 * Gate for paid-cost endpoints (voice audio, transcription): the caller must
 * be a signed-in account. Returns null when allowed. Fails open only when Supabase is not configured,
 * matching checkChatAccess.
 */
export const requireSignedInUser = async (
  req: any,
): Promise<{ status: number; error: string } | null> => {
  const supabaseUrl = getSupabaseUrl();
  const verifyKey = getVerifyKey();
  if (!supabaseUrl || !verifyKey) return null;

  const token = getBearerToken(req);
  if (!token) return { status: 401, error: 'Please sign in to use David\'s voice.' };

  const authClient = createClient(supabaseUrl, verifyKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } = { user: null }, error } = await (authClient.auth as any).getUser(token);
  if (error || !user) return { status: 401, error: 'Your sign-in session expired. Please sign in again.' };
  return null;
};
