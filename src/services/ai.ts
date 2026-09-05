import { MoodResponse, ResponseLength, Scripture } from "../types";
import {
  prepareDavidTtsPayload,
  sanitizeForDavidSpeech,
} from "../utils/davidSpeechDelivery";
import {
  canSpeak,
  SPEECH_SOURCE_VOICE_MODE,
  SPEECH_SOURCE_USER_TAP,
} from "../utils/speechPolicy.mjs";
import {
  DavidConversationMemory,
  getDavidConversationMemory,
  saveDavidConversationMemory,
  supabase,
} from "./supabase";

export type GenerateSpeechOptions = {
  isGreeting?: boolean;
  /** Set when text was already passed through humanizeForTts */
  skipHumanize?: boolean;
  /** Set when caller has already completed final speech sanitation/formatting. */
  alreadyPrepared?: boolean;
  /** Adds a brief natural pause before requesting speech audio. */
  withThinkingDelay?: boolean;
  /** Used by the voice state machine to cancel stale speech requests. */
  signal?: AbortSignal;
  /**
   * REQUIRED. Why this audio is allowed to play. Omitting it is refused, so
   * typed chat can never produce sound by accident.
   */
  source?: SpeechSource;
};

export type SpeechSource = 'voice-mode' | 'user-tap';
export const SPEECH_VOICE_MODE: SpeechSource = SPEECH_SOURCE_VOICE_MODE as SpeechSource;
export const SPEECH_USER_TAP: SpeechSource = SPEECH_SOURCE_USER_TAP as SpeechSource;

/**
 * Whether a live voice session is running. VoiceScreen owns this; nothing
 * else should set it. Typed chat never turns it on, so voice-mode speech
 * requests from a text screen are refused.
 */
let voiceModeActive = false;

export const setVoiceModeActive = (active: boolean): void => {
  voiceModeActive = Boolean(active);
  console.log(`[Speech] Voice mode ${voiceModeActive ? 'ACTIVE' : 'inactive'}.`);
};

export const isVoiceModeActive = (): boolean => voiceModeActive;

type RequestOptions = {
  signal?: AbortSignal;
};

let speechConfiguredCache: boolean | null = null;
const VOICE_MEMORY_WAIT_BUDGET_MS = 300;

type VoiceMemoryCacheEntry = {
  memory: DavidConversationMemory[];
  expiresAt: number;
  request?: Promise<DavidConversationMemory[]>;
};

const voiceMemoryCache = new Map<string, VoiceMemoryCacheEntry>();

const previewText = (value: string, maxLength = 160): string => (
  value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
);

const getResponseHeaders = (response: Response) => ({
  contentType: response.headers.get('content-type'),
  contentLength: response.headers.get('content-length'),
});

const logApiRequest = (label: string, params: Record<string, unknown>) => {
  console.log(`[API Request] ${label}`, params);
};

const logApiResponse = (label: string, params: Record<string, unknown>) => {
  console.log(`[API Response] ${label}`, params);
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) return;
  const error = new Error('Request was cancelled.');
  error.name = 'AbortError';
  throw error;
};

/**
 * Thrown when the server refuses a chat turn because the free daily limit is
 * spent (or a Pro-only feature was requested on a free account). Callers catch
 * this to show the upgrade screen instead of an error bubble.
 */
export class ChatLimitReachedError extends Error {
  readonly limit: number | null;
  readonly used: number | null;
  readonly tier: string | null;

  constructor(message: string, details: { limit?: number | null; used?: number | null; tier?: string | null } = {}) {
    super(message || "You've reached today's free conversations with David.");
    this.name = 'ChatLimitReachedError';
    this.limit = details.limit ?? null;
    this.used = details.used ?? null;
    this.tier = details.tier ?? null;
  }
}

export const isChatLimitReachedError = (error: unknown): error is ChatLimitReachedError => (
  error instanceof ChatLimitReachedError
  || (typeof error === 'object' && error !== null && (error as any).name === 'ChatLimitReachedError')
);

/**
 * `/api/chat` meters usage per signed-in account, so every call must carry the
 * Supabase access token. Guest sessions have none — those requests go through
 * unauthenticated and are capped in the UI instead.
 */
const buildChatRequestHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!supabase) return headers;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  } catch (error) {
    console.log('[Chat] Could not attach the access token to this request:', error);
  }

  return headers;
};

/** Turns a 402 limit response into a typed error the chat screens can act on. */
const throwIfLimitReached = (status: number, payload: any) => {
  if (status !== 402 && !payload?.limitReached) return;
  throw new ChatLimitReachedError(payload?.message || '', {
    limit: payload?.limit,
    used: payload?.used,
    tier: payload?.tier,
  });
};

const waitFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getVoiceMemory = async (userId: string | null): Promise<DavidConversationMemory[]> => {
  if (!userId) return [];

  const now = Date.now();
  const cached = voiceMemoryCache.get(userId);
  if (cached?.expiresAt && cached.expiresAt > now) return cached.memory;

  const request = cached?.request || getDavidConversationMemory(userId, 10)
    .then((memory) => {
      voiceMemoryCache.set(userId, {
        memory,
        expiresAt: Date.now() + 60_000,
      });
      return memory;
    })
    .catch((error) => {
      console.log('[David Memory] Voice memory load failed without delaying speech:', error);
      return cached?.memory || [];
    });

  voiceMemoryCache.set(userId, {
    memory: cached?.memory || [],
    expiresAt: cached?.expiresAt || 0,
    request,
  });

  return Promise.race([
    request,
    waitFor(VOICE_MEMORY_WAIT_BUDGET_MS).then(() => cached?.memory || []),
  ]);
};

export const getMoodScriptures = async (
  mood: string,
  translation: string = 'NIV',
  responseLength: ResponseLength = 'short',
  voiceInstruction?: string,
): Promise<MoodResponse> => {
  console.log("OPENAI REQUEST SENT - Mood Scriptures");
  const response = await fetch('/api/mood-scriptures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mood, translation, responseLength, voiceInstruction })
  });

  if (!response.ok) {
    throw new Error('Failed to fetch mood scriptures');
  }

  console.log("OPENAI RESPONSE RECEIVED - Mood Scriptures");
  return response.json();
};

export class ReflectionRequestError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ReflectionRequestError';
    this.code = code;
    this.status = status;
  }
}

export class DailyReflectionLimitError extends ReflectionRequestError {
  constructor(message = 'You have reached today’s free reflection limit.') {
    super(message, 'DAILY_REFLECTION_LIMIT_REACHED', 429);
    this.name = 'DailyReflectionLimitError';
  }
}

export const getVerseReflection = async (verse: string, reference: string): Promise<string> => {
  console.log("OPENAI REQUEST SENT - Reflection");

  if (!supabase) {
    throw new ReflectionRequestError('The app connection is not configured.', 'CONNECTION_UNAVAILABLE', 503);
  }

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) {
    throw new ReflectionRequestError(
      'Please sign in to use your three free reflections each day.',
      'AUTH_REQUIRED',
      401,
    );
  }

  const response = await fetch('/api/reflection', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ verse, reference })
  });

  const data = await response.json().catch(() => ({}));

  if (
    response.status === 429
    || data?.limitReached
    || data?.code === 'DAILY_REFLECTION_LIMIT_REACHED'
  ) {
    throw new DailyReflectionLimitError(data?.error);
  }

  if (!response.ok) {
    throw new ReflectionRequestError(
      data?.error || 'Failed to generate reflection.',
      data?.code || 'REFLECTION_REQUEST_FAILED',
      response.status,
    );
  }

  console.log("OPENAI RESPONSE RECEIVED - Reflection");
  return data.text;
};

export const getVerseOfTheDay = async (translation: string = 'NIV'): Promise<Scripture> => {
  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `verse_of_the_day_${translation}_${today}`;
  const cachedVerse = localStorage.getItem(cacheKey);

  if (cachedVerse) {
    try {
      return JSON.parse(cachedVerse);
    } catch (e) {
      console.error('Error parsing cached verse:', e);
    }
  }

  console.log("OPENAI REQUEST SENT - Verse of the Day");
  const response = await fetch('/api/verse-of-the-day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ translation })
  });

  if (!response.ok) {
    throw new Error('Failed to fetch verse of the day');
  }

  const result = await response.json();
  console.log("OPENAI RESPONSE RECEIVED - Verse of the Day");
  if (result.verse && result.reference) {
    localStorage.setItem(cacheKey, JSON.stringify(result));
    return result;
  }

  throw new Error('Invalid verse of the day response');
};

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type DavidVoiceResponse = {
  text: string;
  moodKey?: string | null;
  verseUsed?: string | null;
  resetUsedVerses?: boolean;
};

