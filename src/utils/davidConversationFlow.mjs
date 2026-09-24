/**
 * Where David is in a conversation, so Scripture arrives at the right moment.
 *
 * The rhythm David is supposed to keep:
 *
 *   User:  "Hi David."                         → greeting back, nothing more
 *   User:  "I'm not feeling great. Kind of sad." → "Sorry to hear that. What's going on?"
 *   User:  "I got evicted."                    → respond to THAT, then one verse,
 *                                                 one plain sentence on why it fits
 *   User:  (keeps talking)                     → just talk. No second verse, no loop.
 *
 * Left to a prompt alone, the model either jumps to a verse the moment it hears
 * "sad", or keeps asking questions after the person has already explained. So
 * the stage is decided here, in code, and the prompt only gets the rules for
 * the stage it is actually in.
 *
 * Plain JS with no imports so it can be unit-tested with `node --test` and
 * shared by every David endpoint.
 */

/** @typedef {'feeling-only'|'ready-for-scripture'|'after-scripture'|'general'} DavidFlowStage */

const collapse = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

const normalize = (value) =>
  collapse(value)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const wordCount = (value) => normalize(value).split(' ').filter(Boolean).length;

/** The person is telling David how they feel. */
const FEELING_PATTERN = new RegExp(
  '\\b(' + [
    'sad', 'down', 'depressed', 'blue', 'unhappy', 'heavy', 'crying', 'cried', 'hurt', 'hurting', 'heartbroken',
    'anxious', 'anxiety', 'panic', 'panicking', 'worried', 'worry', 'nervous', 'scared', 'afraid', 'fear', 'terrified',
    'lonely', 'alone', 'isolated', 'unseen', 'forgotten',
    'guilty', 'guilt', 'ashamed', 'shame', 'regret',
    'stressed', 'stress', 'pressure', 'burned out', 'burnt out', 'exhausted', 'drained', 'wiped out',
    'overwhelmed', 'drowning', 'falling apart',
    'hopeless', 'worthless', 'pointless', 'empty', 'numb',
    'grieving', 'grief', 'mourning',
    'angry', 'mad', 'furious', 'frustrated', 'bitter', 'resentful',
    'confused', 'lost', 'stuck', 'discouraged', 'defeated', 'broken', 'tired', 'not okay', 'not ok',
    'not (?:feeling |doing )?(?:the )?(?:greatest|best|great|good|well)', 'bad day', 'rough day', 'hard day', 'struggling',
  ].join('|') + ')\\b',
  'i',
);

/**
 * Something concrete happened. Any one of these is enough context for the
 * turn — David does not need to ask "what's going on" after "I got fired".
 */
const EVENT_PATTERN = new RegExp(
  '\\b(' + [
    'fired', 'laid off', 'let go', 'lost my job', 'quit my job', 'evicted', 'eviction', 'kicked out', 'homeless',
    'broke up', 'broken up', 'breakup', 'dumped', 'left me', 'cheated', 'cheating', 'divorce', 'divorced', 'separated',
    'died', 'death', 'passed away', 'passed', 'funeral', 'lost my', 'lost our', 'miscarriage', 'miscarried',
    'diagnos\\w*', 'cancer', 'hospital', 'surgery', 'sick', 'illness', 'relapse', 'relapsed', 'overdose',
    'accident', 'crash', 'arrested', 'jail', 'court', 'lawsuit',
    'behind on rent', "can't pay", "can't afford", 'bankrupt', 'debt', 'broke',
    'failed', 'failing', 'rejected', 'rejection', 'fight', 'fought', 'yelled', 'screamed', 'abused', 'abuse',
    'because', 'since', 'happened', 'found out', 'told me', 'my (?:wife|husband|mom|mother|dad|father|son|daughter|sister|brother|boyfriend|girlfriend|partner|boss|friend|kid|kids|baby|landlord|doctor|ex)',
  ].join('|') + ')\\b',
  'i',
);

/** Events heavy enough that they are the whole story on their own. */
const HARD_EVENT_PATTERN = /\b(fired|laid off|evicted|eviction|broke up|broken up|dumped|left me|died|passed away|funeral|miscarriage|miscarried|diagnos\w*|cancer|hospital|relapse|relapsed|overdose|accident|arrested|homeless|cheated|divorce|divorced|abused)\b/i;

const BIBLE_BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalm', 'Psalms', 'Proverbs', 'Ecclesiastes',
  'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea',
  'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai',
  'Zechariah', 'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans',
  '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude',
  'Revelation',
];

/** "Psalm 34:18", "Psalm 34", "in Isaiah 41" — a book named with a chapter. */
const BOOK_REFERENCE_PATTERN = new RegExp(
  String.raw`\b(${BIBLE_BOOKS.map((book) => book.replace(/ /g, String.raw`\s+`)).join('|')})\s+\d{1,3}\b`,
  'i',
);

/** David talking about Scripture without a chapter number. */
const SCRIPTURE_WORDS_PATTERN = /\b(verse|scripture|the bible|the psalms|in the psalms|gospel|jesus said|paul (?:says|said|wrote)|david wrote|the apostle)\b/i;

/** True when a reply of David's brings Scripture in, in any of the ways he does it. */
export function mentionsScripture(text) {
  const source = collapse(text);
  if (!source) return false;
  return BOOK_REFERENCE_PATTERN.test(source) || SCRIPTURE_WORDS_PATTERN.test(source);
}

