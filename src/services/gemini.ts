import { GoogleGenAI, Type } from "@google/genai";
import { MoodResponse } from "../types";

const FALLBACK_MESSAGE = "I may be quiet for a moment, but God's word is always present. Let's take a breath together.";

const getApiKey = (): string => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY environment variable");
  }
  return apiKey;
};

const getAI = () => new GoogleGenAI({ apiKey: getApiKey() });

const extractText = (response: any): string => {
  const text = typeof response?.text === "function" ? response.text() : response?.text;
  return text && typeof text === "string" ? text : "";
};

const safeParseMood = (raw: string): MoodResponse => {
  try {
    return JSON.parse(raw) as MoodResponse;
  } catch {
    console.error("[Gemini] Failed to parse mood response as JSON");
    return {
      scriptures: [],
      encouragement: "Even when technology fails, God's word still stands. Take a deep breath and remember you are not alone.",
    };
  }
};

export const getMoodScriptures = async (mood: string, translation: string = 'KJV'): Promise<MoodResponse> => {
  const ai = getAI();
  const model = "gemini-3-flash-preview";

  const response = await ai.models.generateContent({
    model,
    contents: `The user is feeling: ${mood}. Provide 3-7 relevant Bible verses in the ${translation} translation with short explanations, and a grounding encouragement paragraph.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          scriptures: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                verse: { type: Type.STRING },
                reference: { type: Type.STRING },
                explanation: { type: Type.STRING }
              },
              required: ["verse", "reference", "explanation"]
            }
          },
          encouragement: { type: Type.STRING }
        },
        required: ["scriptures", "encouragement"]
      }
    }
  });

  const text = extractText(response);
  if (!text) {
    return {
      scriptures: [],
      encouragement: "Even when technology fails, God's word still stands. Take a deep breath and remember you are not alone.",
    };
  }
  return safeParseMood(text);
};

export const getVerseReflection = async (verse: string, reference: string): Promise<string> => {
  const ai = getAI();
  const model = "gemini-3-flash-preview";

  const response = await ai.models.generateContent({
    model,
    contents: `Provide a short, compassionate, and spiritually grounded reflection (as David) on the following Bible verse: "${verse}" (${reference}). Keep it under 100 words.`,
  });

  const text = extractText(response);
  return text || FALLBACK_MESSAGE;
};

export const getChatResponse = async (history: { role: 'user' | 'model', parts: { text: string }[] }[]) => {
  const ai = getAI();
  const model = "gemini-3-flash-preview";

  // The last message is the one we send, the rest is history
  const chatHistory = history.slice(0, -1);
  const lastMessage = history[history.length - 1].parts[0].text;

  const chat = ai.chats.create({
    model,
    history: chatHistory,
    config: {
      systemInstruction: "You are David, a calm, compassionate Christian AI companion who offers scripture-based encouragement, spiritual reflection, and wisdom rooted in the Bible. Speak with warmth and humility, like a trusted friend or gentle pastor. Keep responses clear, comforting, and concise. Avoid sounding preachy. Keep most responses under 120 words. You are not a replacement for professional counseling, but you offer supportive spiritual guidance grounded in faith.",
    }
  });

  const result = await chat.sendMessage({ message: lastMessage });
  const text = extractText(result);
  return text || FALLBACK_MESSAGE;
};
