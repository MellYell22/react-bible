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

// Cue words that a writer uses as stage directions. We handle two kinds:
//  - BREATH/PAUSE cues  -> become a real spoken pause (a single period).
//  - CHUCKLE/LAUGH cues  -> removed silently (TTS can't perform them well).
// Markers can be wrapped in [] () ** *[]* etc. — we match all of those.
// A cue is always wrapped in some combination of * _ ~ [ ( ... ) ] * etc.
// We REQUIRE a wrapper char so we never touch normal words like "pause".
// Optional leading adjective (soft/deep/gentle/long/brief/thoughtful/quiet).
const CUE_ADJ = '(?:soft|deep|gentle|long|brief|thoughtful|quiet|slight|little)\\s+';
const CUE_OPEN = '[\\*_~\\[(]+\\s*'; // one or more wrapper chars, then optional space
const CUE_CLOSE = '\\s*[\\*_~\\])]+'; // optional space, then one or more wrapper chars

const BREATH_WORDS = 'breath|breathes|breathing|inhale|exhale|sigh|sighs|pause|pauses|beat';
const LAUGH_WORDS = 'chuckle|chuckles|laugh|laughs|laughing|smile|smiles|smiling|grin|grins|warmly';

// Breath/pause cues -> replaced with a period pause.
const BREATH_CUE_RE = new RegExp(
  `${CUE_OPEN}(?:${CUE_ADJ})?(?:${BREATH_WORDS})${CUE_CLOSE}`,
  'gi',
);

// Laugh/smile cues -> removed entirely.
const LAUGH_CUE_RE = new RegExp(
  `${CUE_OPEN}(?:${CUE_ADJ})?(?:${LAUGH_WORDS})${CUE_CLOSE}`,
  'gi',
);

// A sentence that is nothing but a bare stage direction ("Chuckles.",
// "long pause,") with no wrapper characters at all. The cue must be followed
// directly by punctuation (or end of text), so real sentences like
// "Smiles like yours matter" or "Pause for a moment" are never touched.
const STANDALONE_CUE_RE = new RegExp(
  `(^|[.!?]\\s+)(?:${CUE_ADJ})?(?:${BREATH_WORDS}|${LAUGH_WORDS})(?:\\s+(?:softly|gently|warmly|quietly|lightly))?\\s*(?:[.!?,]+\\s*|$)`,
  'gi',
);

/**
 * Anything still wrapped in [] {} or <> after the cue pass is metadata —
 * verse footers, action tags, XML/JSON fragments, internal notes. None of it
 * is spoken content, so it is removed wholesale (paired tags including their
 * contents) before reaching TTS.
 */
