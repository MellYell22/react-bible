import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * David's voice ID was changed in code, the deploy went green, and production
 * kept speaking in the old stock voice for days. Nothing errored — a stale
 * ELEVENLABS_VOICE_ID in the hosting dashboard silently outranked the code.
 *
 * These tests keep the code authoritative so that failure cannot repeat.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

const speech = read("api", "speech.ts");
const server = read("server.ts");
const VOICE_ID = "ewxUvnyvvOehYjKjUVKC";

test("both speech paths declare the same voice ID", () => {
  assert.ok(speech.includes(`const DAVID_ELEVENLABS_VOICE_ID = '${VOICE_ID}'`));
  assert.ok(server.includes(`const DAVID_ELEVENLABS_VOICE_ID = '${VOICE_ID}'`));
});

test("the environment can no longer override David's voice", () => {
  for (const [name, src] of [["api/speech.ts", speech], ["server.ts", server]]) {
    assert.ok(
      !/voiceId\s*=\s*process\.env\.ELEVENLABS_VOICE_ID\s*\|\|/.test(src),
      `${name} still lets ELEVENLABS_VOICE_ID win over the code`,
    );
    assert.ok(
      /const voiceId = DAVID_ELEVENLABS_VOICE_ID;/.test(src),
      `${name} should read the voice straight from the pinned constant`,
    );
  }
});

test("a disagreeing env var warns loudly instead of taking effect", () => {
  assert.match(speech, /Ignoring ELEVENLABS_VOICE_ID/);
  assert.match(speech, /pinned in code/);
});

test("no other voice ID is left anywhere in the speech paths", () => {
  // Any 20-char ElevenLabs-shaped token that is not the approved one.
  for (const [name, src] of [["api/speech.ts", speech], ["server.ts", server]]) {
    const candidates = (src.match(/'[A-Za-z0-9]{20}'/g) || [])
      .map((s) => s.replace(/'/g, ""))
      .filter((id) => id !== VOICE_ID);
    assert.deepEqual(candidates, [], `${name} contains a stray voice-like ID: ${candidates}`);
  }
});
