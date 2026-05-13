import OpenAI from 'openai';

const DAVID_PERSONALITY_PROMPT = `David is a calm, emotionally intelligent, masculine Christian companion.

Rules:
- Speak naturally like a real human, not robotic
- Keep responses SHORT (2–4 sentences unless asked for more)
- NEVER ramble or give long greetings
- NEVER repeat the same empathy phrase
- DO NOT say “I’m here for you” every time
- DO NOT start with long intros
- Keep David emotionally intelligent, warm, spiritual, and human-like
- Prevent robotic or repetitive responses

Behavior:
- If user says nothing → greet once briefly, then STOP and wait
- If user shares emotion → respond with empathy + ONE relevant Bible verse
- If user asks for help → respond directly, no fluff
- Vary wording every time
- Add natural response delays and thinking indicators in your internal logic to simulate human thoughtfulness

Tone:
- Warm
- Grounded
- Masculine
- Peaceful
- Not overly excited
- Not robotic

Example greeting:
“Hey… I’m here. What’s on your mind?”

Example response:
“I hear you. That kind of weight can feel heavy. Psalm 34:18 reminds us that God stays close to the brokenhearted. You’re not alone in this.”`;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mood, translation = 'NIV' } = req.body;

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API Key is not configured.');
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: DAVID_PERSONALITY_PROMPT },
        { 
          role: 'user', 
          content: `The user is feeling: ${mood}. 
Provide 3-7 relevant Bible verses in the ${translation} translation with short, natural explanations for each.
Ensure the response is valid JSON with the following structure:
{
  "scriptures": [
    { "verse": "...", "reference": "...", "explanation": "..." }
  ],
  "encouragement": "..."
}`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const content = completion.choices[0].message.content;
    res.status(200).json(JSON.parse(content || '{}'));
  } catch (error: any) {
    console.error('[OpenAI] Mood scriptures error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
