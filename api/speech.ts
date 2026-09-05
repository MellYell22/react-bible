import { Readable } from 'stream';

const DAVID_ELEVENLABS_VOICE_ID = 'ewxUvnyvvOehYjKjUVKC';
const ELEVENLABS_TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

// Live voice stays on a low-latency model suitable for conversation.
const FAST_ELEVENLABS_MODELS = new Set([
  'eleven_flash_v2_5',
  'eleven_flash_v2',
  'eleven_turbo_v2_5',
  'eleven_turbo_v2',
]);
const DEFAULT_ELEVENLABS_MODEL = 'eleven_flash_v2_5';
const requestedModel = (process.env.ELEVENLABS_MODEL || '').trim();
const FALLBACK_ELEVENLABS_MODEL = FAST_ELEVENLABS_MODELS.has(requestedModel)
  ? requestedModel
  : DEFAULT_ELEVENLABS_MODEL;

// Prefer ElevenLabs v3 (most expressive) and fall back to the low-latency model
// when v3 is unavailable for this account/voice. An explicit fast-model override
// is honored as the single model (no v3 attempt) to preserve existing behavior.
const ELEVENLABS_MODEL_CANDIDATES = FAST_ELEVENLABS_MODELS.has(requestedModel)
  ? [requestedModel]
  : ['eleven_v3', FALLBACK_ELEVENLABS_MODEL];
// Kept for logging/diagnostics compatibility.
const ELEVENLABS_MODEL = ELEVENLABS_MODEL_CANDIDATES[0];

if (requestedModel && !FAST_ELEVENLABS_MODELS.has(requestedModel)) {
  console.warn(
    `[Speech] Ignoring ELEVENLABS_MODEL="${requestedModel}" — not a fast live-voice model. Using v3 with ${DEFAULT_ELEVENLABS_MODEL} fallback.`,
  );
}

/**
 * David's voice is a product decision, not environment config, so the code is
 * the single source of truth for it.
 *
 * It used to read `process.env.ELEVENLABS_VOICE_ID || DAVID_ELEVENLABS_VOICE_ID`,
 * which meant a stale env var in the hosting dashboard silently outranked every
 * change made here. That is exactly what happened: the constant below was
 * updated to the new voice, the deploy went green, and production kept speaking
 * in the old stock voice because the env var still pointed at it. Nothing
 * errored, so nothing surfaced.
 *
 * The env var is still read, but only to warn when it disagrees — the same
 * shape already used for ELEVENLABS_MODEL and ELEVENLABS_OUTPUT_FORMAT above.
 */
const requestedVoiceId = (process.env.ELEVENLABS_VOICE_ID || '').trim();
if (requestedVoiceId && requestedVoiceId !== DAVID_ELEVENLABS_VOICE_ID) {
  console.warn(
    `[Speech] Ignoring ELEVENLABS_VOICE_ID="${requestedVoiceId}" — David's voice is pinned in code to ${DAVID_ELEVENLABS_VOICE_ID}. Remove or update that environment variable to silence this.`,
  );
}

const FAST_OUTPUT_FORMATS = new Set([
  'mp3_22050_32',
  'mp3_44100_32',
  'mp3_44100_64',
  'mp3_44100_96',
]);
// 44.1kHz / 64kbps stays lightweight for live web playback while avoiding the
// thin, telephone-like quality of the smallest format.
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_64';
const requestedOutputFormat = (process.env.ELEVENLABS_OUTPUT_FORMAT || '').trim();
const ELEVENLABS_OUTPUT_FORMAT = FAST_OUTPUT_FORMATS.has(requestedOutputFormat)
  ? requestedOutputFormat
  : DEFAULT_OUTPUT_FORMAT;

if (requestedOutputFormat && ELEVENLABS_OUTPUT_FORMAT !== requestedOutputFormat) {
  console.warn(
    `[Speech] Ignoring ELEVENLABS_OUTPUT_FORMAT="${requestedOutputFormat}" — not a lightweight web format. Using ${DEFAULT_OUTPUT_FORMAT}.`,
  );
}

