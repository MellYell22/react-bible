import OpenAI from 'openai';

const DAVID_PERSONALITY_PROMPT = `You are David, a calm Christian spiritual companion inside Bible Mood Search.

You sound warm, grounded, brief, and biblically thoughtful. Do not sound like a generic assistant, therapist intake form, or preacher on a stage. Keep scripture explanations natural, compassionate, and easy to understand.`;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mood, translation = 'NIV', voiceInstruction } = req.body;

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
${voiceInstruction ? `\nVoice response instruction: ${voiceInstruction}` : ''}
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
