import { createClient } from '@supabase/supabase-js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const getHeader = (headers: Record<string, unknown> | undefined, name: string): string => {
  if (!headers) return '';
  const direct = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(direct) ? String(direct[0] || '') : String(direct || '');
};

const authorized = (req: any): boolean => {
  const expected = process.env.DAVID_MEMORY_WEBHOOK_SECRET?.trim();
  if (!expected) return false;

  const bearer = getHeader(req.headers, 'authorization').replace(/^Bearer\s+/i, '').trim();
  const custom = getHeader(req.headers, 'x-david-memory-secret').trim();
  return bearer === expected || custom === expected;
};

const adminClient = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = adminClient();
  if (!supabase) {
    return res.status(503).json({ error: 'Memory service is not configured' });
  }

  const userId = clean(
    req.method === 'GET' ? req.query?.user_id : req.body?.user_id,
    128,
  );

  if (!userId || userId === 'guest') {
    return res.status(400).json({ error: 'A valid user_id is required' });
  }

  if (req.method === 'GET') {
    const requested = Number(req.query?.limit || DEFAULT_LIMIT);
    const limit = Number.isFinite(requested)
      ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(requested)))
      : DEFAULT_LIMIT;

    const { data, error } = await supabase
      .from('david_conversation_memory')
      .select('id, mood_key, user_message, david_response, verse_used, opening_phrase, follow_up_question, short_summary, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[David Memory Webhook] Read failed:', error.message);
      return res.status(500).json({ error: 'Could not load memories' });
    }

    return res.status(200).json({
      user_id: userId,
      memories: data || [],
    });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const userMessage = clean(body.user_message, 1000);
    const davidResponse = clean(body.david_response, 2000);
    const shortSummary = clean(body.short_summary ?? body.memory ?? body.summary, 700);

    // ElevenLabs may save a concise memory without replaying a full turn.
    // Preserve the existing table shape while allowing either representation.
    if (!userMessage && !davidResponse && !shortSummary) {
      return res.status(400).json({
        error: 'Provide user_message, david_response, or short_summary',
      });
    }

    const { data, error } = await supabase
      .from('david_conversation_memory')
      .insert({
        user_id: userId,
        mood_key: clean(body.mood_key, 80) || null,
        user_message: userMessage || shortSummary || 'Memory saved from David voice conversation',
        david_response: davidResponse || '',
        verse_used: clean(body.verse_used, 240) || null,
        opening_phrase: clean(body.opening_phrase, 220) || null,
        follow_up_question: clean(body.follow_up_question, 260) || null,
        short_summary: shortSummary || null,
      })
      .select('id, created_at')
      .single();

    if (error) {
      console.error('[David Memory Webhook] Save failed:', error.message);
      return res.status(500).json({ error: 'Could not save memory' });
    }

    return res.status(201).json({
      saved: true,
      user_id: userId,
      memory_id: data?.id || null,
      created_at: data?.created_at || null,
    });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
