export default async function handler(req: any, res: any) {
  const requiredEnvVars = [
    'OPENAI_API_KEY',
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_VOICE_ID',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'APP_URL',
    'ELEVENLABS_MODEL',
    'ELEVENLABS_OUTPUT_FORMAT',
  ] as const;

  const configured = Object.fromEntries(
    requiredEnvVars.map((name) => [name, Boolean(process.env[name]?.trim())]),
  );

  res.status(200).json({
    status: "ok",
    configured,
    allConfigured: requiredEnvVars.every((name) => Boolean(process.env[name]?.trim())),
    mobileBuilder: {
      daytonaConfigured: Boolean(process.env.DAYTONA_API_KEY?.trim()),
      convexConfigured: Boolean((process.env.CONVEX_URL || process.env.VITE_CONVEX_URL)?.trim()),
      builderApiBaseUrlConfigured: Boolean(process.env.BUILDER_API_BASE_URL?.trim()),
    },
  });
}
