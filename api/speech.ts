const DAVID_ELEVENLABS_VOICE_ID = 'ewxUvnyvvOehYjKjUVKC';
const ELEVENLABS_TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';
const ELEVENLABS_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128';

import { humanizeForTts } from '../src/utils/davidSpeechDelivery.js';

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

  let cleanText = cleanTranscript(text);
  cleanText = humanizeForTts(cleanText);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      code: 'voice_not_configured',
      error: 'David voice audio is not configured yet.',
      message: 'Add ELEVENLABS_API_KEY to the server environment to enable spoken audio.',
    });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DAVID_ELEVENLABS_VOICE_ID;

  try {
    const speechUrl = `${ELEVENLABS_TTS_URL}/${voiceId}?output_format=${encodeURIComponent(ELEVENLABS_OUTPUT_FORMAT)}`;

    const requestPayload = {
      text: cleanText,
      model_id: ELEVENLABS_MODEL,
      voice_settings: {
        stability: 0.72,
        similarity_boost: 0.88,
        speed: 0.96,
        style: 0.32,
      },
    };

    console.log('[API Request] ElevenLabs text-to-speech', {
      url: speechUrl,
      voiceId,
      model: ELEVENLABS_MODEL,
      outputFormat: ELEVENLABS_OUTPUT_FORMAT,
      textLength: cleanText.length,
      textPreview: previewLogText(cleanText),
      voiceSettings: requestPayload.voice_settings,
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

    if (!response.ok) {
      const errorText = await response.text();
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

      return res.status(response.status).json({
        error: `ElevenLabs failed (${response.status})`,
        details: errorText,
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log('[API Response] ElevenLabs text-to-speech', {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      audioBytes: buffer.length,
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');

    return res.status(200).send(buffer);
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
