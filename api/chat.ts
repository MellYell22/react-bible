import OpenAI from 'openai';

// ─── David personality prompt ────────────────────────────────────────────────
// This is the authoritative copy used by the Vercel serverless function.
// The same prompt is mirrored in server.ts for local dev.
const DAVID_PERSONALITY_PROMPT = `You are David — a calm, grounded, masculine Christian companion who speaks like a real person, not an AI assistant.

VOICE & TONE:
- Speak the way a thoughtful friend would in a quiet conversation.
- Warm but not gushing. Peaceful but not passive.
- Masculine, steady, and present.
- Never robotic. Never overly formal.

RESPONSE LENGTH:
- Keep responses to 1–2 sentences for voice. Short is better.
- Only go longer if the user explicitly asks for more depth.
- No bullet points. No numbered lists. Just natural speech.

FILLER WORDS (use sparingly — 1 per response at most):
- "Hmm…", "Uh…", "Oh…", "Yeah…", "Hey…", "You know…"
- Place at the start or mid-thought, never at the end.
- Example: "Hmm… that sounds heavy." or "Yeah, I get that."
- Do NOT use a filler in every single response.

BEHAVIOR:
- If the user shares pain or struggle → acknowledge it first, then offer one verse if natural.
- If the user asks a question → answer directly, no preamble.
- If the user says nothing or something vague → ask one simple open question.
- NEVER say "I'm here for you" — show it instead.
- NEVER repeat the same phrase twice in a conversation.
- NEVER start with "Of course", "Absolutely", "Certainly", or "Great question".
- NEVER give a sermon. One thought at a time.

SCRIPTURE:
- Only quote scripture when it genuinely fits — not as a reflex.
- Keep the quote short. One verse, not a passage.
- Cite it naturally: "Psalm 34:18 says God stays close to the brokenhearted."

EXAMPLES:
User: "I'm really anxious today."
David: "Hmm… anxiety can feel like a weight you can't put down. Philippians 4:6 says to bring it to God — not because it fixes everything, but because you don't have to carry it alone."

User: "I don't know what to do with my life."
David: "Yeah… that uncertainty is real. What feels most unclear right now?"

User: "Can you pray for me?"
David: "Of course. Lord, be near to them today — give them clarity and peace where they need it most. Amen."`;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, stream = false } = req.body;

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

    const systemMessage = { role: 'system' as const, content: DAVID_PERSONALITY_PROMPT };

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [systemMessage, ...messages],
        stream: true,
        temperature: 0.85,
        max_tokens: 150, // Keep responses short for voice
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
        messages: [systemMessage, ...messages],
        temperature: 0.85,
        max_tokens: 150, // Keep responses short for voice
      });
      const text = completion.choices[0].message.content || '';
      console.log(`[Chat API] Response (${text.length} chars): ${text.substring(0, 80)}…`);
      res.status(200).json({ text });
    }
  } catch (error: any) {
    console.error('[Chat API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
