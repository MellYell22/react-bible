const DAVID_CARTESIA_VOICE_ID = 'a5136bf9-224c-4d76-b823-52bd5efcffcc';
const CARTESIA_TTS_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_MODEL_ID = 'sonic-3';
const CARTESIA_API_VERSION = '2026-03-01';

type CartesiaAuthMode = 'bearer' | 'x-api-key';

type GenerationConfig = {
  speed: number;
  volume: number;
  emotion: string;
};

type VoiceTuning = GenerationConfig & {
  ssmlEmotion: string;
  ssmlSpeed: number;
  openerPauseMs: number;
  phrasePauseMs: number;
  sentencePauseMs: number;
};

const VALID_CARTESIA_EMOTIONS = new Set([
  'happy',
  'excited',
  'enthusiastic',
  'elated',
  'euphoric',
  'triumphant',
  'amazed',
  'surprised',
  'flirtatious',
  'joking/comedic',
  'curious',
  'content',
  'peaceful',
  'serene',
  'calm',
  'grateful',
  'affectionate',
  'trust',
  'sympathetic',
  'anticipation',
  'mysterious',
  'angry',
  'mad',
  'outraged',
  'frustrated',
  'agitated',
  'threatened',
  'disgusted',
  'contempt',
  'envious',
  'sarcastic',
  'ironic',
  'sad',
  'dejected',
  'melancholic',
  'disappointed',
  'hurt',
  'guilty',
  'bored',
  'tired',
  'rejected',
  'nostalgic',
  'wistful',
  'apologetic',
  'hesitant',
  'insecure',
  'confused',
  'resigned',
  'anxious',
  'panicked',
  'alarmed',
  'scared',
  'neutral',
  'proud',
  'confident',
  'distant',
  'skeptical',
  'contemplative',
  'determined',
]);

function resolveCartesiaVoiceId(envVoiceId?: string | null): string {
  return envVoiceId?.trim() || DAVID_CARTESIA_VOICE_ID;
}

function clampNumber(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function cleanTranscript(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\.{4,}/g, '...')
    .trim();
}

function normalizeEmotion(value: string | undefined | null): string | null {
  const emotion = value?.trim().toLowerCase();
  if (!emotion) return null;
  return VALID_CARTESIA_EMOTIONS.has(emotion) ? emotion : null;
}

function chooseDavidEmotion(text: string): string {
  const configuredEmotion = normalizeEmotion(process.env.CARTESIA_TTS_EMOTION);
  if (configuredEmotion) return configuredEmotion;

  const lower = text.toLowerCase();

  if (/\b(grief|grieving|loss|lost someone|died|passed away|heartbroken|mourning)\b/.test(lower)) {
    return 'sympathetic';
  }

  if (/\b(scared|afraid|panic|panicked|terrified|danger|unsafe|anxious|anxiety|worried|overwhelmed)\b/.test(lower)) {
    return 'calm';
  }

  if (/\?\s*$|\b(why|how|what|when|where|should i|can i|could i)\b/.test(lower)) {
    return 'curious';
  }

  if (/\b(thankful|grateful|blessed|hopeful|hope|peace|calm|grace|mercy|amen|prayer|pray|joy|joyful)\b/.test(lower)) {
    return 'grateful';
  }

  return 'content';
}

function buildVoiceTuning(text: string): VoiceTuning {
  const lower = text.toLowerCase();
  const emotion = chooseDavidEmotion(text);

  const comfortTone = /\b(grief|grieving|loss|lost someone|died|passed away|heartbroken|mourning|sad|lonely|alone|heavy|hurt|guilty|ashamed|overwhelmed|anxious|anxiety|worried|afraid|panic|scared)\b/.test(lower);
  const reflectiveTone = /\b(pray|prayer|peace|rest|still|scripture|psalm|isaiah|john|jesus|lord|grace|mercy|hope)\b/.test(lower);
  const questionTone = /\?\s*$|\b(why|how|what|when|where|should i|can i|could i)\b/.test(lower);

  const baseSpeed = comfortTone ? 0.86 : questionTone ? 0.93 : reflectiveTone ? 0.88 : 0.9;
  const ssmlSpeed = comfortTone ? 0.88 : questionTone ? 0.94 : reflectiveTone ? 0.9 : 0.92;

  const configuredEmotion = normalizeEmotion(process.env.CARTESIA_TTS_EMOTION);
  const configuredSsmlEmotion = normalizeEmotion(process.env.CARTESIA_TTS_SSML_EMOTION);

  return {
    speed: clampNumber(Number(process.env.CARTESIA_TTS_SPEED || baseSpeed), baseSpeed, 0.6, 1.5),
    volume: clampNumber(Number(process.env.CARTESIA_TTS_VOLUME || 0.96), 0.96, 0.5, 2.0),
    emotion: configuredEmotion || emotion,
    ssmlEmotion: configuredSsmlEmotion || configuredEmotion || emotion,
    ssmlSpeed: clampNumber(Number(process.env.CARTESIA_TTS_SSML_SPEED || ssmlSpeed), ssmlSpeed, 0.6, 1.5),
    openerPauseMs: comfortTone ? 280 : 220,
    phrasePauseMs: comfortTone ? 220 : 170,
    sentencePauseMs: comfortTone ? 360 : questionTone ? 240 : 300,
  };
}

