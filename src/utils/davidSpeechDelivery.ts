/**
 * Natural voice delivery helpers for David.
 */

export type HumanizeOptions = {
  isGreeting?: boolean;
  force?: boolean;
};

const TRAILING_PAUSE_MARKS = /[\s。…,…,;:-]+$/;
const SOFT_FILLER_RE = /^(mm+|hmm+|hm+|yeah|you know|i mean)[,\.\s…]+/i;
const SCRIPTED_MARKUP_RE =
  /\[(?:soft\s+breath|breath|inhale|exhale|sigh|pause)\]|\((?:soft\s+breath|breath|inhale|exhale|sigh|pause)\)|\*(?:soft\s+breath|breath|inhale|exhale|sigh|pause)\*/gi;

const HUMAN_OPENERS = ['mm,', 'hmm,', 'yeah,'] as const;

const SHORT_ACKNOWLEDGEMENTS = [
  'I hear you,',
  "I'm with you,",
  "That's a lot,",
  'That feels heavy,',
] as const;

const ACKNOWLEDGEMENT_PERIOD_RE =
  /\b(I hear you|I'm with you|I am with you|That feels heavy|That's a lot|That is a lot|I get that|I understand)\.\s+/gi;

const FILLER_PERIOD_RE =
  /\b(mm+|hmm+|hm+|yeah|you know|i mean)\.\s+/gi;

const DECIMAL_PLACEHOLDER = '__DAVID_DECIMAL_POINT__';

const protectDecimalPoints = (text: string): string =>
  text.replace(/(\d)\.(\d)/g, `$1${DECIMAL_PLACEHOLDER}$2`);

const restoreDecimalPoints = (text: string): string =>
  text.replaceAll(DECIMAL_PLACEHOLDER, '.');

const shouldMaybeAddOpener = (text: string, options: HumanizeOptions): boolean => {
  if (options.isGreeting || options.force) return false;
  if (!text || SOFT_FILLER_RE.test(text)) return false;
  if (/^(lord|father god|god[,\s])/i.test(text)) return false;
  if (text.length < 18 || text.length > 180) return false;

  const emotionalCue =
    /\b(anxious|afraid|sad|lonely|alone|guilt|guilty|ashamed|overwhelmed|tired|grief|lost|hurt|heavy|panic|worried|depressed)\b/i.test(
      text,
    );

  return emotionalCue ? Math.random() < 0.22 : Math.random() < 0.06;
};

const joinLineBreaksConversationally = (text: string): string => {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);

  if (lines.length <= 1) return text;

  return lines
    .map((line, index) => {
      const isLast = index === lines.length - 1;
      let current = line.replace(/[;:]+$/g, '');

      if (!isLast && !/[!?]$/.test(current)) {
        current = current.replace(/[.]+$/g, '');
        return `${current},`;
      }

      return current;
    })
    .join(' ');
};

const softenPunctuationForTts = (text: string): string => {
  let t = protectDecimalPoints(text);

  t = t.replace(/\.{3,}|…/g, ', ');
  t = t.replace(/\s*[;:]\s*/g, ', ');
  t = t.replace(/\s+[–—]\s+/g, ', ');
  t = t.replace(/\s+-\s+/g, ', ');
  t = t.replace(/,{2,}/g, ',');
  t = t.replace(/\s+,/g, ',');
  t = t.replace(/,\s*(and|but|so|because|then)\b/gi, ', $1');

  return restoreDecimalPoints(t);
};

const softenShortInternalStops = (text: string): string => {
  let t = protectDecimalPoints(text);

  t = t.replace(FILLER_PERIOD_RE, (_match, filler: string) => `${filler}, `);
  t = t.replace(ACKNOWLEDGEMENT_PERIOD_RE, (_match, phrase: string) => `${phrase}, `);

  t = t.replace(/^([^.!?]{2,34})\.\s+(?=[A-Z"'])/u, (_match, leadIn: string) => {
    const wordCount = leadIn.trim().split(/\s+/).filter(Boolean).length;
    return wordCount <= 5 ? `${leadIn}, ` : `${leadIn}. `;
  });

  return restoreDecimalPoints(t);
};

const addTinyNaturalBreaths = (text: string): string => {
  let t = text;

  t = t.replace(/\bI'm David, I'm\b/g, "I'm David, and I'm");
  t = t.replace(/\bI'm David\.\s+/g, "I'm David, ");
  t = t.replace(/\b(I'm with you|I hear you|That's a lot|That sounds heavy),\s+/gi, '$1, ');

  return t;
};

const lightlyShortenRunOn = (text: string): string => {
  const sentenceMatches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!sentenceMatches || sentenceMatches.length <= 2) return text;

  const firstTwo = sentenceMatches.slice(0, 2).join(' ').trim();
  return firstTwo.length >= 28 ? firstTwo : text;
};

export function humanizeForTts(
  text: string,
  options: HumanizeOptions = {},
): string {
  if (!text) return '';

  let t = text.trim();

  t = t.replace(SCRIPTED_MARKUP_RE, '');
  t = joinLineBreaksConversationally(t);
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/!{2,}/g, '!');
  t = t.replace(/\s+/g, ' ');
  t = t.replace(/\s+([,.!?])/g, '$1');
  t = softenPunctuationForTts(t);
  t = softenShortInternalStops(t);
  t = addTinyNaturalBreaths(t);
  t = lightlyShortenRunOn(t);

  if (shouldMaybeAddOpener(t, options)) {
    const opener = HUMAN_OPENERS[Math.floor(Math.random() * HUMAN_OPENERS.length)];
    t = `${opener} ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  }

  return t.trim();
}

export function sanitizeForDavidSpeech(text: string): string {
  if (!text) return '';

  let t = text.trim();

  t = t.replace(SCRIPTED_MARKUP_RE, '');
  t = joinLineBreaksConversationally(t);
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/!{2,}/g, '!');
  t = t.replace(/\s+/g, ' ');
  t = t.replace(/\s+([,.!?])/g, '$1');
  t = softenPunctuationForTts(t);
  t = softenShortInternalStops(t);
  t = addTinyNaturalBreaths(t);

  if (t.length >= 12 && t.length <= 34 && !SOFT_FILLER_RE.test(t) && Math.random() < 0.05) {
    const ack = SHORT_ACKNOWLEDGEMENTS[Math.floor(Math.random() * SHORT_ACKNOWLEDGEMENTS.length)];
    t = `${ack} ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  }

  t = t.replace(TRAILING_PAUSE_MARKS, '');

  return t.trim();
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

export function preSpeechThinkingDelay(text = ''): Promise<void> {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const emotionalCue =
    /\b(anxious|afraid|sad|lonely|guilt|ashamed|overwhelmed|grief|hurt|heavy|panic|worried|tired)\b/i.test(
      text,
    );

  const base = emotionalCue ? 610 : 390;
  const lengthAdjustment = wordCount <= 10 ? 230 : wordCount >= 35 ? -30 : 90;
  const jitter = Math.floor(Math.random() * 220);
  const delayMs = Math.max(340, Math.min(1050, base + lengthAdjustment + jitter));

  return new Promise(resolve => setTimeout(resolve, delayMs));
}

export const enhanceSpeechDelivery = (text: string): string => {
  return sanitizeForDavidSpeech(humanizeForTts(text));
};
