export default async function handler(req: any, res: any) {
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
  const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID || process.env.ELEVEN_LABS_VOICE_ID || '6j5m6aQo2Q3NyLs6PYOz (default)';

  res.status(200).json({
    status: "ok",
    env: process.env.NODE_ENV,
    appUrl: process.env.APP_URL || "not set",
    openaiConfigured: !!process.env.OPENAI_API_KEY,
    elevenLabsConfigured: !!elevenLabsKey,
    elevenLabsVoiceId,
    supabaseConfigured: !!(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY),
  });
}