export type TranscribeAudioResult = {
  transcript: string;
  rejected?: boolean;
  reason?: string;
};

const safeText = (text: string, maxLength = 280): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, maxLength);

const getOpeningPhrase = (text: string): string => {
  const cleaned = safeText(text, 220);
  const firstSentence = cleaned.match(/^(.+?[.!?])\s/)?.[1];
  return safeText(firstSentence || cleaned.split(',')[0] || cleaned, 160);
};

const getFollowUpQuestion = (text: string): string => {
  const questions = text.match(/[^.!?]*\?/g) || [];
  return safeText(questions[questions.length - 1] || '', 220);
};

const resolveDavidMemoryUserId = async (explicitUserId?: string | null): Promise<string | null> => {
  if (explicitUserId && explicitUserId !== 'guest') return explicitUserId;
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.log('[David Memory] Could not resolve authenticated user:', error.message);
      return null;
    }
    return data?.user?.id || null;
  } catch (error) {
    console.log('[David Memory] Auth lookup failed:', error);
    return null;
  }
};

const buildMemorySummary = (memory: DavidConversationMemory[]): string => {
  if (!memory.length) return '';

  const moodCounts = memory.reduce<Record<string, number>>((counts, item) => {
    const mood = (item.mood_key || 'unknown').toUpperCase();
    counts[mood] = (counts[mood] || 0) + 1;
    return counts;
  }, {});

  const recurringMoods = Object.entries(moodCounts)
    .filter(([, count]) => count >= 2)
    .map(([mood, count]) => `${mood} repeated ${count} times`)
    .join('; ');

  const verses = memory
    .map(item => item.verse_used)
    .filter(Boolean)
    .slice(0, 10)
    .join(', ');

  const openings = memory
    .map(item => item.opening_phrase)
    .filter(Boolean)
    .slice(0, 10)
    .join(' | ');

  const questions = memory
    .map(item => item.follow_up_question)
    .filter(Boolean)
    .slice(0, 10)
    .join(' | ');

  const themes = memory
    .map(item => item.short_summary || item.user_message)
    .filter(Boolean)
    .slice(0, 6)
    .map(item => `- ${safeText(String(item), 220)}`)
    .join('\n');

  return [
    'PRIVATE DAVID MEMORY SUMMARY:',
    recurringMoods ? `Recurring emotions: ${recurringMoods}. If relevant, acknowledge the pattern gently and naturally.` : '',
    verses ? `Recently used verses: ${verses}. Avoid repeating these unless the selected mood pool is exhausted.` : '',
    openings ? `Recent David openings: ${openings}. Use a different opening this time.` : '',
    questions ? `Recent David questions: ${questions}. Use a different ending or no question if that feels more human.` : '',
    themes ? `Recent emotional themes:\n${themes}` : '',
    'Freshness standard: make this response feel specific to the user message, not like a reused devotional template.',
  ].filter(Boolean).join('\n');
};

