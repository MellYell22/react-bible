const DAVID_ELEVENLABS_VOICE_ID = 'ewxUvnyvvOehYjKjUVKC';
const ELEVENLABS_TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_v3';
const ELEVENLABS_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128';

import { humanizeForTts } from '../src/utils/davidSpeechDelivery';

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
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY not set' });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DAVID_ELEVENLABS_VOICE_ID;

  try {
    const speechUrl = `${ELEVENLABS_TTS_URL}/${voiceId}?output_format=${encodeURIComponent(ELEVENLABS_OUTPUT_FORMAT)}`;
    const response = await fetch(speechUrl, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: ELEVENLABS_MODEL,
        voice_settings: {
          stability: 0.72,
          similarity_boost: 0.88,
          speed: 0.92,
          style: 0.4,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('ElevenLabs error:', error);
      return res.status(response.status).json({ error: 'ElevenLabs failed', details: error });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);

    return res.status(200).send(buffer);
  } catch (error: any) {
    console.error('TTS error:', error);
    return res.status(500).json({ error: 'TTS failed', details: error.message });
  }
}
