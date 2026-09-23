import { Readable } from 'node:stream';
import { sanitizeForDavidSpeech } from '../src/utils/davidSpeechDelivery.js';
import { getOpenAIApiKey } from '../lib/openaiEnv.js';
import {
  buildDavidSpeechBody,
  DAVID_TTS_MODEL,
  DAVID_TTS_VOICE,
  OPENAI_SPEECH_URL,
} from '../src/utils/davidVoiceSettings.js';

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

/**
 * David's spoken voice — OpenAI text-to-speech (gpt-4o-mini-tts, "cedar").
 *
 * The audio is streamed straight through to the client as OpenAI generates it,
 * so David starts talking after the first chunk rather than after the whole
 * clip. The response contract (audio/mpeg body, or a JSON error with a `code`)
 * is unchanged, so the client player needs no changes.
 */
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

  const cleanText = sanitizeForDavidSpeech(cleanTranscript(text));
  if (!cleanText) {
    return res.status(400).json({ error: 'Missing text' });
  }

  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return res.status(503).json({
      code: 'voice_not_configured',
      error: 'David voice audio is not configured yet.',
      message: 'Add OPENAI_API_KEY to the server environment to enable spoken audio.',
    });
  }

  const body = buildDavidSpeechBody(cleanText);

  try {
    console.log('[API Request] OpenAI text-to-speech (streaming)', {
      model: DAVID_TTS_MODEL,
      voice: DAVID_TTS_VOICE,
      speed: body.speed,
      textLength: cleanText.length,
      textPreview: previewLogText(cleanText),
    });

    const response = await fetch(OPENAI_SPEECH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      console.error('[API Response] OpenAI text-to-speech', {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        responseBodyPreview: errorText.substring(0, 1000),
      });

      return res.status(response.status || 502).json({
        error: `David's voice failed (${response.status})`,
        details: errorText.substring(0, 500),
      });
    }

    console.log('[API Response] OpenAI text-to-speech (streaming)', {
      ok: true,
      status: response.status,
      contentType: response.headers.get('content-type'),
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-David-Voice-Model', `${DAVID_TTS_MODEL}:${DAVID_TTS_VOICE}`);
    res.status(200);

    const nodeStream = Readable.fromWeb(response.body as any);
    nodeStream.on('error', (err: any) => {
      console.error('[Speech] Stream piping error:', err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Voice stream failed' });
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
    console.error('[Speech] OpenAI request failed', {
      errorMessage: error?.message || String(error),
      apiKeyPresent: Boolean(apiKey),
    });

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'TTS failed',
        details: error?.message || String(error),
      });
    }
    res.end();
  }
}
