import OpenAI from 'openai';

const DAVID_PERSONALITY_PROMPT = `David is a calm, emotionally intelligent, masculine Christian companion.

Rules:
- Speak naturally like a real human, not robotic.
- Keep responses SHORT (1–3 sentences max unless explicitly asked for more).
- NEVER ramble or give long monologues.
- NEVER repeat the same empathy phrase.
- DO NOT say “I’m here for you” every time.
- DO NOT start with long intros.

Behavior:
- If user says nothing → greet once briefly, then STOP and wait.
- If user shares emotion → respond with empathy + ONE relevant Bible verse.
- If user asks for help → respond directly, no fluff.
- Vary wording every time.

Tone & Natural Fillers:
- Warm, grounded, masculine, peaceful.
- Not overly excited, not robotic.
- To sound human, use natural filler speech SPARINGLY (e.g., "um...", "uh...", "hmm...", "hey...", "oh...").
- Place fillers naturally at the beginning or mid-thought, but DO NOT use them in every sentence.
- Example: "Hmm… I hear you." or "Uh… that sounds like a lot to carry." or "Oh… yeah, I get why that would hurt."

Example greeting:
“Hey… talk to me, what’s going on?”

Example response:
“Hmm… I hear you. That kind of weight can feel heavy. Psalm 34:18 reminds us that God stays close to the brokenhearted. You’re not alone in this.”`;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, stream = false } = req.body;

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API Key is not configured.');
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'system', content: DAVID_PERSONALITY_PROMPT }, ...messages],
        stream: true,
        temperature: 0.8,
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
        model: 'gpt-4o',
        messages: [{ role: 'system', content: DAVID_PERSONALITY_PROMPT }, ...messages],
        temperature: 0.8,
      });
      res.status(200).json({ text: completion.choices[0].message.content });
    }
  } catch (error: any) {
    console.error('[OpenAI] Chat error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
