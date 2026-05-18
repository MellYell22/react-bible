/**
 * Clean natural delivery for David.
 *
 * Important:
 * The text David displays can include gentle pauses, but the text sent to TTS
 * should be cleaner. Some voice engines stretch the final word when they see
 * ellipses, repeated punctuation, curly punctuation, or trailing pause marks.
 */

export type HumanizeOptions = {
  isGreeting?: boolean;
  force?: boolean;
};

const TRAILING_PAUSE_MARKS = /[\s.。…,…,;:!?-]+$/;

export function humanizeForTts(
  text: string,
  options: HumanizeOptions = {},
): string {
  if (!text) return '';

  let t = text.trim();

  // Keep the displayed assistant text clean and conversational.
  t = t.replace(/\s+/g, ' ');
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/!/g, '.');
  t = t.replace(/\.{3,}/g, '...');

  return t;
}

/**
 * Cartesia speech cleanup.
 * This fixes the robotic/drawn-out ending issue by removing artificial pause
 * marks before the text is sent to the TTS API.
 */
export function sanitizeForDavidSpeech(text: string): string {
  if (!text) return '';

  let t = text.trim();

  // Normalize punctuation so the TTS engine does not over-perform it.
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/…/g, ', ');
  t = t.replace(/\.{3,}/g, ', ');
  t = t.replace(/[!?]+/g, '.');
  t = t.replace(/\s+/g, ' ');

  // Remove awkward filler-only openings that make the voice sound fake.
  t = t.replace(/^(hmm+|mm+|uh+|um+|ah+|yeah)[,.\s]+/i, '');

  // Remove pause marks at the very end so Cartesia does not drag the last word.
  t = t.replace(TRAILING_PAUSE_MARKS, '');

  // Add one clean period only when the line needs a natural stop.
  if (t && !/[.!?]$/.test(t)) {
    t += '.';
  }

  return t;
}

export type PrepareTtsResult = {
  displayText: string;
  speechText: string;
};

export function prepareDavidTtsPayload(
  text: string,
  options: HumanizeOptions = {},
): PrepareTtsResult {
  const displayText = humanizeForTts(text, options);
  const speechText = sanitizeForDavidSpeech(displayText);

  return {
    displayText,
    speechText,
  };
}

/**
 * Remove fake thinking delays.
 * Real conversation should feel responsive.
 */
export function preSpeechThinkingDelay(): Promise<void> {
  return Promise.resolve();
}
