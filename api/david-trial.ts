import { createClient } from '@supabase/supabase-js';

const TEXT_LIMIT = 25;
const VOICE_SECONDS_LIMIT = 60 * 60;
const OWNER_EMAIL = 'alissasmith.apps@gmail.com';

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
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');

  const token = getBearerToken(req);
  if (!token) return json(res, 401, { code: 'AUTH_REQUIRED', error: 'Please sign in to try David.' });

  try {
    const { auth, service } = clients(token);
    const { data: { user }, error: userError } = await (auth.auth as any).getUser(token);
    if (userError || !user) return json(res, 401, { code: 'AUTH_REQUIRED', error: 'Your sign-in session expired.' });

    const { data: profile } = await service.from('profiles').select('role, subscription_tier, email').eq('id', user.id).maybeSingle();
    const tier = profile?.subscription_tier || 'free';
    const owner = profile?.role === 'owner' || tier === 'owner' || (profile?.email || user.email || '').toLowerCase() === OWNER_EMAIL;
    const paidText = owner || tier === 'plus' || tier === 'pro';
    const paidVoice = owner || tier === 'pro';

    const { data: usage, error: usageError } = await service.from('david_intro_trial_usage').select('text_messages_used, voice_seconds_used').eq('user_id', user.id).maybeSingle();
    if (usageError) throw usageError;
    const textUsed = Number(usage?.text_messages_used || 0);
    let voiceUsed = Number(usage?.voice_seconds_used || 0);

    if (req.method === 'POST' && !paidVoice) {
      const seconds = Math.max(0, Math.min(120, Math.floor(Number(req.body?.voiceSeconds || 0))));
      if (seconds > 0) {
        const { data: rows, error } = await service.rpc('consume_david_intro_voice_seconds', { p_user_id: user.id, p_seconds: seconds });
        if (error) throw error;
        const row = Array.isArray(rows) ? rows[0] : rows;
        voiceUsed = Number(row?.voice_seconds_used ?? voiceUsed);
      }
    }

    return json(res, 200, {
      tier,
      owner,
      text: { paid: paidText, limit: TEXT_LIMIT, used: textUsed, remaining: paidText ? null : Math.max(0, TEXT_LIMIT - textUsed) },
      voice: { paid: paidVoice, limitSeconds: VOICE_SECONDS_LIMIT, usedSeconds: voiceUsed, remainingSeconds: paidVoice ? null : Math.max(0, VOICE_SECONDS_LIMIT - voiceUsed) },
    });
  } catch (error: any) {
    console.error('[David Trial] Failed:', error?.message || error);
    return json(res, 503, { code: 'TRIAL_METER_UNAVAILABLE', error: 'David trial usage is temporarily unavailable.' });
  }
}
