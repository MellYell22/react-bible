/** Shared voice transcript validation (client + mirrored on api/transcribe). */

export const JUNK_TRANSCRIPT_PATTERNS = [
  /^[\s.…,!?*-]+$/,
  /^(thank you|thanks for watching|subscribe|you|bye|goodbye|okay|ok|um+|uh+|hmm+|ah+|oh+)[.!?\s]*$/i,
  /^(music|applause|\[silence\]|\[music\]|\[inaudible\])$/i,
  /^(the|a|an|i|it|so|and|but|or|well)[.!?\s]*$/i,
];

/** Throat clear, cough, breath — common Whisper outputs on noise. */
export const NOISE_TRANSCRIPT_PATTERNS = [
  /^(a+h*|u+h*m*|hmm*|mm+|mhm+|uh+h*|oh+h*)[.!?\s]*$/i,
  /^(cough|coughing|\*cough\*|clears? throat|sniff|sneeze|burp|yawn)[.!?\s]*$/i,
  /^(breathing|inhales?|exhales?|sigh|sighs)[.!?\s]*$/i,
  /^\[.*\]$/,
];

const OPENING_GREETING_PATTERNS = [
  /^hey[,.]?\s/i,
  /^hi[,.]?\s/i,
  /^hello[,.]?\s/i,
  /^good to (see|hear)/i,
  /^i'?m here/i,
  /^what'?s been on your mind/i,
  /^how'?s your heart/i,
  /^glad you came back/i,
];

export const MIN_MEANINGFUL_WORDS = 2;
export const MIN_MEANINGFUL_LETTERS = 8;

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