const buildVoiceConversationContext = (
  history: ChatHistoryMessage[],
  memory: DavidConversationMemory[] = [],
): string => {
  const recent = history.slice(-6);
  const lastUser = [...recent].reverse().find(message => message.role === 'user')?.content || '';
  const previousAssistant = [...recent].reverse().find(message => message.role === 'assistant')?.content || '';

  const recentAssistantTurns = history
    .filter(message => message.role === 'assistant')
    .slice(-4)
    .map(message => message.content);
  const sessionOpenings = Array.from(new Set(recentAssistantTurns.map(getOpeningPhrase).filter(Boolean)));
  const sessionQuestions = Array.from(new Set(recentAssistantTurns.map(getFollowUpQuestion).filter(Boolean)));

  const emotionalWords = [
    'anxious', 'anxiety', 'panic', 'afraid', 'worried', 'sad', 'lonely', 'alone',
    'guilty', 'ashamed', 'overwhelmed', 'tired', 'grief', 'grieving', 'angry',
    'hurt', 'numb', 'lost', 'confused', 'hopeful', 'thankful', 'peaceful'
  ];
  const emotionalThread = recent
    .filter(message => message.role === 'user')
    .map(message => message.content)
    .find(content => emotionalWords.some(word => content.toLowerCase().includes(word))) || '';

  return [
    lastUser ? `Latest user words: ${lastUser}` : '',
    emotionalThread ? `Emotional thread to remember quietly: ${emotionalThread}` : '',
    previousAssistant ? `Do not echo David's last wording: ${previousAssistant}` : '',
    sessionOpenings.length ? `Openings David already used this session: ${sessionOpenings.join(' | ')}. Open a genuinely different way this turn.` : '',
    sessionQuestions.length ? `Questions David already asked this session: ${sessionQuestions.join(' | ')}. Do not repeat these; often end with no question at all.` : '',
    buildMemorySummary(memory),
    'Continue the live voice conversation. Follow the user current direction, avoid restarting, and keep the next spoken turn short.',
    'Use varied wording, varied scripture lead-ins, and varied endings.'
  ].filter(Boolean).join('\n');
};

const buildLengthInstruction = (responseLength: ResponseLength): string => {
  return {
    short: "Voice turn: 1 to 2 complete, natural spoken sentences, warm and fluent. Use scripture only if it fits naturally, and vary the wording every turn.",
    medium: "Voice turn: sound human and unscripted, in complete flowing sentences. Acknowledge, use scripture naturally if it fits, give one short reflection, and only ask a gentle question if it truly fits.",
    long: "Voice turn: 2 to 3 complete sentences max, conversational and pastoral, no list formatting. Avoid recycled openings and repeated question endings."
  }[responseLength];
};

export const getChatResponse = async (
  history: ChatHistoryMessage[],
  responseLength: ResponseLength = 'short',
  moodKey?: string,
): Promise<string> => {
  const data = await getDavidVoiceResponse(history, {
    responseLength,
    moodKey,
  });
  return data.text;
};

