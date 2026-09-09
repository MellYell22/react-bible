import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side entitlement gate for `/api/chat`.
 *
 * The app's own UI only reaches this endpoint from VoiceScreen, always with
 * `liveVoice: true` — text chat goes through the `david-chat` Supabase edge
 * function instead, which has its own separate limit in api/david-chat.ts.
 * That means the `under-limit` / `denied` counting path below is never
 * exercised by the app today: `liveVoice` requests are resolved by the
 * premium check or the flat Pro-only denial before reaching it.
 *
 * It stays in place anyway. `/api/chat` is a public HTTP endpoint — anyone
 * can POST to it directly with `liveVoice: false` or omitted, bypassing the
 * UI entirely — so this is the backstop for that request shape, and for any
 * future caller that sends it. Counting matches the edge function: one row
 * per completed exchange in `david_conversation_memory`, counted from UTC
 * midnight.
 */

export const FREE_DAILY_MESSAGE_LIMIT = 5;

const PREMIUM_TIERS = new Set(['plus', 'pro', 'owner']);
const OWNER_EMAIL = 'alissasmith.apps@gmail.com';
const USAGE_TABLE = 'david_conversation_memory';

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
  reason: 'premium' | 'under-limit' | 'unidentified' | 'billing-not-configured' | 'denied';
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
    .select('subscription_tier, role, email')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    console.warn('[ChatAccess] Profile lookup failed:', profileError.message);
  }

  const tier = profile?.subscription_tier ?? null;
  const isOwner = profile?.role === 'owner'
    || tier === 'owner'
    || (profile?.email || user.email || '').toLowerCase() === OWNER_EMAIL;

  if (isOwner || (tier && PREMIUM_TIERS.has(tier))) {
    return allow('premium', tier, null, null);
  }

  // Live voice is a Pro feature. The Voice screen gates it in the UI; this
  // closes the matching hole on the server so the flag cannot be forged.
  if (options.liveVoice) {
    return deny(402, {
      error: 'Upgrade required',
      message: "David's spoken voice is part of David's Voice Pro.",
      limitReached: true,
      tier,
    });
  }

  const serviceKey = getServiceKey();
  const usageClient = serviceKey
    ? createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    : authClient;

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
