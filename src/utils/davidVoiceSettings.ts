// Single source of truth for David's spoken voice.
//
// David speaks through OpenAI text-to-speech (gpt-4o-mini-tts) using the
// "cedar" voice — the same voice tested in the OpenAI Realtime Playground.
// ElevenLabs has been removed entirely.
//
// Both the production serverless route (api/speech.ts) and the local dev
// server (server.ts) build their request from here, so previews always match
// what users hear. Change David's sound in ONE place: this file.

export const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';

// gpt-4o-mini-tts is the only OpenAI speech model that follows `instructions`,
// which is how David gets his lower, calmer delivery.
export const DAVID_TTS_MODEL = 'gpt-4o-mini-tts';

// Cedar is OpenAI's deepest, warmest male voice.
export const DAVID_TTS_VOICE = 'cedar';

// Below neutral on purpose: David is a calm companion and users heard him as
// rushed at 1.0+. OpenAI accepts 0.25-4.0; stay within 0.88-0.97.
export const DAVID_TTS_SPEED = 0.93;

// mp3 streams straight into the client's existing audio player.
export const DAVID_TTS_FORMAT = 'mp3';

export const DAVID_TTS_INSTRUCTIONS = [
  'Voice: a warm, grounded man in his forties with a slightly deeper, relaxed, chest-resonant tone. Clear, never gravelly.',
  'Tone: calm, compassionate, and steady — a trusted friend across the table, not a preacher, announcer, or narrator.',
  'Pacing: unhurried and conversational. Let short natural pauses sit between thoughts. Never rush the end of a sentence.',
  'Delivery: speak like real conversation, not reading aloud. Gentle, understated emphasis. Soften on heavy moments; brighten a little for good news.',
  'When quoting Scripture, slow down slightly and let the words land.',
  'Never sound upbeat-salesy, theatrical, sing-song, or robotic.',
].join(' ');

/** Kept for any older import; describes what David currently speaks with. */
export const DAVID_DEFAULT_MODEL = DAVID_TTS_MODEL;

/** The exact JSON body sent to OpenAI for one spoken reply. */
export function buildDavidSpeechBody(text: string) {
  return {
    model: DAVID_TTS_MODEL,
    voice: DAVID_TTS_VOICE,
    input: text,
    instructions: DAVID_TTS_INSTRUCTIONS,
    speed: DAVID_TTS_SPEED,
    response_format: DAVID_TTS_FORMAT,
  };
}