export const getDavidVoiceResponse = async (
  history: ChatHistoryMessage[],
  options: {
    responseLength?: ResponseLength;
    moodKey?: string;
    usedVerses?: string[];
    userId?: string | null;
    liveVoice?: boolean;
    signal?: AbortSignal;
    /**
     * When provided, David's reply is streamed and each complete sentence is
     * handed over the moment it is safe to speak — so text-to-speech for his
     * first sentence starts while he is still writing the rest. Without it the
     * call behaves exactly as before: one request, one complete reply.
     */
    onSentence?: (sentence: string, index: number) => void;
  } = {},
): Promise<DavidVoiceResponse> => {
  const responseLength = options.responseLength || 'short';
  const lengthInstruction = buildLengthInstruction(responseLength);

  throwIfAborted(options.signal);

  // Resolve identity + memory in the background with a hard time budget so
  // Supabase lookups can never delay David's spoken reply.
  const memoryContextPromise: Promise<{ userId: string | null; memory: DavidConversationMemory[] }> =
    resolveDavidMemoryUserId(options.userId)
      .then(async (userId) => ({ userId, memory: await getVoiceMemory(userId) }))
      .catch(() => ({ userId: null, memory: [] as DavidConversationMemory[] }));

  const memoryContext = await Promise.race([
    memoryContextPromise,
    waitFor(VOICE_MEMORY_WAIT_BUDGET_MS).then(() => null),
  ]);
  const memory = memoryContext?.memory || [];
  throwIfAborted(options.signal);

  const memoryUsedVerses = memory
    .map(item => item.verse_used)
    .filter((verse): verse is string => Boolean(verse));
  const combinedUsedVerses = Array.from(new Set([...(options.usedVerses || []), ...memoryUsedVerses]));
  const voiceContext = [
    buildVoiceConversationContext(history, memory),
    `Response length instruction: ${lengthInstruction}`,
  ].filter(Boolean).join('\n');

  // Map history to OpenAI format without mutating the user's actual words.
  const messages = history.map(h => ({
    role: h.role,
    content: h.content
  }));

  const latestUserMessage = [...history].reverse().find(message => message.role === 'user')?.content || '';
  const chatPayload = {
    messages,
    moodKey: options.moodKey,
    voiceContext,
    usedVerses: combinedUsedVerses,
    liveVoice: Boolean(options.liveVoice),
  };

  logApiRequest('POST /api/chat', {
    mode: 'json',
    messageCount: messages.length,
    latestUserPreview: previewText(latestUserMessage),
    exactLatestUserText: latestUserMessage,
    moodKey: options.moodKey || null,
    usedVerseCount: combinedUsedVerses.length,
    voiceContextLength: voiceContext.length,
    responseLength,
  });

  const wantsSentenceStream = typeof options.onSentence === 'function';

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: await buildChatRequestHeaders(),
    body: JSON.stringify(
      wantsSentenceStream ? { ...chatPayload, stream: true } : chatPayload,
    ),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    let errorMessage = errorBody;
    let parsedBody: any = null;
    try {
      parsedBody = JSON.parse(errorBody);
      errorMessage = parsedBody.message || parsedBody.error || errorBody;
    } catch {
      // Keep the raw body preview when the response is plain text.
    }
    logApiResponse('POST /api/chat', {
      ok: false,
      status: response.status,
      statusText: response.statusText,
      ...getResponseHeaders(response),
      bodyPreview: previewText(errorBody, 300),
    });
    throwIfLimitReached(response.status, parsedBody);
    throw new Error(errorMessage || `Failed to get chat response (${response.status})`);
  }

  // ---- streaming read -----------------------------------------------------
  // The server forbids the private [VERSE USED] footer while streaming, so the
  // verse reference is recovered from David's own words instead.
  let data: any;
  if (wantsSentenceStream) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('David could not open a voice stream.');

    const decoder = new TextDecoder();
    const sentences = createSentenceStream();
    let fullText = '';
    let emitted = 0;
    let buffered = '';

    const emit = (ready: string[]) => {
      for (const sentence of ready) {
        if (!sentence) continue;
        try {
          options.onSentence?.(sentence, emitted);
        } catch (callbackError) {
          console.log('[David Voice] Sentence handler threw; stream continues:', callbackError);
        }
        emitted += 1;
      }
    };

    streaming: while (true) {
      throwIfAborted(options.signal);
      const { done, value } = await reader.read();
      if (done) break;

      buffered += decoder.decode(value, { stream: true });
      // Only whole SSE lines are parseable; keep any partial tail for next read.
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break streaming;
        try {
          const parsed = JSON.parse(payload);
          if (parsed?.error) throw new Error(parsed.message || parsed.error);
          if (typeof parsed?.text === 'string') {
            fullText += parsed.text;
            emit(sentences.push(stripVerseFooterClient(fullText)));
          }
        } catch (parseError: any) {
          if (parseError?.message && !/JSON/i.test(parseError.message)) throw parseError;
          // A partial JSON line simply arrives complete on the next read.
        }
      }
    }

    emit(sentences.flush());

    const streamedText = stripVerseFooterClient(fullText);
    data = {
      text: streamedText,
      moodKey: options.moodKey || null,
      verseUsed: extractVerseReferences(streamedText)[0] || null,
      resetUsedVerses: false,
    };

    logApiResponse('POST /api/chat', {
      ok: true,
      mode: 'sentence_stream',
      status: response.status,
      sentenceCount: emitted,
      textLength: streamedText.length,
      textPreview: previewText(streamedText),
    });
  } else {
    data = await response.json();
  }

  logApiResponse('POST /api/chat', {
    ok: true,
    status: response.status,
    statusText: response.statusText,
    ...getResponseHeaders(response),
    textLength: typeof data.text === 'string' ? data.text.length : 0,
    textPreview: typeof data.text === 'string' ? previewText(data.text) : '',
    moodKey: data.moodKey || null,
    verseUsed: data.verseUsed || null,
    fallback: Boolean(data.fallback),
  });

  const text = data.text || '';
  const moodKey = data.moodKey || options.moodKey || null;
  const verseUsed = data.verseUsed || null;

  if (latestUserMessage && text && !options.signal?.aborted) {
    // Save memory fully in the background — speech playback never waits on this.
    void memoryContextPromise.then(({ userId: memoryUserId }) => {
      if (!memoryUserId) return;

      const memoryEntry: DavidConversationMemory = {
        user_id: memoryUserId,
        mood_key: moodKey,
        user_message: latestUserMessage,
        david_response: text,
        verse_used: verseUsed,
        opening_phrase: getOpeningPhrase(text),
        follow_up_question: getFollowUpQuestion(text),
        short_summary: `${moodKey || 'unknown mood'}: ${safeText(latestUserMessage, 180)} / verse: ${verseUsed || 'none'}`,
        created_at: new Date().toISOString(),
      };
      const cached = voiceMemoryCache.get(memoryUserId);
      voiceMemoryCache.set(memoryUserId, {
        memory: [memoryEntry, ...(cached?.memory || [])].slice(0, 10),
        expiresAt: Date.now() + 60_000,
        request: cached?.request,
      });
      void saveDavidConversationMemory(memoryEntry).catch((error) => {
        console.log('[David Memory] Save failed without blocking the live voice reply:', error);
      });
    });
  }

  return {
    text,
    moodKey,
    verseUsed,
    resetUsedVerses: Boolean(data.resetUsedVerses),
  };
};

