import { createClient } from '@supabase/supabase-js';
import { ENTITLEMENT_COLUMNS, canUsePremium, canUsePro, resolveAccessTier } from '../lib/subscriptionState.js';
import {
  FREE_VOICE_TRIAL_MESSAGES,
  PRO_VOICE_RPC,
  PRO_VOICE_SECONDS_PER_PERIOD,
  getProVoicePeriodEnd,
  readProVoiceSecondsUsed,
} from '../lib/chatAccess.js';

const TEXT_LIMIT = 25;

const firstConfigured = (...values: Array<string | undefined>) => values.map(v => v?.trim()).find(Boolean) || '';

const getBearerToken = (req: any) => {
  const raw = req?.headers?.authorization || req?.headers?.Authorization || '';
  const match = typeof raw === 'string' ? raw.match(/^Bearer\s+(.+)$/i) : null;
  return match?.[1]?.trim() || '';
};

const json = (res: any, status: number, body: any) => res.status(status).json(body);

const readBody = (req: any): any => {
  const body = req?.body;
  if (!body) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body;
};

const clients = (token: string) => {
  const url = firstConfigured(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL);
  const verifyKey = firstConfigured(process.env.SUPABASE_ANON_KEY, process.env.VITE_SUPABASE_ANON_KEY, process.env.SB_PUBLISHABLE_KEY);
  const serviceKey = firstConfigured(process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SB_SECRET_KEY, process.env.SUPABASE_SECRET_KEY);
  if (!url || !verifyKey || !serviceKey) throw new Error('Trial metering is not configured.');
  return {
    auth: createClient(url, verifyKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } }),
    service: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
};

/** What a Pro account sees about its monthly voice minutes. */
const proVoiceSummary = (usedSeconds: number, periodEnd: string) => {
  const used = Math.min(Math.max(0, usedSeconds), PRO_VOICE_SECONDS_PER_PERIOD);
  const remaining = Math.max(0, PRO_VOICE_SECONDS_PER_PERIOD - used);
  return {
    limitSeconds: PRO_VOICE_SECONDS_PER_PERIOD,
    usedSeconds: used,
    remainingSeconds: remaining,
    resetsAt: periodEnd,
    allowed: remaining > 0,
  };
};

export default async function handler(req: any, res: any) {
  // GET reports what is left.
  // POST spends it:
  //   - free accounts: one spoken reply of the 5-reply trial (empty body);
  //   - Pro accounts: talk time from the Voice screen's heartbeat, sent as
  //     { "proSeconds": n }. The database caps a single call at 60 seconds.
  // The owner account is never metered.
  //
  // The live voice conversation runs inside the ElevenLabs agent, so David's
  // replies never pass through this app's own chat endpoint and cannot be
  // metered there. The Voice screen reports here as the conversation runs.
  // The counts live in the database and are updated under a row lock, so
  // they survive reloads, new sessions and other devices, and cannot be
  // reset by clearing site data.
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');

  const token = getBearerToken(req);
  if (!token) return json(res, 401, { code: 'AUTH_REQUIRED', error: 'Please sign in to try David.' });

  try {
    const { auth, service } = clients(token);
    const { data: { user }, error: userError } = await (auth.auth as any).getUser(token);
    if (userError || !user) return json(res, 401, { code: 'AUTH_REQUIRED', error: 'Your sign-in session expired.' });

    const { data: profile } = await service.from('profiles').select(ENTITLEMENT_COLUMNS).eq('id', user.id).maybeSingle();
    // Verified against the Stripe subscription fields, not the tier label.
    const tier = resolveAccessTier({ profile, userEmail: user.email || null });
    const owner = tier === 'owner';
    const paidText = canUsePremium(tier);
    const paidVoice = canUsePro(tier);
    const meteredPro = tier === 'pro';
    const periodEnd = meteredPro ? getProVoicePeriodEnd(profile) : null;

    if (req.method === 'POST' && meteredPro) {
      // Spend Pro talk time.
      const body = readBody(req);
      const seconds = Math.round(Number(body?.proSeconds ?? 0));
      const spend = Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), 60) : 0;
      const { data: rows, error: consumeError } = await service.rpc(PRO_VOICE_RPC, {
        p_user_id: user.id,
        p_period_end: periodEnd,
        p_seconds: spend,
      });
      if (consumeError) throw consumeError;
      const row: any = Array.isArray(rows) ? rows[0] : rows;
      const usedSeconds = Number(row?.seconds_used ?? PRO_VOICE_SECONDS_PER_PERIOD);
      return json(res, 200, {
        tier,
        owner,
        voice: {
          paid: true,
          pro: proVoiceSummary(usedSeconds, periodEnd as string),
        },
      });
    }

    // Spend one spoken reply of the free trial. Paid voice is never charged here.
    if (req.method === 'POST' && !paidVoice) {
      const { data: rows, error: consumeError } = await service.rpc(
        'consume_david_intro_voice_message',
        { p_user_id: user.id },
      );
      if (consumeError) throw consumeError;
      const row: any = Array.isArray(rows) ? rows[0] : rows;
      const remaining = Number(row?.voice_messages_remaining ?? 0);
      return json(res, 200, {
        tier,
        owner,
        voice: {
          paid: false,
          limit: FREE_VOICE_TRIAL_MESSAGES,
          used: Number(row?.voice_messages_used ?? FREE_VOICE_TRIAL_MESSAGES),
          remaining,
          // False once the trial is gone: the caller must end the conversation.
          allowed: Boolean(row?.allowed),
        },
      });
    }

    const { data: usage, error: usageError } = await service.from('david_intro_trial_usage').select('text_messages_used, voice_messages_used').eq('user_id', user.id).maybeSingle();
    if (usageError) throw usageError;
    const textUsed = Number(usage?.text_messages_used || 0);
    const voiceUsed = Number(usage?.voice_messages_used || 0);

    let pro: ReturnType<typeof proVoiceSummary> | null = null;
    if (meteredPro) {
      const usedSeconds = await readProVoiceSecondsUsed(service as any, user.id, periodEnd as string);
      if (usedSeconds === null) throw new Error('Pro voice usage is unavailable.');
      pro = proVoiceSummary(usedSeconds, periodEnd as string);
    }

    return json(res, 200, {
      tier,
      owner,
      text: { paid: paidText, limit: TEXT_LIMIT, used: textUsed, remaining: paidText ? null : Math.max(0, TEXT_LIMIT - textUsed) },
      voice: {
        paid: paidVoice,
        limit: FREE_VOICE_TRIAL_MESSAGES,
        used: voiceUsed,
        // Free trial: spoken exchanges, spent one at a time by POST above.
        remaining: paidVoice ? null : Math.max(0, FREE_VOICE_TRIAL_MESSAGES - voiceUsed),
        // Pro: minutes this billing period. Null for the owner (unmetered)
        // and for anyone without Pro.
        pro,
      },
    });
  } catch (error: any) {
    console.error('[David Trial] Failed:', error?.message || error);
    return json(res, 503, { code: 'TRIAL_METER_UNAVAILABLE', error: 'David trial usage is temporarily unavailable.' });
  }
}
