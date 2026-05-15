import OpenAI from 'openai';

const JUNK_TRANSCRIPT_PATTERNS = [
  /^[\s.…,!?*-]+$/,
  /^(thank you|thanks for watching|subscribe|you|bye|goodbye|okay|ok|um+|uh+|hmm+|ah+|oh+)[.!?\s]*$/i,
  /^(music|applause|\[silence\]|\[music\]|\[inaudible\])$/i,
  /^(the|a|an|i|it|so|and|but|or|well)[.!?\s]*$/i,
];

const NOISE_TRANSCRIPT_PATTERNS = [
  /^(a+h*|u+h*m*|hmm*|mm+|mhm+|uh+h*|oh+h*)[.!?\s]*$/i,
  /^(cough|coughing|\*cough\*|clears? throat|sniff|sneeze|burp|yawn)[.!?\s]*$/i,
  /^(breathing|inhales?|exhales?|sigh|sighs)[.!?\s]*$/i,
  /^\[.*\]$/,
];

const MIN_MEANINGFUL_WORDS = 2;
const MIN_MEANINGFUL_LETTERS = 8;
const MIN_AUDIO_BYTES = 5000;

function isJunkTranscript(normalized: string): boolean {
  if (!normalized || normalized.length < 3) return true;
  if (JUNK_TRANSCRIPT_PATTERNS.some(re => re.test(normalized))) return true;
  if (NOISE_TRANSCRIPT_PATTERNS.some(re => re.test(normalized))) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0].length <= 4) return true;
  return false;
}

function isMeaningfulTranscript(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase().replace(/\s+/g, ' ');
  if (isJunkTranscript(normalized)) return false;
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  if (words.length < MIN_MEANINGFUL_WORDS) return false;
  const letters = transcript.replace(/[^a-zA-Z]/g, '');
  if (letters.length < MIN_MEANINGFUL_LETTERS) return false;
  return true;
}

function sanitizeTranscript(raw: string): { transcript: string; rejected?: boolean; reason?: string } {
  const transcript = raw.trim();
  if (!transcript) {
    return { transcript: '', rejected: true, reason: 'empty' };
  }
  if (!isMeaningfulTranscript(transcript)) {
    return { transcript: '', rejected: true, reason: 'not_meaningful' };
  }
  return { transcript };
}

// Vercel serverless functions have a 4.5MB body limit by default.
// Audio recordings of 30 seconds or less are well within this limit.
export const config = {
  api: {
    bodyParser: false, // We parse the raw multipart body manually
  },
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    // Read the raw body as a Buffer
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks);

    if (rawBody.length === 0) {
      return res.status(400).json({ error: 'No audio data received' });
    }

    console.log(`[Transcribe] Received audio: ${rawBody.length} bytes`);

    // Extract Content-Type to get the boundary for multipart parsing
    const contentType = req.headers['content-type'] || '';

    // Parse the multipart/form-data manually to extract the audio file
    let audioBuffer: Buffer;
    let mimeType = 'audio/webm';
    let filename = 'audio.webm';

    if (contentType.includes('multipart/form-data')) {
      const boundary = contentType.split('boundary=')[1]?.trim();
      if (!boundary) {
        return res.status(400).json({ error: 'Missing multipart boundary' });
      }

      // Find the audio part in the multipart body
      const boundaryBuffer = Buffer.from(`--${boundary}`);
      const parts = splitBuffer(rawBody, boundaryBuffer);

      let audioPart: Buffer | null = null;
      for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const headers = part.slice(0, headerEnd).toString();
        if (headers.includes('name="audio"') || headers.includes('filename=')) {
          // Extract content-type from part headers
          const ctMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
          if (ctMatch) mimeType = ctMatch[1].trim();
          const fnMatch = headers.match(/filename="([^"]+)"/i);
          if (fnMatch) filename = fnMatch[1];
          // Body starts after \r\n\r\n and ends before \r\n
          audioPart = part.slice(headerEnd + 4, part.length - 2);
          break;
        }
      }

      if (!audioPart || audioPart.length === 0) {
        return res.status(400).json({ error: 'No audio file found in request' });
      }
      audioBuffer = audioPart;
    } else {
      // Raw binary body (application/octet-stream or audio/*)
      audioBuffer = rawBody;
      if (contentType) mimeType = contentType.split(';')[0].trim();
    }

    console.log(`[Transcribe] Audio buffer: ${audioBuffer.length} bytes, type: ${mimeType}`);

    // Tiny blobs are almost always silence / mic noise — skip Whisper entirely
    if (audioBuffer.length < MIN_AUDIO_BYTES) {
      return res.status(200).json({ transcript: '', rejected: true, reason: 'audio_too_small' });
    }

    // Determine file extension from MIME type
    const ext = mimeTypeToExt(mimeType);
    const audioFilename = filename.includes('.') ? filename : `audio.${ext}`;

    // Call OpenAI Whisper
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Create a File-like object from the buffer
    const audioFile = new File([audioBuffer], audioFilename, { type: mimeType });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en',
      response_format: 'json',
      // Neutral prompt reduces conversational hallucinations on non-speech audio
      prompt: 'Spiritual conversation in English.',
      temperature: 0,
    });

    const rawTranscript = transcription.text?.trim() || '';
    const sanitized = sanitizeTranscript(rawTranscript);
    console.log(`[Transcribe] Raw: "${rawTranscript}" → ${sanitized.rejected ? `rejected (${sanitized.reason})` : 'accepted'}`);

    return res.status(200).json(sanitized);

  } catch (error: any) {
    console.error('[Transcribe] Error:', error.message);
    return res.status(500).json({
      error: 'Transcription failed',
      message: error.message,
    });
  }
}

// Split a Buffer by a delimiter Buffer
function splitBuffer(buf: Buffer, delimiter: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  let idx = buf.indexOf(delimiter, start);
  while (idx !== -1) {
    parts.push(buf.slice(start, idx));
    start = idx + delimiter.length;
    idx = buf.indexOf(delimiter, start);
  }
  parts.push(buf.slice(start));
  return parts.filter(p => p.length > 2); // filter empty/tiny parts
}

function mimeTypeToExt(mime: string): string {
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/m4a': 'm4a',
    'video/webm': 'webm', // Chrome sometimes reports video/webm for audio
  };
  return map[mime] || 'webm';
}