const stripNonSpokenMarkup = (text: string): string =>
  text
    .replace(/<([a-zA-Z][\w:-]*)[^<>]*>[\s\S]*?<\/\1\s*>/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/<[^<>\n]{0,160}>/g, ' ')
    .replace(STANDALONE_CUE_RE, '$1')
    // Leftover markdown wrappers: drop the symbols, keep the words.
    .replace(/[*_~`#]+/g, ' ');

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

const normalizeQuotesAndSpacing = (text: string): string => {
  let t = protectDecimalPoints(text);

  t = t
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([.!?])(?=[^\s.!?'"’”)])/g, '$1 ')
    .trim();

  return restoreDecimalPoints(t);
};

const collapseStackedFiller = (text: string): string =>
  text
    .replace(
      /\b(mm+|hmm+|hm|ah|uh|um|er|oh)\b[\s,.!—–-]*(?=\b(?:mm+|hmm+|hm|ah|uh|um|er|oh)\b)/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.!—–-]+/, '')
    .trim();

const SENTENCE_RE = /[^.!?]+[.!?]+['"’”)]*|[^.!?]+$/g;
const ENDS_WITH_QUESTION = /\?['"’”)]*\s*$/;
const ENDS_SENTENCE = /[.!?]['"’”)]*\s*$/;

const splitSentences = (text: string): string[] =>
  text.match(SENTENCE_RE) ?? [];

const enforceOneBreath = (text: string): string => {
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return text;

  const kept: string[] = [];

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;

    kept.push(sentence);

    if (ENDS_WITH_QUESTION.test(sentence)) break;
    if (kept.length >= 3) break;
  }

  if (kept.length > 1 && !ENDS_SENTENCE.test(kept[kept.length - 1])) {
    kept.pop();
  }

  const trimmed = kept.join(' ').trim();
  return trimmed.length >= 20 ? trimmed : text;
};

const applyContractions = (text: string): string =>
  text
    .replace(/\bI am\b/g, "I'm")
    .replace(/\bYou are\b/g, "You're")
    .replace(/\bIt is\b/g, "It's")
    .replace(/\bThat is\b/g, "That's")
    .replace(/\bWe are\b/g, "We're")
    .replace(/\bThey are\b/g, "They're");

const preparePlainText = (text: string): string => {
  let t = text.trim();

  // Turn writer stage-directions into real speech behavior:
  //  - a breath/pause cue becomes a natural pause (period)
  //  - a laugh/smile cue is removed (TTS can't perform it convincingly)
  t = t.replace(BREATH_CUE_RE, '. ');
  t = t.replace(LAUGH_CUE_RE, ' ');
  t = stripNonSpokenMarkup(t);
  t = joinLineBreaksConversationally(t);
  t = normalizeQuotesAndSpacing(t);
  t = collapseStackedFiller(t);
  t = applyContractions(t);

  return t.trim();
};

/**
 * Display text stays readable and natural. We do not inject artificial pauses
 * into the text the user sees on screen.
 */
export function humanizeForTts(
  text: string,
  options: HumanizeOptions = {},
): string {
  if (!text) return '';
  if (options.skipHumanize) return text.trim();

  const prepared = preparePlainText(text);

  // Session greetings are already intentionally short. Do not run them through
  // the three-sentence one-breath limiter: an opening such as
  // "Hey... good to see you. I'm David. What's going on with you today?"
  // otherwise gets cut off before the final question because "Hey..." counts
  // as its own sentence.
  if (options.isGreeting) return prepared.trim();

  return enforceOneBreath(prepared).trim();
}

/**
 * David's spoken delivery follows COMPLETE THOUGHTS, not a word-count rule.
 *
 * Important:
 * - Never insert periods every one or two words.
 * - Never split a grammatical phrase just to manufacture a pause.
 * - Ellipses become a light comma-like pause instead of an extra sentence,
 *   which keeps greetings and gentle lead-ins flowing naturally.
 * - Dashes and semicolons become light commas so the voice can keep flowing.
 * - Existing sentence endings remain the main pacing signal.
 */
export function sanitizeForDavidSpeech(text: string): string {
  if (!text) return '';

  let t = preparePlainText(text);
  t = protectDecimalPoints(t);

  // Preserve natural sentence cadence. Periods, ellipses, and dashes are
  // expressive punctuation that ElevenLabs renders as genuine spoken pauses,
  // so they are KEPT rather than flattened into commas or stripped out. We only
  // tidy runaway stacking so delivery never sounds exaggerated — the punctuation
  // itself (and the pause it creates) always survives.
  //
  // Previously this collapsed "..." into a comma, turned every em/en dash into a
  // comma, and rewrote ":" / ";" as commas. That erased the rise-and-fall of a
  // real sentence and made David sound like one long run-on clause. The rules
  // below keep the marks and normalise only their surrounding whitespace.
  t = t.replace(/\s*\.{2,}\s*/g, '\u2026 '); // "..", "..." -> one ellipsis pause
  t = t.replace(/!{2,}/g, '!'); // collapse shouting to a single (kept) "!"
  t = t.replace(/\?{2,}/g, '?'); // collapse repeats to a single (kept) "?"

  // Dashes stay dashes — a normal, expressive mid-sentence pause. Normalise the
  // en-dash to an em-dash and give it consistent spacing instead of deleting it.
  t = t.replace(/\s*[\u2013\u2014]\s*/g, ' \u2014 ');
  // Colons and semicolons are natural pauses too; keep them, only fix spacing.
  t = t.replace(/\s*;\s*/g, '; ');
  t = t.replace(/\s*:\s*/g, ': ');
  t = t.replace(/,{2,}/g, ',');

  // Let "I'm David" land as one complete thought without chopping the words
  // around it into artificial micro-pauses.
  t = t.replace(/\bHey,\s*I'm David,\s*/gi, "Hey, I'm David. ");
  t = t.replace(/\bHey\s+I'm David,\s*/gi, "Hey, I'm David. ");

  // Clean punctuation spacing without creating new pauses inside phrases.
  t = t
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/([.!?])(?=[^\s.!?'"’”)])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();

  t = restoreDecimalPoints(t);

  return t.trim();
}

export function prepareDavidTtsPayload(
  text: string,
  options: HumanizeOptions = {},
): PrepareTtsResult {
  const displayText = humanizeForTts(text, options);
  // Build speech from the ORIGINAL text, not the (possibly 3-sentence
  // truncated) display text, so David can speak the whole thought aloud
  // instead of getting cut off mid-message.
  const speechText = sanitizeForDavidSpeech(text);

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

  const base = emotionalCue ? 520 : 320;
  const lengthAdjustment = wordCount <= 10 ? 120 : wordCount >= 35 ? -20 : 60;
  const jitter = Math.floor(Math.random() * 140);
  const delayMs = Math.max(260, Math.min(820, base + lengthAdjustment + jitter));

  return new Promise(resolve => setTimeout(resolve, delayMs));
}

export const enhanceSpeechDelivery = (text: string): string =>
  sanitizeForDavidSpeech(humanizeForTts(text));
