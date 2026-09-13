// Single source of truth for David's ElevenLabs voice.
//
// Both the production serverless route (api/speech.ts) and the local dev
// server (server.ts) import from here, so previews always match what users
// actually hear. Change David's sound in ONE place: this file.

// Live voice must stay on a low-latency model. Turbo keeps flash-level latency
// but has noticeably better prosody: it holds a sentence together instead of
// clipping each clause.
export const DAVID_DEFAULT_MODEL = 'eleven_turbo_v2_5';

export const DAVID_FAST_MODELS = new Set([
  'eleven_flash_v2_5',
  'eleven_flash_v2',
  'eleven_turbo_v2_5',
  'eleven_turbo_v2',
]);

export const DAVID_VOICE_SETTINGS = {
  // Lower stability = more natural pitch and pace variation. Anything above
  // ~0.6 flattens him into a monotone reader.
  stability: 0.42,
  similarity_boost: 0.88,
  // Marginally above neutral — reads as live, not rushed.
  speed: 1.06,
  // Style above ~0.3 exaggerates emphasis and adds clipped stops.
  style: 0.2,
  use_speaker_boost: true,
};

// mp3_22050_32 is where the thin, brittle quality came from. 44100_64 is still
// a small payload but keeps the warmth in his lower register.
export const DAVID_DEFAULT_OUTPUT_FORMAT = 'mp3_44100_64';

export const DAVID_FAST_OUTPUT_FORMATS = new Set([
  'mp3_22050_32',
  'mp3_44100_32',
  'mp3_44100_64',
  'mp3_44100_96',
  'mp3_44100_128',
]);