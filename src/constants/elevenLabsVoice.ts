/** David's ElevenLabs voice — always use this ID for TTS */
export const DAVID_ELEVENLABS_VOICE_ID = '9X1Jz0xL6DHvaiD9uzHw';

/** Stale IDs from older configs (logged if present in env) */
export const DEPRECATED_ELEVENLABS_VOICE_IDS = new Set([
  'vek32IUMncn9S8XIcFt5',
]);

/** Always returns David's voice ID. Env override is ignored to prevent misconfiguration. */
export function resolveDavidVoiceId(
  envVoiceId?: string | null,
): string {
  const trimmed = envVoiceId?.trim();
  if (trimmed && trimmed !== DAVID_ELEVENLABS_VOICE_ID) {
    const label = DEPRECATED_ELEVENLABS_VOICE_IDS.has(trimmed) ? 'deprecated' : 'custom';
    console.warn(
      `[ElevenLabs] Ignoring ${label} ELEVENLABS_VOICE_ID "${trimmed}" — using ${DAVID_ELEVENLABS_VOICE_ID}`,
    );
  }
  return DAVID_ELEVENLABS_VOICE_ID;
}
