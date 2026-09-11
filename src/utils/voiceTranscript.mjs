// Shared by both transcription endpoints and the microphone client. Content
// need not mention a mood: greetings, questions and brief answers are turns.
const noisePatterns = [
  /^(um+|uh+|hmm+|mm+|ah+|er+)[.!?\s]*$/i,
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
