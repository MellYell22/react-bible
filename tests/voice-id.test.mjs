import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * David speaks through OpenAI text-to-speech (gpt-4o-mini-tts, "cedar").
 * The voice is pinned in ONE file and both speech paths build their request
 * from it, so production and local preview can never drift apart, and no
 * environment variable can silently swap his voice.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

const settings = read("src", "utils", "davidVoiceSettings.ts");
const speech = read("api", "speech.ts");
const server = read("server.ts");

test("David's voice is OpenAI cedar on gpt-4o-mini-tts", () => {
  assert.match(settings, /DAVID_TTS_MODEL = 'gpt-4o-mini-tts'/);
  assert.match(settings, /DAVID_TTS_VOICE = 'cedar'/);
  assert.match(settings, /api\.openai\.com\/v1\/audio\/speech/);
});

test("David speaks at a calm pace", () => {
  const speed = Number(settings.match(/DAVID_TTS_SPEED = ([0-9.]+)/)?.[1]);
  assert.ok(speed >= 0.85 && speed < 1, `speed ${speed} should be calm, below 1.0`);
});

test("both speech paths build the identical request from the shared settings", () => {
  for (const [name, src] of [["api/speech.ts", speech], ["server.ts", server]]) {
    assert.match(src, /buildDavidSpeechBody\(cleanText\)/, `${name} must use the shared request builder`);
    assert.match(src, /OPENAI_SPEECH_URL/, `${name} must call OpenAI speech`);
  }
});

test("ElevenLabs is fully removed from the speech paths", () => {
  for (const [name, src] of [["api/speech.ts", speech], ["server.ts", server], ["davidVoiceSettings.ts", settings.replace(/ElevenLabs has been removed entirely\./, "")]]) {
    assert.ok(!/elevenlabs\.io|xi-api-key|ELEVENLABS_API_KEY/i.test(src), `${name} still references ElevenLabs`);
  }
});

/** Every file that can execute in the web app or its API. */
const walk = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
};

test("no other voice vendor can run anywhere in David's runtime", () => {
  const root = path.join(__dirname, "..");
  const files = [
    ...walk(path.join(root, "src")),
    ...walk(path.join(root, "api")),
    ...walk(path.join(root, "lib")),
    path.join(root, "server.ts"),
  ];
  const vendorReference = /elevenlabs\.io|api\.elevenlabs|xi-api-key|ELEVENLABS|cartesia|CARTESIA|sonic-\d|play\.ht|playht|deepgram/i;
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8").replace(/ElevenLabs has been removed entirely\./, "");
    assert.ok(!vendorReference.test(src), `${path.relative(root, file)} references another voice vendor`);
  }
});

test("the only speech request David's voice can make goes to OpenAI", () => {
  const speechUrls = settings.match(/https:\/\/[^'"\s]+/g) || [];
  assert.deepEqual(speechUrls, ["https://api.openai.com/v1/audio/speech"]);
  for (const [name, src] of [["api/speech.ts", speech], ["server.ts", server]]) {
    const fetchTargets = [...src.matchAll(/fetch\(\s*([A-Za-z_$][\w$.]*)/g)].map((m) => m[1]);
    assert.ok(fetchTargets.includes("OPENAI_SPEECH_URL"), `${name} must fetch OPENAI_SPEECH_URL`);
  }
});

test("no environment variable can override the voice", () => {
  assert.ok(!/process\.env\.[A-Z_]*VOICE/.test(speech));
  assert.ok(!/process\.env\.[A-Z_]*VOICE/.test(server));
});