import { createSentenceStream } from '../utils/sentenceStream.mjs';
import { extractVerseReferences } from '../utils/davidContinuity.mjs';

const VERSE_FOOTER_CLIENT_RE = /\s*\[VERSE USED:\s*[^\]]*\]\s*/gi;

const stripVerseFooterClient = (text: string): string =>
  text.replace(VERSE_FOOTER_CLIENT_RE, ' ').replace(/[ \t]{2,}/g, ' ').trim();

export const getChatResponseStream = async (
  history: ChatHistoryMessage[],
  onChunk: (text: string) => void,
  responseLength: ResponseLength = 'short',
  moodKey?: string,
  options: RequestOptions & { userId?: string | null } = {},
): Promise<string> => {
  const lengthInstruction = {
    short: "Text chat turn: 1-3 short sentences. Warm and plain. No lists, no greeting, no customer-support language.",
    medium: "Text chat turn: 2-4 short sentences. Meet the feeling first; share one verse only when it truly fits, and explain it like a friend would.",
    long: "Text chat turn: 3-5 short sentences max. Give the simple answer first, then stop. No sermon, no bullet list."
  }[responseLength];

  // Text chat gets the same long-term memory voice chat has, so David can
  // carry facts (a sick spouse, a job loss) across sessions. The lookup runs
  // with a time budget so a slow network never stalls the reply.
  const memoryContextPromise: Promise<{ userId: string | null; memory: DavidConversationMemory[] }> =
    resolveDavidMemoryUserId(options.userId)
      .then(async (userId) => ({ userId, memory: await getVoiceMemory(userId) }))
      .catch(() => ({ userId: null, memory: [] as DavidConversationMemory[] }));

  const memoryContext = await Promise.race([
    memoryContextPromise,
    waitFor(VOICE_MEMORY_WAIT_BUDGET_MS).then(() => null),
  ]);
  const memory = memoryContext?.memory || [];

  const memoryUsedVerses = memory
    .map(item => item.verse_used)
    .filter((verse): verse is string => Boolean(verse));

  const voiceContext = [
    buildVoiceConversationContext(history, memory),
    `Response length instruction: ${lengthInstruction}`,
  ].filter(Boolean).join('\n');

  const messages = history.map(h => ({
    role: h.role,
    content: h.content
  }));

  const latestUserMessage = [...history].reverse().find(message => message.role === 'user')?.content || '';
  const streamPayload = {
    messages,
    stream: true,
    moodKey,
    voiceContext,
    usedVerses: memoryUsedVerses,
    liveVoice: false,
  };

  logApiRequest('POST /api/chat', {
    mode: 'stream',
    messageCount: messages.length,
    latestUserPreview: previewText(latestUserMessage),
    moodKey: moodKey || null,
    voiceContextLength: voiceContext.length,
    responseLength,
  });

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: await buildChatRequestHeaders(),
    body: JSON.stringify(streamPayload),
    signal: options.signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    logApiResponse('POST /api/chat', {
      ok: false,
      mode: 'stream',
      status: response.status,
      statusText: response.statusText,
      ...getResponseHeaders(response),
      error,
    });
    throwIfLimitReached(response.status, error);
    throw new Error(error.message || error.error || `Failed to get chat stream (${response.status})`);
  }

  logApiResponse('POST /api/chat', {
    ok: true,
    mode: 'stream_start',
    status: response.status,
    statusText: response.statusText,
    ...getResponseHeaders(response),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  if (!reader) throw new Error("No reader");

  while (true) {
    throwIfAborted(options.signal);
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6);
        if (dataStr === '[DONE]') break;
        try {
          const data = JSON.parse(dataStr);
          fullText += data.text;
          onChunk(stripVerseFooterClient(fullText));
        } catch (e) {
          // Ignore parse errors for incomplete lines.
        }
      }
    }
  }

  const finalText = stripVerseFooterClient(fullText);

  logApiResponse('POST /api/chat', {
    ok: true,
    mode: 'stream_complete',
    textLength: finalText.length,
    textPreview: previewText(finalText),
  });

  // Persist the exchange so future sessions (text or voice) remember it.
  if (latestUserMessage && finalText && !options.signal?.aborted) {
    void memoryContextPromise.then(({ userId: memoryUserId }) => {
      if (!memoryUserId) return;

      const memoryEntry: DavidConversationMemory = {
        user_id: memoryUserId,
        mood_key: moodKey || null,
        user_message: latestUserMessage,
        david_response: finalText,
        verse_used: null,
        opening_phrase: getOpeningPhrase(finalText),
        follow_up_question: getFollowUpQuestion(finalText),
        short_summary: `${moodKey || 'unknown mood'}: ${safeText(latestUserMessage, 180)}`,
        created_at: new Date().toISOString(),
      };
      const cached = voiceMemoryCache.get(memoryUserId);
      voiceMemoryCache.set(memoryUserId, {
        memory: [memoryEntry, ...(cached?.memory || [])].slice(0, 10),
        expiresAt: Date.now() + 60_000,
        request: cached?.request,
      });
      void saveDavidConversationMemory(memoryEntry).catch((error) => {
        console.log('[David Memory] Save failed without blocking the chat reply:', error);
      });
    });
  }

  return finalText;
};

