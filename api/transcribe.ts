import { isMeaningfulTranscript } from '../src/utils/voiceTranscript.mjs';
import OpenAI from 'openai';
import {
  getOpenAIApiKey,
  getPublicOpenAIErrorMessage,
  logOpenAIError,
  OPENAI_API_KEY_ENV_NAME,
} from '../lib/openaiEnv.js';

const MIN_AUDIO_BYTES = 5000;

function previewLogText(value: string, maxLength = 180): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
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
    const openaiApiKey = getOpenAIApiKey();
    if (!openaiApiKey) {
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
    const openai = new OpenAI({ apiKey: openaiApiKey });

    // Create a File-like object from the buffer
    const audioFile = new File([audioBuffer], audioFilename, { type: mimeType });

    const transcriptionPrompt =
      'Spiritual conversation in English. Transcribe only clear intentional spoken words from the user. Ignore silence, coughing, sniffing, sneezing, laughing, throat clearing, sighing, breathing, filler sounds, music, television, and other background noise.';

    console.log('[API Request] OpenAI audio.transcriptions.create', {
      model: 'whisper-1',
      language: 'en',
      responseFormat: 'verbose_json',
      prompt: transcriptionPrompt,
      temperature: 0,
      filename: audioFilename,
      mimeType,
      audioBytes: audioBuffer.length,
    });
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en',
      // verbose_json exposes per-segment confidence so we can drop background
      // audio (TV, music, distant conversation) that Whisper transcribes as
      // fluent English but was never directed at David.
      response_format: 'verbose_json',
      prompt: transcriptionPrompt,
      temperature: 0,
    });

    // Keep only segments Whisper is confident are real, foreground speech.
    // no_speech_prob is high for background audio and music; avg_logprob is
    // very low for mumbled/distant speech the user did not say into the mic.
    const segments = Array.isArray((transcription as any).segments)
      ? (transcription as any).segments as Array<{ text?: string; no_speech_prob?: number; avg_logprob?: number }>
      : null;

    let rawTranscript: string;
    if (segments && segments.length > 0) {
      const confident = segments.filter((segment) => {
        const noSpeechProb = typeof segment.no_speech_prob === 'number' ? segment.no_speech_prob : 0;
        const avgLogprob = typeof segment.avg_logprob === 'number' ? segment.avg_logprob : 0;
        return noSpeechProb < 0.4 && avgLogprob > -0.85;
      });
      const dropped = segments.length - confident.length;
      if (dropped > 0) {
        console.log(`[Transcribe] Dropped ${dropped}/${segments.length} low-confidence segments (likely background audio)`);
      }
      rawTranscript = confident.map((segment) => (segment.text || '').trim()).filter(Boolean).join(' ').trim();
    } else {
      rawTranscript = transcription.text?.trim() || '';
    }
    const sanitized = sanitizeTranscript(rawTranscript);
    console.log('[API Response] OpenAI audio.transcriptions.create', {
      transcriptLength: rawTranscript.length,
      transcriptPreview: previewLogText(rawTranscript),
      rejected: Boolean(sanitized.rejected),
      reason: sanitized.reason || null,
    });
    console.log(`[Transcribe] Raw: "${rawTranscript}" → ${sanitized.rejected ? `rejected (${sanitized.reason})` : 'accepted'}`);

    return res.status(200).json(sanitized);

  } catch (error: any) {
    logOpenAIError('Transcription', error);
    return res.status(500).json({
      error: 'Transcription failed',
      message: getPublicOpenAIErrorMessage(error),
      envName: OPENAI_API_KEY_ENV_NAME,
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
