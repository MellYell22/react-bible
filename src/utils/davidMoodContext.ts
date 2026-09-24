import { MOODS_DATA } from '../constants/moods.js';
import type { Scripture } from '../constants/moods.js';
import { DAVID_PERSONALITY_PROMPT } from '../constants/persona.js';

type ChatLikeMessage = {
  role?: string;
  content?: string;
};

export type DavidScriptureGuidance = {
  moodKey: string | null;
  scripture: Scripture | null;
  reaction: string | null;
  followUp: string | null;
  resetUsedVerses: boolean;
};

const MOOD_KEYWORDS: Record<string, string[]> = {
  ANXIOUS: ['anxious', 'anxiety', 'panic', 'panicking', 'worried', 'worry', 'nervous', 'fearful', 'scared', 'afraid', 'spiraling', 'restless'],
  SAD: ['sad', 'down', 'depressed', 'blue', 'unhappy', 'heavy', 'crying', 'hurt', 'heartbroken'],
  LONELY: ['lonely', 'alone', 'isolated', 'left out', 'by myself', 'nobody', 'unseen', 'forgotten'],
  GUILTY: ['guilty', 'guilt', 'ashamed', 'shame', 'regret', 'condemned', 'failed god', 'not good enough'],
  STRESSED: ['stressed', 'stress', 'pressure', 'burned out', 'burnt out', 'exhausted', 'tired'],
  OVERWHELMED: ['overwhelmed', 'too much', 'buried', 'drowning', "can't handle", 'falling apart'],
  HOPELESS: ['hopeless', 'no hope', 'pointless', 'give up', 'worthless', "can't go on"],
  GRIEVING: ['grieving', 'grief', 'loss', 'lost someone', 'mourning', 'died', 'passed away', 'miss them'],
  ANGRY: ['angry', 'mad', 'furious', 'resentful', 'rage', 'bitter'],
  NUMB: ['numb', 'empty', 'nothing', 'disconnected', "don't feel anything"],
  CONFUSED: ['confused', 'lost', 'uncertain', 'unsure', "don't know what to do", 'stuck'],
  HOPEFUL: ['hopeful', 'hope', 'encouraged'],
  GRATEFUL: ['grateful', 'thankful', 'blessed'],
  JOYFUL: ['joyful', 'happy', 'joy', 'excited'],
  PEACEFUL: ['peaceful', 'peace', 'calm', 'settled'],
};

function normalizeMoodKey(value?: string | null): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const directMatch = MOODS_DATA.find((mood) => mood.key === normalized);
  if (directMatch) return directMatch.key;

  if (MOOD_KEYWORDS[normalized]) return normalized;

  const labelMatch = MOODS_DATA.find((mood) => mood.label.toUpperCase() === normalized);
  return labelMatch?.key ?? null;
}

export function detectMoodKeyFromMessages(messages: ChatLikeMessage[] = []): string | null {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const text = latestUserMessage?.content?.toLowerCase();
  if (!text) return null;

  for (const mood of MOODS_DATA) {
    if (text.includes(mood.key.toLowerCase()) || text.includes(mood.label.toLowerCase())) {
      return mood.key;
    }
  }

  for (const [moodKey, keywords] of Object.entries(MOOD_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return moodKey;
    }
  }

  return null;
}

export function resolveMoodKey(input: {
  mood?: string | null;
  moodKey?: string | null;
  detectedMood?: string | null;
  profileMood?: string | null;
  messages?: ChatLikeMessage[];
}): string | null {
  return (
    normalizeMoodKey(input.detectedMood)
    || normalizeMoodKey(input.moodKey)
    || normalizeMoodKey(input.mood)
    || normalizeMoodKey(input.profileMood)
    || detectMoodKeyFromMessages(input.messages)
  );
}

const normalizeUsedVerseRefs = (usedVerseRefs: string[] = []): Set<string> =>
  new Set(
    usedVerseRefs
      .filter((reference): reference is string => typeof reference === 'string')
      .map((reference) => reference.trim().toLowerCase())
      .filter(Boolean),
  );

const pickRandom = <T,>(items: T[]): T | null => {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
};

