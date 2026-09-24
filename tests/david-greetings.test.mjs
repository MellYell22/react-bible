import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * The greeting is the loudest "this is a script" signal. These tests pin
 * David's greetings to short, plain lines a real person would say, and make
 * sure the Voice screen never speaks until the person taps Start Conversation.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

const compiled = ts.transpileModule(read("src", "constants", "persona.ts"), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const persona = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const CANNED = [
  /what'?s happening in your world/i,
  /hey friend/i,
  /how'?s life/i,
  /what'?s on the agenda/i,
  /look who it is/i,
  /catch me up/i,
  /how'?s life treating you/i,
  /good to see you/i,
  /what'?s on your (heart|mind)/i,
  /what brings you/i,
  /stranger/i,
  /there you are/i,
];

const ALL_POOLS = [
  ...persona.DAVID_FIRST_TIME_GREETINGS,
  ...persona.DAVID_RETURNING_GREETINGS,
  ...persona.DAVID_RETURNING_AFTER_GAP_GREETINGS,
];

test("no greeting pool contains a canned or corny line", () => {
  for (const line of ALL_POOLS) {
    for (const pattern of CANNED) {
      assert.doesNotMatch(line, pattern, `greeting ${JSON.stringify(line)} is canned`);
    }
  }
});

test("every greeting is one short line with no speech after it", () => {
  for (const line of ALL_POOLS) {
    const sentences = line.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.ok(sentences.length <= 2, `${JSON.stringify(line)} has ${sentences.length} sentences`);
    assert.ok(line.split(/\s+/).length <= 8, `${JSON.stringify(line)} is too long to be a greeting`);
    assert.doesNotMatch(line, /\.\.\.|…|!/, `${JSON.stringify(line)} should be plainly punctuated`);
    assert.ok(/^(Hey|Hi|Good morning|Morning)\b/.test(line), `${JSON.stringify(line)} should open like a person`);
  }
});

test("the greeting picker only ever returns a simple greeting, for every hour and context", () => {
  for (let hour = 0; hour < 24; hour += 1) {
    for (const context of [
      { isReturning: false },
      { isReturning: true },
      { isReturning: true, daysSinceLastChat: 30 },
      { isReturning: true, firstName: "Sarah" },
    ]) {
      for (let i = 0; i < 6; i += 1) {
        const greeting = persona.getDavidGreeting({ ...context, hour });
        for (const pattern of CANNED) assert.doesNotMatch(greeting, pattern);
        assert.ok(greeting.split(/\s+/).length <= 9, `${JSON.stringify(greeting)} is too long`);
        assert.doesNotMatch(greeting, /\.\.\.|…/);
      }
    }
  }
});

test("David introduces himself only on the first session", () => {
  for (const line of persona.DAVID_FIRST_TIME_GREETINGS) assert.match(line, /I'm David/);
  for (const line of [...persona.DAVID_RETURNING_GREETINGS, ...persona.DAVID_RETURNING_AFTER_GAP_GREETINGS]) {
    assert.doesNotMatch(line, /David/);
  }
  for (let i = 0; i < 20; i += 1) {
    assert.doesNotMatch(persona.getDavidGreeting({ isReturning: true, hour: 12 }), /David/);
  }
});

test("the same greeting is never used twice in a row", () => {
  let last = persona.getDavidGreeting({ isReturning: true, hour: 12 });
  for (let i = 0; i < 40; i += 1) {
    const next = persona.getDavidGreeting({ isReturning: true, hour: 12, lastGreeting: last });
    assert.notEqual(next, last);
    last = next;
  }
});

test("the persona bans the corny greetings by name", () => {
  const source = read("src", "constants", "persona.ts");
  for (const line of [
    "What's happening in your world?",
    "Hey friend, how's life?",
    "What's on the agenda today?",
    "Look who it is.",
    "Catch me up.",
    "How's life treating you?",
  ]) {
    assert.ok(source.includes(line), `persona should ban ${JSON.stringify(line)}`);
  }
  assert.match(source, /Greet once\. Never greet again mid-conversation/);
});

/* ---------------- Voice screen behaviour, pinned at the source ---------------- */

const voiceScreen = read("src", "screens", "VoiceScreen.tsx");

test("David stays silent until Start Conversation is tapped", () => {
  // The greeting is only ever played from the Start Conversation handler.
  const greetingPlays = voiceScreen.match(/isGreeting: true/g) || [];
  assert.equal(greetingPlays.length, 1, "exactly one place plays a greeting");
  const handlerStart = voiceScreen.indexOf("const handleStartConversation");
  assert.ok(voiceScreen.indexOf("isGreeting: true") > handlerStart, "greeting plays inside handleStartConversation");
  // No effect hook speaks or starts listening on mount.
  const effects = voiceScreen.match(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/g) || [];
  assert.ok(effects.length >= 2, "expected the mount and access effects");
  for (const effect of effects) {
    assert.doesNotMatch(effect, /playDavidResponseAudio|startListening\(|handleStartConversation/);
  }
});

test("the voice screen opens with no stale response text and starts fresh each conversation", () => {
  assert.match(voiceScreen, /useState\(''\);?\s*$/m, "lastResponseText starts empty");
  const handler = voiceScreen.slice(voiceScreen.indexOf("const handleStartConversation"), voiceScreen.indexOf("const handleEndConversation"));
  assert.match(handler, /commitMessages\(\[\]\)/);
  assert.match(handler, /setLastResponseText\(''\)/);
  assert.match(handler, /resumeListening: true/, "listening resumes right after the greeting");
});

test("ending a conversation stops everything and clears conversation state", () => {
  const handler = voiceScreen.slice(voiceScreen.indexOf("const handleEndConversation"), voiceScreen.indexOf("const handleUpgradeToPro"));
  for (const call of ["abortPendingRequests()", "stopListening(true)", "stopCurrentAudio()", "stopVoiceActivity()", "commitMessages([])", "setLastResponseText('')", "conversationActiveRef.current = false"]) {
    assert.ok(handler.includes(call), `handleEndConversation must call ${call}`);
  }
});

test("silence and noise never become a turn on the voice screen", () => {
  assert.match(voiceScreen, /if \(!speechDetectedRef\.current\) \{/, "recordings with no sustained speech are dropped");
  assert.match(voiceScreen, /result\.rejected \|\| !isMeaningfulUserText\(transcript\)/, "rejected or noise transcripts are dropped");
  assert.match(voiceScreen, /SPEECH_SUSTAIN_MS = \d+/);
});