/** The person named a feeling. */
export function namesFeeling(text) {
  const source = normalize(text);
  return Boolean(source) && FEELING_PATTERN.test(source);
}

/**
 * The person said what actually happened, or said enough that asking "what's
 * going on?" would make David sound like he wasn't listening.
 */
export function givesContext(text) {
  const source = normalize(text);
  if (!source) return false;
  if (EVENT_PATTERN.test(source)) return true;
  return wordCount(source) >= 14;
}

const lastOf = (messages, role) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) return messages[index];
  }
  return null;
};

/**
 * @param {Array<{role?: string, content?: string}>} messages  this conversation, oldest first,
 *   ending with the person's latest message
 * @returns {DavidFlowStage}
 */
export function detectDavidFlowStage(messages = []) {
  const thread = (Array.isArray(messages) ? messages : []).filter(
    (message) => message && typeof message.content === 'string' && (message.role === 'user' || message.role === 'assistant'),
  );
  if (thread.length === 0) return 'general';

  const latest = lastOf(thread, 'user');
  if (!latest) return 'general';

  const assistantTurns = thread.filter((message) => message.role === 'assistant');
  if (assistantTurns.some((message) => mentionsScripture(message.content))) {
    return 'after-scripture';
  }

  const latestIndex = thread.lastIndexOf(latest);
  const priorUserTurns = thread.slice(0, latestIndex).filter((message) => message.role === 'user');
  const lastAssistant = lastOf(thread.slice(0, latestIndex), 'assistant');

  const latestFeeling = namesFeeling(latest.content);
  const latestContext = givesContext(latest.content);
  const priorFeeling = priorUserTurns.some((message) => namesFeeling(message.content));
  const priorContext = priorUserTurns.some((message) => givesContext(message.content));
  const davidJustAsked = Boolean(lastAssistant && /\?\s*["'”’)]*$/.test(collapse(lastAssistant.content)));

  // "I'm sad." with nothing behind it yet: be a friend first, ask what's going on.
  if (latestFeeling && !latestContext && !priorContext) return 'feeling-only';

  // They have told David what happened — either in this message or answering
  // his question. This is the turn: respond to the real thing, then Scripture.
  if (latestFeeling && latestContext) return 'ready-for-scripture';
  if (priorFeeling && (latestContext || davidJustAsked)) return 'ready-for-scripture';
  // A hard event with no feeling word attached ("I got fired today") still
  // carries everything David needs.
  if (HARD_EVENT_PATTERN.test(normalize(latest.content))) return 'ready-for-scripture';

  return 'general';
}

/* ------------------------------------------------------------------ *
 * Reply shaping — the hard guarantees the prompt cannot give
 * ------------------------------------------------------------------ */

/**
 * Split into sentences without breaking inside a quotation, so a quoted
 * verse that asks a question ("Why are you downcast, O my soul?") is never
 * mistaken for David asking one.
 */
export function splitSpokenSentences(text) {
  const source = collapse(text)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  if (!source) return [];

  const sentences = [];
  let current = '';
  let inQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    current += char;
    if (char === '"') inQuote = !inQuote;
    if (inQuote) continue;

    if (/[.!?]/.test(char)) {
      // Swallow a run of closing punctuation and closing quotes/brackets.
      let lookahead = index + 1;
      while (lookahead < source.length && /[.!?"')\]]/.test(source[lookahead])) {
        current += source[lookahead];
        if (source[lookahead] === '"') inQuote = !inQuote;
        lookahead += 1;
      }
      const next = source[lookahead];
      // A verse reference like "Psalm 34.18" or an abbreviation stays whole.
      const isBoundary = lookahead >= source.length || next === ' ';
      const endsAbbreviation = /\b(?:Mr|Mrs|Ms|Dr|St|vs|etc|e\.g|i\.e)\.$/i.test(current);
      if (isBoundary && !endsAbbreviation) {
        sentences.push(current.trim());
        current = '';
      }
      index = lookahead - 1;
    }
  }

  if (current.trim()) sentences.push(current.trim());
  return sentences;
}

const isQuestionSentence = (sentence) => /\?["')\]]*$/.test(sentence.trim());

/**
 * Enforce the shape of a spoken David reply after the model has written it:
 * plain sentences only, never more than one question, and never a ramble.
 * The reply is cut after David's first question, because a friend asks one
 * thing and waits.
 *
 * @param {string} text
 * @param {{ maxSentences?: number }} options
 */
export function shapeDavidReply(text, options = {}) {
  const maxSentences = Number.isInteger(options.maxSentences) && options.maxSentences > 0 ? options.maxSentences : 4;

  let value = collapse(
    String(text ?? '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]{0,40}\)/g, (match) => (/(sigh|pause|laugh|chuckle|breath|smile|nod|softly|warmly|gently)/i.test(match) ? ' ' : match))
      .replace(/\*[^*]{0,40}\*/g, ' ')
      .replace(/[*_#`]+/g, '')
      .replace(/^\s*(?:[-•]+|\d+[.)])\s+/gm, '')
      .replace(/\r?\n+/g, ' '),
  );
  if (!value) return '';

  const sentences = splitSpokenSentences(value);
  const kept = [];
  for (const sentence of sentences) {
    kept.push(sentence);
    if (isQuestionSentence(sentence) || kept.length >= maxSentences) break;
  }

  return kept.join(' ').trim();
}

/** How many questions David asked in a reply (quoted Scripture excluded). */
export function countDavidQuestions(text) {
  return splitSpokenSentences(text).filter(isQuestionSentence).length;
}
