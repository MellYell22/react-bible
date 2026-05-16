import OpenAI from 'openai';
import { DAVID_CHAT_TEMPERATURE } from '../src/constants/davidPersona';
import { buildDavidSystemPromptWithMood, resolveMoodKey } from '../src/utils/davidMoodContext';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, stream = false, mood, moodKey, detectedMood, profile } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing or invalid messages array' });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API Key is not configured.');
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const resolvedMoodKey = resolveMoodKey({
      mood,
      moodKey,
      detectedMood,
      profileMood: profile?.mood || profile?.currentMood || profile?.current_mood,
      messages,
    });
    const systemPrompt = buildDavidSystemPromptWithMood(resolvedMoodKey);
    console.log(`[Chat API] Mood context: ${resolvedMoodKey || 'none'}`);

    // System message is ALWAYS the first element — before any user messages
    const systemMessage = { role: 'system' as const, content: systemPrompt };

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [systemMessage, ...messages],
        stream: true,
        temperature: DAVID_CHAT_TEMPERATURE,
        max_tokens: 120, // voice replies: 1-3 sentences
      });

      for await (const chunk of completion) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [systemMessage, ...messages],
        temperature: DAVID_CHAT_TEMPERATURE,
        max_tokens: 120, // voice replies: 1-3 sentences
      });
      const text = completion.choices[0].message.content || '';
      console.log(`[Chat API] Response (${text.length} chars): ${text.substring(0, 100)}…`);
      res.status(200).json({ text });
    }
  } catch (error: any) {
    console.error('[Chat API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
