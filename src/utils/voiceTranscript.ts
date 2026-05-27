/** Shared voice transcript validation (client + mirrored on api/transcribe). */

export const JUNK_TRANSCRIPT_PATTERNS = [
  /^[\s.…,!?*-]+$/,
  /^(thank you|thanks for watching|subscribe|you|bye|goodbye|okay|ok|um+|uh+|hmm+|ah+|oh+)[.!?\s]*$/i,
  /^(thank you|thanks) for (watching|listening)[.!?\s]*$/i,
  /^spiritual conversation in english[.!?\s]*$/i,
  /^(music|applause|\[silence\]|\[music\]|\[inaudible\])$/i,
  /^(the|a|an|i|it|so|and|but|or|well)[.!?\s]*$/i,
];

/** Throat clear, cough, breath — common Whisper outputs on noise. */
export const NOISE_TRANSCRIPT_PATTERNS = [
  /^(a+h*|u+h*m*|hmm*|mm+|mhm+|uh+h*|oh+h*)[.!?\s]*$/i,
  /^(uh huh|mm hmm|mhm hmm|huh)[.!?\s]*$/i,
  /^(cough|coughing|\*cough\*|clears? throat|sniff|sneeze|burp|yawn)[.!?\s]*$/i,
  /^(breathing|inhales?|exhales?|sigh|sighs)[.!?\s]*$/i,
  /^\[.*\]$/,
];

/** True session openers — used to block a second greeting mid-session. */
const OPENING_GREETING_PATTERNS = [
  /^hey[,.]?\s/i,
  /^hey\.?$/i,
  /^hi[,.]?\s/i,
  /^hello[,.]?\s/i,
  /^good to see/i,
  /^i'?m david/i,
  /^what'?s (been on your mind|going on|up)/i,
  /^what'?s been on your heart/i,
  /^how'?s your (heart|night|day)/i,
  /^how are you holding up/i,
  /^glad you came back/i,
  /^what'?s been weighing/i,
  /^there you are/i,
  /^how'?s it going/i,
  /^what'?s up/i,
  /^quiet night/i,
  /^long day/i,
];

/** Therapy-bot / assistant phrases — replace with fallback, never silent retry. */
const BANNED_THERAPY_PHRASE_PATTERNS = [
  /^how are you feeling(\s+today)?/i,
  /^tell me more/i,
  /^it sounds like you/i,
  /^you seem (like you|deep)/i,
  /^i'?m (here for you|here to listen|here to support|happy to help)/i,
  /^i'?m glad you/i,
  /^that must be (hard|difficult|challenging)/i,
  /^thank you for (sharing|telling)/i,
  /^how can i (help|assist|support)/i,
  /^you are not alone/i,
  /^good to hear from you/i,
  /^you'?ve got something on your mind/i,
  /^as an ai/i,
  /^i understand (that )?you/i,
  /^let'?s explore/i,
  /^it is important to remember/i,
  /^here are (some|a few|three)/i,
  /^in conclusion/i,
];

export const MIN_MEANINGFUL_WORDS = 2;
export const MIN_MEANINGFUL_LETTERS = 5;

export function normalizeTranscript(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isJunkTranscript(text: string): boolean {
  const normalized = normalizeTranscript(text);
  if (!normalized) return true;
  if (normalized.length < 3) return true;
  if (JUNK_TRANSCRIPT_PATTERNS.some(re => re.test(normalized))) return true;
  if (NOISE_TRANSCRIPT_PATTERNS.some(re => re.test(normalized))) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0].length <= 4) return true;
  return false;
}

/** Require enough real language before calling the AI. */
export function isMeaningfulTranscript(text: string): boolean {
  if (isJunkTranscript(text)) return false;
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < MIN_MEANINGFUL_WORDS) return false;
  const letters = trimmed.replace(/[^a-zA-Z]/g, '');
  if (letters.length < MIN_MEANINGFUL_LETTERS) return false;
  return true;
}

export function transcriptsAreSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.includes(shorter) && shorter.length >= 6) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return true;
  let matches = 0;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / maxLen >= 0.85;
}

export function isDuplicateTranscript(
  normalized: string,
  lastTranscript: string,
  recentTranscripts: string[],
): boolean {
  if (!normalized) return true;
  if (normalized === lastTranscript) return true;
  return recentTranscripts.some(t => transcriptsAreSimilar(t, normalized));
}

/** Block David from re-delivering an opening greeting mid-session. */
export function looksLikeOpeningGreeting(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return OPENING_GREETING_PATTERNS.some(re => re.test(t));
}

/** Persona-banned therapy / assistant phrasing — swap for a natural fallback. */
export function looksLikeBannedTherapyPhrase(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return BANNED_THERAPY_PHRASE_PATTERNS.some(re => re.test(t));
}
