import { createClient } from '@supabase/supabase-js';
import { ENTITLEMENT_COLUMNS, canUsePremium, canUsePro, resolveAccessTier } from '../lib/subscriptionState.js';
import { FREE_VOICE_TRIAL_MESSAGES } from '../lib/chatAccess.js';

const TEXT_LIMIT = 25;

const firstConfigured = (...values: Array<string | undefined>) => values.map(v => v?.trim()).find(Boolean) || '';

const getBearerToken = (req: any) => {
  const raw = req?.headers?.authorization || req?.headers?.Authorization || '';
  const match = typeof raw === 'string' ? raw.match(/^Bearer\s+(.+)$/i) : null;
  return match?.[1]?.trim() || '';
};

const json = (res: any, status: number, body: any) => res.status(status).json(body);

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

export default async function handler(req: any, res: any) {
  // Read-only. The voice trial is spent server-side in lib/chatAccess.ts as
  // each spoken turn happens, so there is nothing for a client to post here.
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
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

    const { data: usage, error: usageError } = await service.from('david_intro_trial_usage').select('text_messages_used, voice_messages_used').eq('user_id', user.id).maybeSingle();
    if (usageError) throw usageError;
    const textUsed = Number(usage?.text_messages_used || 0);
    const voiceUsed = Number(usage?.voice_messages_used || 0);

    return json(res, 200, {
      tier,
      owner,
      text: { paid: paidText, limit: TEXT_LIMIT, used: textUsed, remaining: paidText ? null : Math.max(0, TEXT_LIMIT - textUsed) },
      // Spoken exchanges, not minutes. Spent in lib/chatAccess.ts per turn.
      voice: {
        paid: paidVoice,
        limit: FREE_VOICE_TRIAL_MESSAGES,
        used: voiceUsed,
        remaining: paidVoice ? null : Math.max(0, FREE_VOICE_TRIAL_MESSAGES - voiceUsed),
      },
    });
  } catch (error: any) {
    console.error('[David Trial] Failed:', error?.message || error);
    return json(res, 503, { code: 'TRIAL_METER_UNAVAILABLE', error: 'David trial usage is temporarily unavailable.' });
  }
}
