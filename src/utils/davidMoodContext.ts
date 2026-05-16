import { buildDavidScriptureResponse, MOODS_DATA } from '../constants/moods';
import { DAVID_PERSONALITY_PROMPT } from '../constants/davidPersona';

type ChatLikeMessage = {
  role?: string;
  content?: string;
};

const MOOD_KEYWORDS: Record<string, string[]> = {
  ANXIOUS: ['anxious', 'anxiety', 'panic', 'worried', 'worry', 'nervous', 'fearful', 'scared'],
  SAD: ['sad', 'down', 'depressed', 'blue', 'unhappy', 'heavy'],
  LONELY: ['lonely', 'alone', 'isolated', 'left out', 'by myself'],
  STRESSED: ['stressed', 'stress', 'pressure', 'burned out', 'burnt out'],
  OVERWHELMED: ['overwhelmed', 'too much', 'buried', 'drowning'],
  HOPELESS: ['hopeless', 'no hope', 'pointless', 'give up', 'worthless'],
  GRIEVING: ['grieving', 'grief', 'loss', 'lost someone', 'mourning', 'died', 'passed away'],
  ANGRY: ['angry', 'mad', 'furious', 'resentful', 'rage'],
  NUMB: ['numb', 'empty', 'nothing', 'disconnected'],
  CONFUSED: ['confused', 'lost', 'uncertain', 'unsure', "don't know what to do"],
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

export function buildDavidSystemPromptWithMood(moodKey?: string | null): string {
  const normalizedMoodKey = normalizeMoodKey(moodKey);
  if (!normalizedMoodKey) return DAVID_PERSONALITY_PROMPT;

  const scriptureContext = buildDavidScriptureResponse(normalizedMoodKey);
  if (!scriptureContext) return DAVID_PERSONALITY_PROMPT;

  return `${DAVID_PERSONALITY_PROMPT}

CURRENT MOOD CONTEXT:
The user appears to be feeling ${normalizedMoodKey.toLowerCase()}.
Here is how you might naturally bring scripture into this conversation:

${scriptureContext}

Use this as inspiration — don't copy it verbatim. Let it inform your natural response.`;
}
