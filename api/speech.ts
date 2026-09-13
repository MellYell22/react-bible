import { Readable } from 'node:stream';
import { sanitizeForDavidSpeech } from '../src/utils/davidSpeechDelivery.js';
import {
  DAVID_DEFAULT_MODEL,
  DAVID_DEFAULT_OUTPUT_FORMAT,
  DAVID_FAST_MODELS,
  DAVID_FAST_OUTPUT_FORMATS,
  DAVID_VOICE_SETTINGS,
} from '../src/utils/davidVoiceSettings.js';

const DAVID_ELEVENLABS_VOICE_ID = 'ewxUvnyvvOehYjKjUVKC';
const ELEVENLABS_TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

// An env var can pick between fast models, but it can never silently
// downgrade David to a slow one.
const requestedModel = (process.env.ELEVENLABS_MODEL || '').trim();
const ELEVENLABS_MODEL = DAVID_FAST_MODELS.has(requestedModel)
  ? requestedModel
  : DAVID_DEFAULT_MODEL;
if (requestedModel && ELEVENLABS_MODEL !== requestedModel) {
  console.warn(`[Speech] Ignoring ELEVENLABS_MODEL="${requestedModel}" — not a fast live-voice model. Using ${DAVID_DEFAULT_MODEL}.`);
}

const requestedOutputFormat = (process.env.ELEVENLABS_OUTPUT_FORMAT || '').trim();
const ELEVENLABS_OUTPUT_FORMAT = DAVID_FAST_OUTPUT_FORMATS.has(requestedOutputFormat)
  ? requestedOutputFormat
  : DAVID_DEFAULT_OUTPUT_FORMAT;
if (requestedOutputFormat && ELEVENLABS_OUTPUT_FORMAT !== requestedOutputFormat) {
  console.warn(`[Speech] Ignoring ELEVENLABS_OUTPUT_FORMAT="${requestedOutputFormat}" — not a lightweight web format. Using ${DAVID_DEFAULT_OUTPUT_FORMAT}.`);
}

function previewLogText(value: string, maxLength = 180): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanTranscript(text: string): string {
  return text
    .replace(/``` *?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  if (!text?.trim()) {
    return res.status(400).json({ error: 'Missing text' });
  }

  // The client already runs every reply through prepareDavidTtsPayload().
  // sanitizeForDavidSpeech() is the correct final-stage pass: safe on prepared
  // text, strips the ellipses that make ElevenLabs insert long breathing
  // pauses, and never cuts his reply short.
  let cleanText = cleanTranscript(text);
  cleanText = sanitizeForDavidSpeech(cleanText);

  if (!cleanText) {
    return res.status(400).json({ error: 'Missing text' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      code: 'voice_not_configured',
      error: 'David voice audio is not configured yet.',
      message: 'Add ELEVENLABS_API_KEY to the server environment to enable spoken audio.',
    });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DAVID_ELEVENLABS_VOICE_ID;

  // STREAMING ENDPOINT. The previous version called the non-streaming URL and
  // buffered the entire mp3 before sending a single byte, so the client's
  // MediaSource streaming path never actually streamed in production — users
  // sat in silence until the whole clip had been generated. This mirrors the
  // local dev server: ElevenLabs bytes are piped straight through as they
  // arrive, so David starts talking after the first chunk, not the last.
  const speechUrl = `${ELEVENLABS_TTS_URL}/${voiceId}/stream?output_format=${encodeURIComponent(ELEVENLABS_OUTPUT_FORMAT)}`;

  const requestPayload = {
    text: cleanText,
    model_id: ELEVENLABS_MODEL,
    voice_settings: DAVID_VOICE_SETTINGS,
  };

  try {
    console.log('[API Request] ElevenLabs text-to-speech (streaming)', {
      url: speechUrl,
      voiceId,
      model: ELEVENLABS_MODEL,
      outputFormat: ELEVENLABS_OUTPUT_FORMAT,
      textLength: cleanText.length,
      textPreview: previewLogText(cleanText),
      voiceSettings: DAVID_VOICE_SETTINGS,
    });

    const response = await fetch(speechUrl, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      console.error('[API Response] ElevenLabs text-to-speech', {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        responseBodyPreview: errorText.substring(0, 1000),
        request: {
          voiceId,
          model: ELEVENLABS_MODEL,
          outputFormat: ELEVENLABS_OUTPUT_FORMAT,
          text: cleanText,
        },
      });

      return res.status(response.status || 502).json({
        error: `ElevenLabs failed (${response.status})`,
        details: errorText,
      });
    }

    console.log('[API Response] ElevenLabs text-to-speech (streaming)', {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-David-Voice-Model', ELEVENLABS_MODEL);
    res.status(200);

    const nodeStream = Readable.fromWeb(response.body as any);
    nodeStream.on('error', (err: any) => {
      console.error('[Speech] Stream piping error:', err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'ElevenLabs stream failed' });
      } else {
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      res.on('close', resolve);
      res.on('finish', resolve);
      nodeStream.pipe(res);
    });
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

    if (!res.headersSent) {
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
    res.end();
  }
}
