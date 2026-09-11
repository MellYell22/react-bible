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

const SCRIPTED_MARKUP_RE =
  /\[(?:soft\s+breath|breath|inhale|exhale|sigh|pause)\]|\((?:soft\s+breath|breath|inhale|exhale|sigh|pause)\)|\*(?:soft\s+breath|breath|inhale|exhale|sigh|pause)\*/gi;

const ACKNOWLEDGEMENT_PERIOD_RE =
  /\b(I hear you|I'm with you|I am with you|That feels heavy|That's a lot|That is a lot|I get that|I understand)\.\s+/gi;

const FILLER_PERIOD_RE =
  /\b(mm+|hmm+|hm+|oh+|ah+|i see|i know|yeah|hey|okay|alright|you know|i mean|well)\.\s+/gi;

const DECIMAL_PLACEHOLDER = '__DAVID_DECIMAL_POINT__';
const VERSE_COLON_PLACEHOLDER = '__DAVID_VERSE_COLON__';

const protectDecimalPoints = (text: string): string =>
  text.replace(/(\d)\.(\d)/g, `$1${DECIMAL_PLACEHOLDER}$2`);

const restoreDecimalPoints = (text: string): string =>
  text.replaceAll(DECIMAL_PLACEHOLDER, '.');

// Chapter:verse references must survive punctuation softening. Without this,
// "John 3:16" became "John 3, 16" — an unwanted pause mid-reference.
const protectVerseColons = (text: string): string =>
  text.replace(/(\d):(\d)/g, `$1${VERSE_COLON_PLACEHOLDER}$2`);

const restoreVerseColons = (text: string): string =>
  text.replaceAll(VERSE_COLON_PLACEHOLDER, ':');

const joinLineBreaksConversationally = (text: string): string => {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map(line => line.replace(/^[\s*\-\d+.)]+/, '').trim())
    .filter(Boolean);

  return lines.length <= 1 ? text : lines.join(' ');
};

const softenPunctuationForTts = (text: string): string => {
  let t = protectVerseColons(protectDecimalPoints(text));

  t = t.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  t = t.replace(/\s*[\u2013\u2014]\s*/g, ', ');
  t = t.replace(/\s*[;:]+\s*/g, ', ');
  t = t.replace(/\s+-\s+/g, ', ');
  t = t.replace(/\.{4,}/g, '...');
  t = t.replace(/,{2,}/g, ',');
  t = t.replace(/\s+,/g, ',');
  t = t.replace(/([.!?])(?=[^\s.!?])/g, '$1 ');

  return restoreVerseColons(restoreDecimalPoints(t));
};

// How many hard stops we are willing to soften in a single reply. Softening
// every one would collapse David into a single breathless run-on sentence.
const MAX_SOFTENED_STOPS = 3;
const SHORT_SENTENCE_WORD_LIMIT = 5;

// This is the main cause of the clipped, list-like delivery. When David replies
// in short declarative sentences — "How are you. What's on your heart." — each
// full stop becomes a hard pause and he sounds like he is reading bullet
// points. The previous version only ever fixed the FIRST short sentence because
// its pattern was anchored to the start of the string, so every later stop
// survived. This pass softens short stops wherever they occur.
const softenShortSentenceStops = (text: string): string => {
  const protectedText = protectVerseColons(protectDecimalPoints(text));

  const chunks = protectedText.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g);

  if (!chunks || chunks.length < 2) {
    return restoreVerseColons(restoreDecimalPoints(protectedText));
  }

  let softenedCount = 0;
  let result = '';

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const nextChunk = chunks[index + 1];
    const isLastChunk = index === chunks.length - 1;

    if (isLastChunk || softenedCount >= MAX_SOFTENED_STOPS) {
      result += chunk;
      continue;
    }

    const parsed = chunk.match(/^(\s*)([\s\S]*?)([.!?]+)(\s*)$/);

    if (!parsed) {
      result += chunk;
      continue;
    }

    const [, leadingSpace, body, marks] = parsed;

    // Questions and exclamations carry real intonation — never flatten them.
    if (marks !== '.') {
      result += chunk;
      continue;
    }

    const trimmedBody = body.trim();
    const wordCount = trimmedBody.split(/\s+/).filter(Boolean).length;

    if (wordCount === 0 || wordCount > SHORT_SENTENCE_WORD_LIMIT) {
      result += chunk;
      continue;
    }

    // Leave verse references and numbered items alone: "Read Psalm 23."
    if (/\d$/.test(trimmedBody)) {
      result += chunk;
      continue;
    }

    // Only merge into something that actually continues the thought.
    if (!nextChunk || !/^\s*["'A-Za-z]/.test(nextChunk)) {
      result += chunk;
      continue;
    }

    result += `${leadingSpace}${trimmedBody}, `;
    softenedCount += 1;
  }

  return restoreVerseColons(restoreDecimalPoints(result));
};

const softenShortInternalStops = (text: string): string => {
  let t = protectDecimalPoints(text);

  t = t.replace(FILLER_PERIOD_RE, (_match, filler: string) => `${filler}, `);

  t = t.replace(
    ACKNOWLEDGEMENT_PERIOD_RE,
    (_match, phrase: string) => `${phrase}, `,
  );

  t = restoreDecimalPoints(t);

  return softenShortSentenceStops(t);
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

// Previously this truncated David to his first three sentences, which cut him
// off mid-thought and read as an abrupt stop. Length is a persona/prompt
// concern, not something the speech layer should silently enforce, so this is
// now a pass-through. The export is kept so existing imports keep working.
const lightlyShortenRunOn = (text: string): string => text;

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

  // Softening can leave doubled separators behind.
  t = t.replace(/,\s*,+/g, ',');
  t = t.replace(/\s{2,}/g, ' ');

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

  return t.trim();
}

export function sanitizeForDavidSpeech(text: string): string {
  if (!text) return '';

  let t = preparePlainSpeechText(text);

  // Ellipses make ElevenLabs insert long breathing pauses; keep the beat short.
  t = t.replace(/\s*\.{3}\s*/g, ', ');
  t = t.replace(/,\s*,+/g, ',');

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