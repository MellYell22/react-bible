// Shared by both transcription endpoints and the microphone client. Content
// need not mention a mood: greetings, questions and brief answers are turns.
const noisePatterns = [
  /^(um+|uh+|hmm+|mm+|ah+|er+)[.!?\s]*$/i,
  // A laugh or a run of laughs is not a turn: "haha", "ha ha ha", "hehe", "lol".
  /^(?:(?:ha|he|hah|heh|haha+|hehe+|lol)[.!?,\s]*){1,6}$/i,
  // Whisper writes non-speech as *cough*, *laughs*, [music], (sniffs) — or several of them.
  /^(?:[\[(*][^\])*]*[\])*][.!?,\s]*)+$/,
  // Lines Whisper hallucinates on silence. Nobody says these to David.
  /^(?:thanks?\s+(?:you\s+)?for\s+watching|like\s+and\s+subscribe|please\s+subscribe|subscribe\s+to\s+(?:my|the|our)\s+channel|see\s+you\s+(?:in\s+the\s+)?next\s+(?:time|video)|subtitles?\s+by\b.*|transcribed\s+by\b.*|captions?\s+by\b.*|.*\bamara\.org\b.*|www\.[a-z0-9.-]+)[.!?\s]*$/i,
  /^(music|applause|silence|inaudible|background noise|room noise|noise|static)[.!?\s]*$/i,
  /^(cough|coughing|sniff|sniffle|sniffling|sneeze|sneezing|achoo|burp|burping|yawn|yawning|ahem)[.!?\s]*$/i,
  /^(laugh|laughing|laughter|giggle|giggling|chuckle|chuckling)[.!?\s]*$/i,
  /^(clears? throat|clearing throat|throat clear|throat clearing|breathing|breath|inhales?|exhales?|sigh|sighs|sighing)[.!?\s]*$/i,
  /^\[.*\]$/,
  /^\(.*\)$/,
];

export function isMeaningfulTranscript(value) {
  const text = value.trim().replace(/\s+/g, ' ');
  return /[\p{L}\p{N}]/u.test(text) && !noisePatterns.some(pattern => pattern.test(text));
}