function addPhraseBreaks(sentence: string, tuning: VoiceTuning): string {
  return sentence
    .replace(
      /\b(I hear you|I'm with you|I am with you|That is a lot|That's a lot|That feels heavy|That sounds heavy|I'm glad you told me|I understand),\s+/gi,
      (_match, phrase: string) => `${phrase},<break time="${tuning.openerPauseMs}ms"/> `,
    )
    .replace(
      /,\s+(?=(and|but|because|so|then|when|if|like|that)\b)/gi,
      `,<break time="${tuning.phrasePauseMs}ms"/> `,
    )
    .replace(
      /\b(Psalm|Proverbs|Isaiah|Matthew|John|Romans|Philippians|Jeremiah)\s+(\d+)/gi,
      (_match, book: string, chapter: string) => `${book} ${chapter}`,
    );
}

function addNaturalBreaks(text: string, tuning: VoiceTuning): string {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);

  const pacedText = sentences
    .map((sentence, index) => {
      const phrasePacedSentence = addPhraseBreaks(sentence, tuning);
      if (index >= sentences.length - 1 || index >= 2) return phrasePacedSentence;
      return `${phrasePacedSentence}<break time="${tuning.sentencePauseMs}ms"/>`;
    })
    .join(' ');

  return pacedText.replace(
    /^(mm|hmm|hm|yeah|hey|okay|alright)[,.]\s+/i,
    (_match, opener: string) => `${opener},<break time="${tuning.openerPauseMs}ms"/> `,
  );
}

function buildSpokenTranscript(text: string, tuning: VoiceTuning): string {
  const tags = `<emotion value="${tuning.ssmlEmotion}"/><speed ratio="${tuning.ssmlSpeed.toFixed(2)}"/>`;
  return `${tags}${addNaturalBreaks(text, tuning)}`;
}

function buildRequestHeaders(apiKey: string, authMode: CartesiaAuthMode): Record<string, string> {
  const authHeader =
    authMode === 'bearer'
      ? { Authorization: `Bearer ${apiKey}` }
      : { 'X-API-Key': apiKey };

  return {
    ...authHeader,
    'Cartesia-Version': CARTESIA_API_VERSION,
    'Content-Type': 'application/json',
    Accept: 'audio/mpeg',
  };
}

function buildCartesiaBody(voiceId: string, text: string, tuning: VoiceTuning): Record<string, unknown> {
  const { ssmlEmotion, ssmlSpeed, openerPauseMs, phrasePauseMs, sentencePauseMs, ...generationConfig } = tuning;

  return {
    model_id: CARTESIA_MODEL_ID,
    transcript: buildSpokenTranscript(text, tuning),
    voice: {
      id: voiceId,
    },
    language: 'en',
    output_format: {
      container: 'mp3',
      bit_rate: 128000,
      sample_rate: 44100,
    },
    generation_config: generationConfig,
  };
}

async function callCartesia(
  apiKey: string,
  voiceId: string,
  text: string,
  config: VoiceTuning,
  authMode: CartesiaAuthMode,
): Promise<Response> {
  return fetch(CARTESIA_TTS_URL, {
    method: 'POST',
    headers: buildRequestHeaders(apiKey, authMode),
    body: JSON.stringify(buildCartesiaBody(voiceId, text, config)),
  });
}

function readRequestBody(req: any): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body ?? {};
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = readRequestBody(req);
  const rawText = body.text;

  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    console.warn('[Speech API] Missing or empty text parameter');
    return res.status(400).json({ error: 'Missing text parameter' });
  }

  const text = cleanTranscript(rawText);

  if (!text) {
    return res.status(400).json({
      error: 'Text was empty after stripping markup',
    });
  }

  const apiKey = process.env.CARTESIA_API_KEY;

  if (!apiKey) {
    console.error('[Speech API] CRITICAL: CARTESIA_API_KEY not set');
    return res.status(500).json({
      error: 'Cartesia API key not configured. Add CARTESIA_API_KEY to Vercel environment variables.',
    });
  }

  const voiceId = resolveCartesiaVoiceId(process.env.CARTESIA_VOICE_ID);
  const config = buildVoiceTuning(text);

  console.log(
    `[Speech API] David voice request model=${CARTESIA_MODEL_ID}, voice=${voiceId}, speed=${config.speed}, ssmlSpeed=${config.ssmlSpeed}, volume=${config.volume}, emotion=${config.emotion}, ssmlEmotion=${config.ssmlEmotion}, text="${text.substring(0, 70)}..."`
  );

  try {
    let response = await callCartesia(apiKey, voiceId, text, config, 'bearer');

    if (response.status === 401 || response.status === 403) {
      const firstError = await response.clone().text().catch(() => '');

      console.warn(
        `[Speech API] Bearer auth failed (${response.status}). Retrying with X-API-Key. ${firstError.substring(0, 250)}`
      );

      response = await callCartesia(apiKey, voiceId, text, config, 'x-api-key');
    }

    if (!response.ok) {
      const responseBody = await response.text();

      console.error(
        `[Speech API] Cartesia failed: HTTP ${response.status} - ${responseBody.substring(0, 500)}`
      );

      return res.status(response.status).json({
        error: `Cartesia TTS failed (${response.status})`,
        details: responseBody,
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);

    return res.status(200).send(buffer);
  } catch (error: any) {
    console.error('[Speech API] Cartesia request threw:', error?.message || error);

    return res.status(500).json({
      error: 'Cartesia TTS request failed',
      details: error?.message || String(error),
    });
  }
}
