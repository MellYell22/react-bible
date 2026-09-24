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

const TRAILING_PAUSE_MARKS = /[\s,;:\u2014-]+$/;

// Stage directions the model sometimes writes ("[warmly]", "*sighs*",
// "(pause)"). The voice would read them aloud, so they never reach speech.
const CUE_WORDS = "(?:soft(?:ly)?\\s+)?(?:breath|breathes|inhale|exhale|sigh|sighs|pause|pauses|laugh|laughs|chuckle|chuckles|softly|warmly|gently|smiles|nods)";
const STAGE_DIRECTION_RE = new RegExp(
  `\\[[a-z][a-z\\s'-]{0,30}\\]|\\*${CUE_WORDS}\\*|\\(${CUE_WORDS}\\)`,
  "gi",
);

// "Mm." / "Mhmm..." / "Um..." at the very start sounds like a stall, not warmth.
const LEADING_FILLER_RE = /^(?:(?:m+|mm+-?hm+|mhm+|hmm+|hm+|um+|uh+)(?:\.{1,3}|[,!\u2026])?\s+)+/i;

const joinLineBreaksConversationally = (text: string): string => {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map(line => line.replace(/^\s*(?:[*\-\u2022]+|\d+[.)])\s+/, '').trim())
    .filter(Boolean);

  return lines.length <= 1 ? text : lines.join(' ');
};

// OpenAI's voice paces itself from the delivery instructions in
// davidVoiceSettings.ts. Plain punctuation is the approved delivery (sample C):
// no periods turned into commas, no injected pauses. Only strip what would be
// read aloud wrongly or sound broken.
function preparePlainSpeechText(text: string): string {
  let t = text.trim();

  t = t.replace(STAGE_DIRECTION_RE, ' ');
  t = joinLineBreaksConversationally(t);
  t = t.replace(/[*_#`\[\]]+/g, '');

  t = t.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  t = t.replace(/\u2026/g, '...');
  t = t.replace(/\.{4,}/g, '...');
  t = t.replace(/!{2,}/g, '!');
  t = t.replace(/\s*\u2014\s*/g, ' \u2014 ');

  t = t.replace(/\s+/g, ' ');
  t = t.replace(/\s+([,.!?;:])/g, '$1');
  t = t.trim();

  t = t.replace(LEADING_FILLER_RE, '');

  return t.trim();
}

export function sanitizeForDavidSpeech(text: string): string {
  if (!text) return '';

  return preparePlainSpeechText(text).replace(TRAILING_PAUSE_MARKS, '').trim();
}

export function humanizeForTts(
  text: string,
  _options: HumanizeOptions = {},
): string {
  if (!text) return '';

  const t = sanitizeForDavidSpeech(text);

  // Contract David's own words only. Quoted Scripture stays word-for-word.
  const contracted = t
    .split(/("[^"]*")/)
    .map((part) => (part.startsWith('"') ? part : part
      .replace(/\bI am\b/g, "I'm")
      .replace(/\bYou are\b/g, "You're")
      .replace(/\bIt is\b/g, "It's")
      .replace(/\bThat is\b/g, "That's")
      .replace(/\bWe are\b/g, "We're")
      .replace(/\bThey are\b/g, "They're")))
    .join('');

  return contracted.charAt(0).toUpperCase() + contracted.slice(1);
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