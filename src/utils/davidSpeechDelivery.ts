export type PrepareTtsResult = {
  displayText: string;
  speechText: string;
};

export type HumanizeOptions = {
  isGreeting?: boolean;
  skipOpener?: boolean;
  skipHumanize?: boolean;
  alreadyPrepared?: boolean;
};

const TRAILING_PAUSE_MARKS = /[\s,;:-]+$/;

const SOFT_FILLER_RE =
  /^(mm+|hmm+|hm+|yeah|hey|okay|alright|you know|i mean|well)[,\.\s]+/i;

const SCRIPTED_MARKUP_RE =
  /\[(?:soft\s+breath|breath|inhale|exhale|sigh|pause)\]|\((?:soft\s+breath|breath|inhale|exhale|sigh|pause)\)|\*(?:soft\s+breath|breath|inhale|exhale|sigh|pause)\*/gi;

const HUMAN_OPENERS = [
  'mm,',
  'hmm,',
  'yeah,',
  'well,',
  'you know,',
] as const;

const DAVID_OPENERS = [
  'Hmm, ',
  'Well, ',
  'You know, ',
  "That's a good question, ",
  'Let me share this with you, ',
  'You see, ',
] as const;

const SHORT_ACKNOWLEDGEMENTS = [
  'I hear you,',
  "I'm with you,",
  "That's a lot,",
  'That feels heavy,',
] as const;

const ACKNOWLEDGEMENT_PERIOD_RE =
  /\b(I hear you|I'm with you|I am with you|That feels heavy|That's a lot|That is a lot|I get that|I understand)\.\s+/gi;

const FILLER_PERIOD_RE =
  /\b(mm+|hmm+|hm+|yeah|hey|okay|alright|you know|i mean|well)\.\s+/gi;

const DECIMAL_PLACEHOLDER = '__DAVID_DECIMAL_POINT__';

const protectDecimalPoints = (text: string): string =>
  text.replace(/(\d)\.(\d)/g, `$1${DECIMAL_PLACEHOLDER}$2`);

const restoreDecimalPoints = (text: string): string =>
  text.replaceAll(DECIMAL_PLACEHOLDER, '.');

const joinLineBreaksConversationally = (text: string): string => {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map(line => line.replace(/^[\s*\-\d+.)]+/, '').trim())
    .filter(Boolean);

  return lines.length <= 1 ? text : lines.join(' ');
};

const softenPunctuationForTts = (text: string): string => {
  let t = protectDecimalPoints(text);

  t = t.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  t = t.replace(/\s*[\u2013\u2014]\s*/g, ', ');
  t = t.replace(/\s*[;:]+\s*/g, ', ');
  t = t.replace(/\s+-\s+/g, ', ');
  t = t.replace(/\.{4,}/g, '...');
  t = t.replace(/,{2,}/g, ',');
  t = t.replace(/\s+,/g, ',');
  t = t.replace(/([.!?])(?=[^\s.!?])/g, '$1 ');

  return restoreDecimalPoints(t);
};

const softenShortInternalStops = (text: string): string => {
  let t = protectDecimalPoints(text);

  t = t.replace(FILLER_PERIOD_RE, (_match, filler: string) => `${filler}, `);

  t = t.replace(
    ACKNOWLEDGEMENT_PERIOD_RE,
    (_match, phrase: string) => `${phrase}, `,
  );

  t = t.replace(
    /^([^.!?]{2,34})\.\s+(?=[A-Z"'])/u,
    (_match, leadIn: string) => {
      const wordCount = leadIn.trim().split(/\s+/).filter(Boolean).length;

      return wordCount <= 5 ? `${leadIn}, ` : `${leadIn}. `;
    },
  );

  return restoreDecimalPoints(t);
};

const addTinyNaturalBreaths = (text: string): string => {
  let t = text;

  t = t.replace(/\bI'm David, I'm\b/g, "I'm David, and I'm");
  t = t.replace(/\bI'm David\.\s+/g, "I'm David, ");
  t = t.replace(
    /\b(I'm with you|I hear you|That's a lot|That sounds heavy),\s+/gi,
    '$1, ',
  );

  return t;
};

const lightlyShortenRunOn = (text: string): string => {
  const sentenceMatches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);

  if (!sentenceMatches || sentenceMatches.length <= 2) {
    return text;
  }

  const firstTwo = sentenceMatches.slice(0, 2).join(' ').trim();

  return firstTwo.length >= 28 ? firstTwo : text;
};

function preparePlainSpeechText(text: string): string {
  let t = text.trim();

  t = t.replace(SCRIPTED_MARKUP_RE, '');

  t = joinLineBreaksConversationally(t);

  t = t.replace(/!{2,}/g, '!');

  t = t.replace(/\s+/g, ' ');

  t = t.replace(/\s+([,.!?])/g, '$1');

  t = softenPunctuationForTts(t);

  t = softenShortInternalStops(t);

  t = addTinyNaturalBreaths(t);

  return t.trim();
}

export function humanizeForTts(
  text: string,
  options: HumanizeOptions = {},
): string {
  if (!text) return '';

  let t = preparePlainSpeechText(text);

  t = lightlyShortenRunOn(t);

  t = t.replace(/\bI am\b/g, "I'm");
  t = t.replace(/\bYou are\b/g, "You're");
  t = t.replace(/\bIt is\b/g, "It's");
  t = t.replace(/\bThat is\b/g, "That's");
  t = t.replace(/\bWe are\b/g, "We're");
  t = t.replace(/\bThey are\b/g, "They're");

  if (
    !options.isGreeting &&
    !options.skipOpener &&
    !SOFT_FILLER_RE.test(t) &&
    Math.random() < 0.18
  ) {
    const opener =
      DAVID_OPENERS[Math.floor(Math.random() * DAVID_OPENERS.length)];

    t = opener + t.charAt(0).toLowerCase() + t.slice(1);
  }

  return t.trim();
}

export function sanitizeForDavidSpeech(text: string): string {
  if (!text) return '';

  let t = preparePlainSpeechText(text);

  if (
    t.length >= 12 &&
    t.length <= 34 &&
    !SOFT_FILLER_RE.test(t) &&
    Math.random() < 0.07
  ) {
    const ack =
      SHORT_ACKNOWLEDGEMENTS[
      Math.floor(Math.random() * SHORT_ACKNOWLEDGEMENTS.length)
      ];

    t = `${ack} ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  }

  t = t.replace(TRAILING_PAUSE_MARKS, '');

  return t.trim();
}

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

  const lengthAdjustment =
    wordCount <= 10 ? 230 : wordCount >= 35 ? -30 : 90;

  const jitter = Math.floor(Math.random() * 220);

  const delayMs = Math.max(
    340,
    Math.min(1050, base + lengthAdjustment + jitter),
  );

  return new Promise(resolve => setTimeout(resolve, delayMs));
}

export const enhanceSpeechDelivery = (text: string): string => {
  return sanitizeForDavidSpeech(humanizeForTts(text));
};
