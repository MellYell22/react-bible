/**
 * Classifies a user's turn as conversational rather than substantive.
 *
 * David's prompt is built around meeting a feeling and, when it fits, offering
 * Scripture. That works when someone arrives saying "I'm anxious". It fails
 * when they just say "hi David" or "hey, what's up?" — there is no feeling to
 * meet, so he either reaches for a verse that nobody asked for or answers so
 * minimally ("hey.") that the conversation dead-ends.
 *
 * This module names that case so the prompt can handle it deliberately:
 * greet back warmly, ask one gentle open question, and leave Scripture alone.
 *
 * Deliberately plain string matching, not a model call — this runs on every
 * turn and must be fast, free, and predictable.
 */

/** Openings: someone saying hello, with or without David's name. */
const GREETING_PATTERNS = [
  /^(hi|hey|hello|heya|hiya|yo|howdy|sup|wassup|whatsup|hai)\b/,
  /^good\s+(morning|afternoon|evening|day)\b/,
  /^(morning|afternoon|evening)\b/,
  /^(what'?s\s+up|what\s+up|how'?s\s+it\s+going|how\s+are\s+(you|u|ya)|how\s+you\s+doing|how'?s\s+things)\b/,
  /^(hey|hi|hello)\s+(there|david)\b/,
];

/** Small talk about David himself, rather than about the user. */
const SMALL_TALK_PATTERNS = [
  /^how\s+(?:are|r)\s+(?:you|u|ya)(?:\s+david)?\s*$/,
  /^how\s+(?:you|ya)\s+doing(?:\s+david)?\s*$/,
  /^what'?s\s+going\s+on(?:\s+david)?\s*$/,
  /^what'?s\s+up(?:\s+david)?\s*$/,
  /^(who|what)\s+(are|r)\s+(you|u)\b/,
  /^what\s+(can|do)\s+you\s+do\b/,
  /^how\s+(does|do)\s+this\s+work\b/,
  /^(are|r)\s+(you|u)\s+(real|a\s+bot|an?\s+ai|human)\b/,
  /^what\s+is\s+this\b/,
  /^just\s+(saying\s+)?(hi|hey|hello)\b/,
  /^(testing|test)\b/,
];

/** Low-signal replies that carry no content to respond to yet. */
const LOW_SIGNAL_PATTERNS = [
  /^(idk|i\s+dunno|dunno)\b/,
  /^i\s+don'?t\s+know\s*$/,
  /^(nothing|nothin|not\s+much|nm|nada)\b/,
  /^(meh|hmm+|hm|mm+|eh)\b/,
  /^(ok|okay|k|kk|sure|yeah|yep|yup|no|nope|fine|alright)\s*$/,
  /^(lol|haha+|ha)\s*$/,
];

/**
 * Strip punctuation and emoji so "hi David!! 👋" matches the same as "hi david".
 * Keeps apostrophes because several patterns depend on them.
 */
const normalize = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/** Longer messages carry real content even when they open with "hey". */
const MAX_OPENING_WORDS = 8;

/**
 * A previous turn counts as substantive once the person has actually told
 * David something. After that, a bare "idk" is a continuation of their story,
 * not an opening — and should be answered with the context David already has.
 */
export const isSubstantiveTurn = (text) => {
  const normalized = normalize(text);
  if (!normalized) return false;
  if (normalized.split(' ').length > MAX_OPENING_WORDS) return true;
  return classifyText(normalized) === null;
};

/**
 * "hey" is a greeting. "hey david, my wife is sick" is not — the greeting is
 * just the doorway. Strip the salutation and David's name, then judge what is
 * actually left.
 */
const stripGreetingPrefix = (normalized) => {
  for (const pattern of GREETING_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      // Trim first: the slice leaves a leading space, which would stop the
      // name and filler patterns below from anchoring at ^.
      return normalized
        .slice(match[0].length)
        .trim()
        .replace(/^(there|david)\b/, '')
        .trim()
        .replace(/^(it'?s|its)\s+me\b/, '')
        .trim();
    }
  }
  return normalized;
};

function classifyText(normalized) {
  if (!normalized) return null;
  if (normalized.split(' ').length > MAX_OPENING_WORDS) return null;

  // Answer a question even when it contains no mood and never names David.
  if (SMALL_TALK_PATTERNS.some((pattern) => pattern.test(normalized))) return 'small-talk';

  if (GREETING_PATTERNS.some((pattern) => pattern.test(normalized))) {
    const rest = stripGreetingPrefix(normalized);
    // Nothing left, or what's left is itself conversational filler.
    if (!rest) return 'greeting';
    if (SMALL_TALK_PATTERNS.some((pattern) => pattern.test(rest))) return 'small-talk';
    if (GREETING_PATTERNS.some((pattern) => pattern.test(rest))) return 'greeting';
    if (SMALL_TALK_PATTERNS.some((pattern) => pattern.test(rest))) return 'small-talk';
    if (LOW_SIGNAL_PATTERNS.some((pattern) => pattern.test(rest))) return 'greeting';
    // A greeting carrying real content is a substantive turn.
    return null;
  }

  if (SMALL_TALK_PATTERNS.some((pattern) => pattern.test(normalized))) return 'small-talk';
  if (LOW_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized))) return 'low-signal';
  return null;
}

/**
 * @param {string} latestUserText   what the user just said
 * @param {string[]} previousUserTexts  their earlier turns, oldest first
 * @returns {'greeting'|'small-talk'|'low-signal'|null}
 */
export function detectConversationOpening(latestUserText, previousUserTexts = []) {
  const classification = classifyText(normalize(latestUserText));
  if (!classification) return null;

  // Once someone has opened up, later short replies belong to that thread.
  // Greetings are the exception: "hey, you there?" mid-conversation is still
  // a greeting, but it should not reset a conversation that has real weight.
  const hasSubstantiveHistory = (previousUserTexts || []).some(isSubstantiveTurn);
  if (hasSubstantiveHistory) return null;

  return classification;
}