export const generateSpeech = async (
  text: string,
  options: GenerateSpeechOptions = {},
): Promise<string | null> => {
  // ---- speech gate: typed chat is silent, always ----
  // Checked before anything else so a refused call costs no network request.
  const verdict = canSpeak({ source: options.source, voiceModeActive });
  if (!verdict.allowed) {
    console.warn(`[Speech] ${verdict.reason} No audio was generated.`);
    return null;
  }

  throwIfAborted(options.signal);

  const speechText = options.alreadyPrepared
    ? text.trim()
    : options.skipHumanize
      ? sanitizeForDavidSpeech(text)
      : prepareDavidTtsPayload(text, {
        isGreeting: options.isGreeting,
      }).speechText;

  if (!speechText) return null;

  if (speechConfiguredCache === false) {
    return null;
  }

  throwIfAborted(options.signal);

  const speechPayload = {
    text: speechText,
  };

  logApiRequest('POST /api/speech', {
    textLength: speechText.length,
    textPreview: previewText(speechText),
    alreadyPrepared: Boolean(options.alreadyPrepared),
    skipHumanize: Boolean(options.skipHumanize),
    isGreeting: Boolean(options.isGreeting),
    source: options.source,
  });
  const response = await fetch('/api/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(speechPayload),
    signal: options.signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const details = `${error.details || error.error || ''}`;
    logApiResponse('POST /api/speech', {
      ok: false,
      status: response.status,
      statusText: response.statusText,
      ...getResponseHeaders(response),
      error,
    });

    if (response.status === 503 && error.code === 'voice_not_configured') {
      speechConfiguredCache = false;
      return null;
    }

    if (response.status === 401 || details.toLowerCase().includes('invalid_api_key')) {
      throw new Error('ElevenLabs rejected the current API key. David can respond in text, but voice audio cannot be generated yet.');
    }

    throw new Error(error.error || `David's voice audio could not be generated (${response.status}).`);
  }

  // Preferred path: stream the audio through MediaSource so playback can begin
  // while bytes are still downloading. Falls back to a fully-buffered blob URL
  // whenever streaming is unavailable (MediaSource unsupported, no body reader,
  // or codec not supported for this browser).
  const streamedUrl = tryCreateStreamingAudioUrl(response);
  if (streamedUrl) {
    logApiResponse('POST /api/speech', {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      ...getResponseHeaders(response),
      streaming: true,
    });
    return streamedUrl;
  }

  const blob = await response.blob();
  logApiResponse('POST /api/speech', {
    ok: true,
    status: response.status,
    statusText: response.statusText,
    ...getResponseHeaders(response),
    audioBytes: blob.size,
    streaming: false,
  });
  if (!blob.size) {
    throw new Error("David's voice audio came back empty.");
  }

  return URL.createObjectURL(blob);
};