import { sanitizeForDavidSpeech } from '../src/utils/davidSpeechDelivery.js';

function previewLogText(value: string, maxLength = 180): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanTranscript(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  if (!text?.trim()) {
    return res.status(400).json({ error: 'Missing text' });
  }

  const cleanText = sanitizeForDavidSpeech(cleanTranscript(text));

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      code: 'voice_not_configured',
      error: 'David voice audio is not configured yet.',
      message: 'Add ELEVENLABS_API_KEY to the server environment to enable spoken audio.',
    });
  }

  const voiceId = DAVID_ELEVENLABS_VOICE_ID;

  const voiceSettings = {
    // David should sound like someone sitting beside the user, not an
    // announcer. Slow the cadence, keep enough variation to avoid a robotic
    // read, and disable speaker boost so the source audio is not pushed.
    stability: 0.62,
    similarity_boost: 0.86,
    speed: 0.80,
    style: 0.0,
    use_speaker_boost: false,
  };

  try {
    // Stream endpoint so playback can begin as chunks arrive.
    const speechUrl = `${ELEVENLABS_TTS_URL}/${voiceId}/stream?output_format=${encodeURIComponent(
      ELEVENLABS_OUTPUT_FORMAT,
    )}`;

    let response: Response | null = null;
    let usedModel = '';
    let lastErrorText = '';
    let lastStatus = 502;

    for (const model of ELEVENLABS_MODEL_CANDIDATES) {
      console.log('[API Request] ElevenLabs text-to-speech (streaming)', {
        url: speechUrl,
        voiceId,
        model,
        outputFormat: ELEVENLABS_OUTPUT_FORMAT,
        textLength: cleanText.length,
        textPreview: previewLogText(cleanText),
        voiceSettings,
      });

      const attempt = await fetch(speechUrl, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({ text: cleanText, model_id: model, voice_settings: voiceSettings }),
      });

      if (attempt.ok) {
        response = attempt;
        usedModel = model;
        break;
      }

      lastStatus = attempt.status;
      lastErrorText = await attempt.text();
      console.error(`[Speech] ElevenLabs model "${model}" failed: HTTP ${attempt.status} — ${lastErrorText.substring(0, 300)}`);
      // Fall through to the next candidate only on model-availability style errors.
      if (attempt.status !== 400 && attempt.status !== 404 && attempt.status !== 422) {
        break;
      }
    }

    if (!response || !response.ok || !response.body) {
      console.error('[API Response] ElevenLabs text-to-speech', {
        ok: false,
        status: lastStatus,
        responseBodyPreview: lastErrorText.substring(0, 1000),
      });
      return res.status(lastStatus).json({
        error: `ElevenLabs failed (${lastStatus})`,
        details: lastErrorText,
      });
    }

    console.log('[API Response] ElevenLabs text-to-speech (streaming)', {
      ok: true,
      status: response.status,
      model: usedModel,
      contentType: response.headers.get('content-type'),
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-David-Voice-Model', usedModel);

    const nodeStream = Readable.fromWeb(response.body as any);
    nodeStream.on('error', (err: any) => {
      console.error('[Speech] Stream piping error:', err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'ElevenLabs stream failed' });
      } else {
        res.end();
      }
    });
    return nodeStream.pipe(res);
  } catch (error: any) {
    console.error('[Speech] ElevenLabs request failed', {
      errorMessage: error?.message || String(error),
      errorStack: error?.stack || null,
      request: {
        voiceId,
        model: ELEVENLABS_MODEL,
        outputFormat: ELEVENLABS_OUTPUT_FORMAT,
        text: cleanText,
      },
      apiKeyPresent: !!process.env.ELEVENLABS_API_KEY,
    });

    return res.status(500).json({
      error: 'TTS failed',
      details: error?.message || String(error),
      request: {
        voiceId,
        model: ELEVENLABS_MODEL,
        outputFormat: ELEVENLABS_OUTPUT_FORMAT,
        textPreview: cleanText.substring(0, 1000),
      },
    });
  }
}
