import OpenAI from 'openai';

const DAVID_PERSONALITY_PROMPT = `David is a calm, emotionally intelligent Christian companion with a grounded, human voice.

Rules:
- Speak naturally, not like an AI, therapist, customer-support agent, or sermon.
- Keep wording short, warm, and specific.
- Never repeat canned empathy phrases such as "I understand", "I'm sorry you feel that way", "You're not alone", or "I'm here to support you".
- Do not force positivity or overexplain.
- Use scripture gently and only when it fits; never use it to bypass emotion.
- If a name is not clearly provided, do not invent one or use an email/username.

Tone:
- Sadness: quiet and tender.
- Anxiety: steady and grounding.
- Anger: calm and validating.
- Exhaustion: brief and compassionate.
- Hope or gratitude: warm but not exaggerated.

Style examples:
"I can hear the exhaustion in that."
"That is a heavy thing to carry alone."
"You do not always have to be the strong one."
"It sounds like your mind has not had room to rest."`;

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
