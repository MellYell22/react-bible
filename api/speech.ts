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

  const { text } = req.body;

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

    // 2. Resolve Voice ID with fallbacks (Default to Adam if none provided)
    const defaultVoiceId = 'pNInz6obpgDQGcFmaJcg'; // Adam
    const voiceId = process.env.ELEVENLABS_VOICE_ID || process.env.ELEVEN_LABS_VOICE_ID || defaultVoiceId;
    
    console.log(`[Speech API] Using Voice ID: ${voiceId}`);

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    console.log(`[Speech API] Calling ElevenLabs: ${url}`);

    // 3. Make the API call
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.4, // Lower stability for more natural, slightly imperfect speech
          similarity_boost: 0.75, // Balanced similarity
          style: 0.1, // Slight style variation for natural pauses
          use_speaker_boost: true
        },
      }),
    });

    // 4. Handle ElevenLabs errors explicitly
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Speech API] ElevenLabs API Error: Status ${response.status}`);
      console.error(`[Speech API] ElevenLabs Response Body: ${errorText}`);
      
      let parsedError = errorText;
      try {
        const json = JSON.parse(errorText);
        if (json.detail) parsedError = json.detail;
      } catch (e) {
        // Ignore parse error, use raw text
      }

      return res.status(response.status).json({ 
        error: `ElevenLabs API Error (${response.status})`,
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
