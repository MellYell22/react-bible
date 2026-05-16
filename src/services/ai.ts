import { MoodResponse, ResponseLength, Scripture } from "../types";
import { prepareDavidTtsPayload } from "../utils/davidSpeechDelivery";

export type GenerateSpeechOptions = {
  isGreeting?: boolean;
  /** Set when text was already passed through humanizeForTts */
  skipHumanize?: boolean;
};

export const getMoodScriptures = async (mood: string, translation: string = 'NIV', responseLength: ResponseLength = 'short'): Promise<MoodResponse> => {
  console.log("OPENAI REQUEST SENT - Mood Scriptures");
  const response = await fetch('/api/mood-scriptures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mood, translation, responseLength })
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

export const getChatResponse = async (
  history: ChatHistoryMessage[],
  responseLength: ResponseLength = 'short',
  moodKey?: string,
): Promise<string> => {
  const lengthInstruction = {
    short: "Reply in 1-2 short lines. Sound like a real person talking — use ellipsis pauses sometimes (hey… / yeah…). Imperfect, not polished. No therapy phrases.",
    medium: "Reply in 2-3 short sentences with varied rhythm. Natural pauses via ellipsis okay. Stay grounded. No validation loops.",
    long: "Reply in 3 short sentences max. Conversational and alive — not scripted. Ellipsis pauses okay. No corporate empathy."
  }[responseLength];

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
    body: JSON.stringify({ messages, moodKey })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get chat response');
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
    short: "Reply in 1-2 short lines. Sound like a real person talking — use ellipsis pauses sometimes (hey… / yeah…). Imperfect, not polished. No therapy phrases.",
    medium: "Reply in 2-3 short sentences with varied rhythm. Natural pauses via ellipsis okay. Stay grounded. No validation loops.",
    long: "Reply in 3 short sentences max. Conversational and alive — not scripted. Ellipsis pauses okay. No corporate empathy."
  }[responseLength];

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
    body: JSON.stringify({ messages, stream: true, moodKey })
  });

  if (!response.ok) {
    throw new Error('Failed to get chat stream');
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
  const { ssmlText, enableSsmlParsing } = prepareDavidTtsPayload(text, {
    isGreeting: options.isGreeting,
    force: options.skipHumanize,
  });
  try {
    const response = await fetch('/api/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: ssmlText,
        enable_ssml_parsing: enableSsmlParsing,
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

