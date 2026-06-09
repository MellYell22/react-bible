import { MoodResponse, ResponseLength, Scripture } from "../types";
import {
  prepareDavidTtsPayload,
  sanitizeForDavidSpeech,
} from "../utils/davidSpeechDelivery";
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
};

let speechConfiguredCache: boolean | null = null;

const isSpeechConfigured = async (): Promise<boolean> => {
  if (speechConfiguredCache !== null) return speechConfiguredCache;

  try {
    const response = await fetch('/api/health');
    if (!response.ok) return true;

    const data = await response.json();
    const configured = data?.configured?.ELEVENLABS_API_KEY !== false;
    speechConfiguredCache = configured;
    return configured;
  } catch {
    return true;
  }
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

export const getVerseReflection = async (verse: string, reference: string): Promise<string> => {
  console.log("OPENAI REQUEST SENT - Reflection");
  const response = await fetch('/api/reflection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verse, reference })
  });

  if (!response.ok) {
    throw new Error("Failed to generate reflection.");
  }

  console.log("OPENAI RESPONSE RECEIVED - Reflection");
  const data = await response.json();
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
    buildMemorySummary(memory),
    'Continue the live voice conversation. Follow the user\'s current direction, avoid restarting, and keep the next spoken turn short.',
    'Use varied wording, varied scripture lead-ins, and varied endings.'
  ].filter(Boolean).join('\n');
};

const getFriendlyApiErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  const error = await response.json().catch(() => ({}));
  const rawMessage = error.message || error.details || error.error || '';

  if (response.status === 429) {
    return "David needs a moment before answering again. Give it a little time, then try once more.";
  }

  if (response.status >= 500) {
    return "David is having trouble connecting right now. Your keys stay private on the server, but the backend could not finish this request.";
  }

  return rawMessage || fallback;
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
  } = {},
): Promise<DavidVoiceResponse> => {
  const responseLength = options.responseLength || 'short';
  const lengthInstruction = {
    short: "Voice turn: use the required David scripture flow, but keep every sentence warm and simple. Vary the wording.",
    medium: "Voice turn: sound human and unscripted. Acknowledge, use scripture naturally, give one short reflection, and only ask a gentle question if it truly fits.",
    long: "Voice turn: full David scripture flow, conversational and pastoral, no list formatting. Avoid recycled openings and repeated question endings."
  }[responseLength];

  const memoryUserId = await resolveDavidMemoryUserId(options.userId);
  const memory = memoryUserId ? await getDavidConversationMemory(memoryUserId, 10) : [];
  const memoryUsedVerses = memory
    .map(item => item.verse_used)
    .filter((verse): verse is string => Boolean(verse));
  const combinedUsedVerses = Array.from(new Set([...(options.usedVerses || []), ...memoryUsedVerses]));
  const voiceContext = buildVoiceConversationContext(history, memory);

  // Map history to OpenAI format (Gemini uses 'model', OpenAI uses 'assistant')
  const messages = history.map(h => ({
    role: h.role,
    content: h.content
  }));

  // Append length instruction to the last message to guide OpenAI
  if (messages.length > 0) {
    messages[messages.length - 1].content += `\n\n[Instruction: ${lengthInstruction}]`;
  }

  console.log("OPENAI REQUEST SENT - Chat");
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      moodKey: options.moodKey,
      voiceContext,
      usedVerses: combinedUsedVerses,
    })
  });

  if (!response.ok) {
    throw new Error(await getFriendlyApiErrorMessage(response, `Failed to get chat response (${response.status})`));
  }

  console.log("OPENAI RESPONSE RECEIVED - Chat");
  const data = await response.json();
  const text = data.text || '';
  const moodKey = data.moodKey || options.moodKey || null;
  const verseUsed = data.verseUsed || null;
  const latestUserMessage = [...history].reverse().find(message => message.role === 'user')?.content || '';

  if (memoryUserId && latestUserMessage && text) {
    await saveDavidConversationMemory({
      user_id: memoryUserId,
      mood_key: moodKey,
      user_message: latestUserMessage,
      david_response: text,
      verse_used: verseUsed,
      opening_phrase: getOpeningPhrase(text),
      follow_up_question: getFollowUpQuestion(text),
      short_summary: `${moodKey || 'unknown mood'}: ${safeText(latestUserMessage, 180)} / verse: ${verseUsed || 'none'}`,
    });
  }

  return {
    text,
    moodKey,
    verseUsed,
    resetUsedVerses: Boolean(data.resetUsedVerses),
  };
};

export const getChatResponseStream = async (
  history: ChatHistoryMessage[],
  onChunk: (text: string) => void,
  responseLength: ResponseLength = 'short',
  moodKey?: string,
): Promise<string> => {
  const lengthInstruction = {
    short: "Voice turn: 6-28 words when possible. One natural spoken beat, maybe two. No lists, no greeting, no customer-support language.",
    medium: "Voice turn: 1-2 short sentences. Human rhythm, modest pauses, no polished paragraph, no validation formula.",
    long: "Voice turn: 2-3 short sentences max. Give the simple answer first, then stop. No sermon, no bullet list."
  }[responseLength];

  const voiceContext = buildVoiceConversationContext(history);

  const messages = history.map(h => ({
    role: h.role,
    content: h.content
  }));

  if (messages.length > 0) {
    messages[messages.length - 1].content += `\n\n[Instruction: ${lengthInstruction}]`;
  }

  console.log("OPENAI REQUEST SENT - Chat Stream");
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: true, moodKey, voiceContext })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || `Failed to get chat stream (${response.status})`);
  }

  console.log("OPENAI RESPONSE RECEIVED - Chat Stream Start");

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  if (!reader) throw new Error("No reader");

  while (true) {
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
          onChunk(fullText);
        } catch (e) {
          // Ignore parse errors for incomplete lines
        }
      }
    }
  }

  return fullText;
};

export const generateSpeech = async (
  text: string,
  options: GenerateSpeechOptions = {},
): Promise<string | null> => {
  const speechText = options.alreadyPrepared
    ? text.trim()
    : options.skipHumanize
      ? sanitizeForDavidSpeech(text)
      : prepareDavidTtsPayload(text, {
        isGreeting: options.isGreeting,
      }).speechText;

  if (!speechText) return null;

  if (!(await isSpeechConfigured())) {
    return null;
  }

  const response = await fetch('/api/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: speechText,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const details = `${error.details || error.error || ''}`;

    if (response.status === 503 && error.code === 'voice_not_configured') {
      speechConfiguredCache = false;
      return null;
    }

    if (response.status === 401 || details.toLowerCase().includes('invalid_api_key')) {
      throw new Error('ElevenLabs rejected the current API key. David can respond in text, but voice audio cannot be generated yet.');
    }

    throw new Error(error.error || `David's voice audio could not be generated (${response.status}).`);
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error("David's voice audio came back empty.");
  }

  return URL.createObjectURL(blob);
};

export const transcribeAudio = async (audioBlob: Blob): Promise<TranscribeAudioResult> => {
  if (!audioBlob.size) {
    return { transcript: '', rejected: true, reason: 'audio_empty' };
  }

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': audioBlob.type || 'audio/webm',
    },
    body: audioBlob,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || `David could not hear that audio (${response.status}).`);
  }

  return {
    transcript: typeof data.transcript === 'string' ? data.transcript : '',
    rejected: Boolean(data.rejected),
    reason: typeof data.reason === 'string' ? data.reason : undefined,
  };
};
