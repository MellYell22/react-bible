import { GoogleGenAI, Type } from "@google/genai";
import { Scripture } from "../types";

const getAI = () => {
  const apiKey = 
    import.meta.env.VITE_GEMINI_API_KEY || 
    process.env.GEMINI_API_KEY || 
    (window as any).GEMINI_API_KEY || 
    "";
  
  return new GoogleGenAI({ apiKey });
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

  const ai = getAI();
  const model = "gemini-3-flash-preview";
  
  try {
    const response = await ai.models.generateContent({
      model,
      contents: `Provide a single, inspiring Bible verse for today (${today}) in the ${translation} translation. 
      Include the verse text, the reference (e.g., "John 3:16 (${translation})"), and a short, encouraging explanation (1-2 sentences).
      Ensure the verse is different from common ones if possible, but always uplifting.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            verse: { type: Type.STRING },
            reference: { type: Type.STRING },
            explanation: { type: Type.STRING }
          },
          required: ["verse", "reference", "explanation"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    if (result.verse && result.reference) {
      localStorage.setItem(cacheKey, JSON.stringify(result));
      return result;
    }
  } catch (error) {
    console.error('Error fetching verse from Gemini:', error);
  }

  // Fallback deterministic verse if AI fails
  const fallbacks: Scripture[] = [
    { verse: "For I know the plans I have for you,” declares the Lord, “plans to prosper you and not to harm you, plans to give you hope and a future.", reference: `Jeremiah 29:11 (${translation})`, explanation: "God has a beautiful purpose for your life, even when things feel uncertain." },
    { verse: "I can do all this through him who gives me strength.", reference: `Philippians 4:13 (${translation})`, explanation: "Your strength doesn't come from yourself, but from the One who sustains you." },
    { verse: "The Lord is my shepherd, I lack nothing.", reference: `Psalm 23:1 (${translation})`, explanation: "You are fully provided for and guided by the Good Shepherd." }
  ];
  
  // Use date hash to pick a fallback
  const dateHash = today.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const fallback = fallbacks[dateHash % fallbacks.length];
  return fallback;
};
