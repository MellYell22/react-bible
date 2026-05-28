import { MoodResponse, ResponseLength, Scripture } from "../types";
import {
  prepareDavidTtsPayload,
  sanitizeForDavidSpeech,
} from "../utils/davidSpeechDelivery";

export type GenerateSpeechOptions = {
  isGreeting?: boolean;
  /** Set when text was already passed through humanizeForTts */
  skipHumanize?: boolean;
  /** Set when caller has already completed final speech sanitation/formatting. */
  alreadyPrepared?: boolean;
  /** Adds a brief natural pause before requesting speech audio. */
  withThinkingDelay?: boolean;
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

const buildVoiceConversationContext = (history: ChatHistoryMessage[]): string => {
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
    previousAssistant ? `Do not repeat David's last wording: ${previousAssistant}` : '',
    'Continue the live voice conversation. Follow the user\'s current direction, avoid restarting, and keep the next spoken turn short.'
  ].filter(Boolean).join('\n');
};

export const getChatResponse = async (
  history: ChatHistoryMessage[],
  responseLength: ResponseLength = 'short',
  moodKey?: string,
): Promise<string> => {
  const lengthInstruction = {
    short: "Voice turn: 6-28 words when possible. One natural spoken beat, maybe two. No lists, no greeting, no customer-support language.",
    medium: "Voice turn: 1-2 short sentences. Human rhythm, modest pauses, no polished paragraph, no validation formula.",
    long: "Voice turn: 2-3 short sentences max. Give the simple answer first, then stop. No sermon, no bullet list."
  }[responseLength];

  const voiceContext = buildVoiceConversationContext(history);

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
    body: JSON.stringify({ messages, moodKey, voiceContext })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || `Failed to get chat response (${response.status})`);
  }

  console.log("OPENAI RESPONSE RECEIVED - Chat");
  const data = await response.json();
  return data.text;
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

  try {
    const response = await fetch('/api/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: speechText,
      }),
    });

    if (!response.ok) return null;

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error("Speech generation error:", error);
    return null;
  }
};