/**
 * Build a `blob:`/MediaSource object URL that plays audio as chunks arrive.
 * Returns null (so the caller can fall back to a buffered blob) whenever the
 * environment cannot support progressive MP3 playback.
 */
const tryCreateStreamingAudioUrl = (response: Response): string | null => {
  try {
    if (typeof window === 'undefined') return null;
    const MediaSourceCtor: typeof MediaSource | undefined = (window as any).MediaSource;
    const mimeType = 'audio/mpeg';
    if (
      !MediaSourceCtor ||
      typeof MediaSourceCtor.isTypeSupported !== 'function' ||
      !MediaSourceCtor.isTypeSupported(mimeType) ||
      !response.body ||
      typeof response.body.getReader !== 'function'
    ) {
      return null;
    }

    const mediaSource = new MediaSourceCtor();
    const objectUrl = URL.createObjectURL(mediaSource);
    const reader = response.body.getReader();

    mediaSource.addEventListener('sourceopen', () => {
      let sourceBuffer: SourceBuffer;
      try {
        sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      } catch (err) {
        console.warn('[Speech] MediaSource addSourceBuffer failed; ending stream.', err);
        try { mediaSource.endOfStream(); } catch { /* noop */ }
        return;
      }

      const queue: Uint8Array[] = [];
      let streamDone = false;

      const flushQueue = () => {
        if (sourceBuffer.updating) return;
        if (queue.length > 0) {
          try {
            sourceBuffer.appendBuffer(queue.shift() as Uint8Array);
          } catch (err) {
            console.warn('[Speech] appendBuffer failed:', err);
          }
          return;
        }
        if (streamDone && mediaSource.readyState === 'open') {
          try { mediaSource.endOfStream(); } catch { /* noop */ }
        }
      };

      sourceBuffer.addEventListener('updateend', flushQueue);

      const pump = async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              streamDone = true;
              flushQueue();
              break;
            }
            if (value && value.byteLength) {
              queue.push(value);
              flushQueue();
            }
          }
        } catch (err) {
          console.warn('[Speech] Streaming pump failed:', err);
          streamDone = true;
          try {
            if (mediaSource.readyState === 'open') mediaSource.endOfStream();
          } catch { /* noop */ }
        }
      };

      void pump();
    }, { once: true });

    return objectUrl;
  } catch (err) {
    console.warn('[Speech] Falling back to buffered audio; MediaSource setup failed:', err);
    return null;
  }
};

export const transcribeAudio = async (
  audioBlob: Blob,
  options: RequestOptions = {},
): Promise<TranscribeAudioResult> => {
  throwIfAborted(options.signal);

  if (!audioBlob.size) {
    return { transcript: '', rejected: true, reason: 'audio_empty' };
  }

  logApiRequest('POST /api/transcribe', {
    audioBytes: audioBlob.size,
    audioType: audioBlob.type || 'audio/webm',
  });
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': audioBlob.type || 'audio/webm',
    },
    body: audioBlob,
    signal: options.signal,
  });

  const data = await response.json().catch(() => ({}));
  logApiResponse('POST /api/transcribe', {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    ...getResponseHeaders(response),
    transcriptLength: typeof data.transcript === 'string' ? data.transcript.length : 0,
    transcriptPreview: typeof data.transcript === 'string' ? previewText(data.transcript) : '',
    rejected: Boolean(data.rejected),
    reason: data.reason || null,
    error: data.error || null,
    message: data.message || null,
  });

  if (!response.ok) {
    throw new Error(data.message || data.error || `David could not hear that audio (${response.status}).`);
  }

  return {
    transcript: typeof data.transcript === 'string' ? data.transcript : '',
    rejected: Boolean(data.rejected),
    reason: typeof data.reason === 'string' ? data.reason : undefined,
  };
};