export function buildDavidScriptureGuidance(
  moodKey?: string | null,
  usedVerseRefs: string[] = [],
): DavidScriptureGuidance {
  const normalizedMoodKey = normalizeMoodKey(moodKey);
  if (!normalizedMoodKey) {
    return {
      moodKey: null,
      scripture: null,
      reaction: null,
      followUp: null,
      resetUsedVerses: false,
    };
  }

  const mood = MOODS_DATA.find((item) => item.key === normalizedMoodKey);
  if (!mood?.scriptures.length) {
    return {
      moodKey: normalizedMoodKey,
      scripture: null,
      reaction: null,
      followUp: null,
      resetUsedVerses: false,
    };
  }

  const used = normalizeUsedVerseRefs(usedVerseRefs);
  const freshScriptures = mood.scriptures.filter(
    (scripture) => !used.has(scripture.reference.trim().toLowerCase()),
  );
  const resetUsedVerses = freshScriptures.length === 0;
  const scripture = pickRandom(resetUsedVerses ? mood.scriptures : freshScriptures);

  return {
    moodKey: normalizedMoodKey,
    scripture,
    reaction: pickRandom(mood.davidReaction),
    followUp: pickRandom(mood.davidFollowUps),
    resetUsedVerses,
  };
}

export function buildDavidSystemPromptWithMood(
  moodKey?: string | null,
  usedVerseRefs: string[] = [],
): string {
  const guidance = buildDavidScriptureGuidance(moodKey, usedVerseRefs);
  return buildDavidSystemPromptFromGuidance(guidance);
}

export type DavidPromptOptions = {
  /** When false (streaming text chat), the private [VERSE USED] footer instruction is omitted so it can never leak into user-visible output. */
  includeVerseFooter?: boolean;
};

export function buildDavidSystemPromptFromGuidance(
  guidance: DavidScriptureGuidance,
  options: DavidPromptOptions = {},
): string {
  if (!guidance.moodKey || !guidance.scripture) return DAVID_PERSONALITY_PROMPT;

  const includeVerseFooter = options.includeVerseFooter !== false;
  const footerRule = includeVerseFooter
    ? `\n- Only if you actually used this scripture (a phrase, the reference, or the full verse), end the response with this exact private tracking footer on its own line: [VERSE USED: ${guidance.scripture.reference}]. If you did not use it, do not add the footer.`
    : '\n- Never output any bracketed tracking tags such as [VERSE USED: ...]; they are for internal systems only.';

  // The mood pools were written with spoken filler ("mm…", "yeah…"). Models
  // copy examples far more than rules, so strip that before it is shown.
  const reaction = guidance.reaction
    ? guidance.reaction.replace(/^(?:(?:m+|mhm+|hmm+|hm+|um+|uh+|yeah|man|oh)(?:\.{1,3}|[,!\u2026])?\s+)+/i, '').replace(/^\w/, (c) => c.toUpperCase())
    : null;
  const inspirationLines = [
    reaction
      ? `- A natural way David might feel this out loud: "${reaction}" — inspiration only, don't quote it verbatim. Say something in that spirit, in your own words, this turn.`
      : null,
    guidance.followUp
      ? `- A natural closing question David might ask: "${guidance.followUp}" — inspiration only, don't quote it verbatim, and only use a question at all if one genuinely fits.`
      : null,
  ].filter(Boolean).join('\n');

  const scriptureSection = `

SCRIPTURE OPTION FOR THIS TURN (gentle, never forced):
Mood: ${guidance.moodKey}
Reference: ${guidance.scripture.reference}
Full scripture: ${guidance.scripture.verse}
Short reflection idea: ${guidance.scripture.davidReflection}

How to use it:
- This scripture is an option, not a requirement. Skip it entirely when the user's words call for simple human presence.
- When it fits, weave in a short phrase or just the reference, the way a friend mentions something they love ("Psalm 46 has that quiet line about being still..."). Read the full verse only when the moment truly calls for it.
- Never turn the reply into a devotional or a lecture. Hold the one-breath rule: a short acknowledgement, then this one thought, then optionally one gentle question. Three short sentences maximum.
- Ask at most ONE question, and only when it genuinely helps the user keep talking. Never two questions. Ending warmly with no question is often better.${footerRule}
${inspirationLines}
- Never reuse the same reaction or closing line you've already used earlier in this conversation. Vary your wording every time, even for the same mood.`;

  return `${DAVID_PERSONALITY_PROMPT}
CURRENT EMOTIONAL THREAD:
The user may be feeling ${guidance.moodKey.toLowerCase()}.

Respond as if you noticed this from their voice and words, not as if you are labeling them. Do not say, "It sounds like you're feeling..." or clinically name the emotion unless the user named it first.

Use the scripture material below only if it fits the user's exact words. Connect it to the user's emotional moment without preaching or over-explaining.
${scriptureSection}`;
}
