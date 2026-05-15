import { prepareDavidTtsPayload } from '../src/utils/davidSpeechDelivery';
import { resolveDavidVoiceId } from '../src/constants/elevenLabsVoice';

export default async function handler(req: any, res: any) {
  // CORS headers if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    console.warn(`[Speech API] Method ${req.method} not allowed`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, enable_ssml_parsing: clientSsmlFlag } = req.body;

  if (!text) {
    console.warn('[Speech API] Missing text parameter');
    return res.status(400).json({ error: 'Missing text parameter' });
  }

  try {
    // 1. Resolve API Key with fallbacks
    const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
    if (!apiKey) {
      console.error('[Speech API] CRITICAL: Neither ELEVENLABS_API_KEY nor ELEVEN_LABS_API_KEY is configured in the environment.');
      return res.status(500).json({ 
        error: 'ElevenLabs API Key is not configured on the server.',
        details: 'Check Vercel Environment Variables.'
      });
    }
    
    // Log key presence without leaking the value
    console.log(`[Speech API] API Key found. Length: ${apiKey.length}, Starts with: ${apiKey.substring(0, 3)}...`);

    const voiceId = resolveDavidVoiceId(
      process.env.ELEVENLABS_VOICE_ID || process.env.ELEVEN_LABS_VOICE_ID,
    );
    console.log(`[Speech API] Using Voice ID: ${voiceId}`);

    // Apply SSML delivery unless client already sent SSML or plain safety text
    const alreadySsml = /<speak[\s>]/i.test(text);
    const ttsPayload = alreadySsml
      ? { ssmlText: text, enableSsmlParsing: clientSsmlFlag !== false }
      : clientSsmlFlag === true && text.includes('<break')
        ? { ssmlText: text, enableSsmlParsing: true }
        : prepareDavidTtsPayload(text, { force: true });

    if (ttsPayload.enableSsmlParsing) {
      console.log('[Speech API] SSML delivery enabled (prosody + breaks)');
    }

    const synthesize = (id: string) =>
      fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}?optimize_streaming_latency=4&output_format=mp3_22050_32`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text: ttsPayload.ssmlText,
          model_id: 'eleven_flash_v2_5',
          enable_ssml_parsing: ttsPayload.enableSsmlParsing,
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: false,
          },
        }),
      });

    const response = await synthesize(voiceId);

    // 4. Handle ElevenLabs errors explicitly
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Speech API] ElevenLabs API Error: Status ${response.status}`);
      console.error(`[Speech API] ElevenLabs Response Body: ${errorText}`);
      
      let parsedError = errorText;
      let userMessage = `ElevenLabs API Error (${response.status})`;
      try {
        const json = JSON.parse(errorText);
        if (json.detail?.message) parsedError = json.detail.message;
        else if (json.detail) parsedError = typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail);
      } catch (e) {
        // Ignore parse error, use raw text
      }

      // 402 = quota exhausted or subscription required on ElevenLabs account
      if (response.status === 402) {
        userMessage = 'ElevenLabs quota exhausted or subscription required. Check your ElevenLabs account billing at elevenlabs.io.';
        console.error('[Speech API] 402 Payment Required — ElevenLabs account has hit its character quota or requires an active subscription.');
      }
      // 401 = invalid or missing API key
      if (response.status === 401) {
        userMessage = 'ElevenLabs API key is invalid or missing. Check ELEVENLABS_API_KEY in Vercel environment variables.';
        console.error('[Speech API] 401 Unauthorized — ELEVENLABS_API_KEY is invalid or not set correctly in Vercel.');
      }

      return res.status(response.status).json({ 
        error: userMessage,
        details: parsedError
      });
    }

    // 5. Return success
    console.log('[Speech API] ElevenLabs call successful. Returning audio stream.');
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.status(200).send(buffer);
    
  } catch (error: any) {
    console.error('[Speech API] Unexpected internal error:', error.message);
    console.error(error.stack);
    res.status(500).json({ 
      error: 'Internal Server Error during speech generation',
      message: error.message 
    });
  }
}
