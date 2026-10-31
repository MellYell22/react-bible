// David's voice costs real money per call. /api/speech and /api/transcribe
// must require Pro or an unspent free trial — being merely signed in once
// let any free account replay his voice without limit, straight past the
// paywall, by tapping the speaker button or calling the endpoint directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const gate = read('lib/chatAccess.ts');
const speech = read('api/speech.ts');
const transcribe = read('api/transcribe.ts');
const ai = read('src/services/ai.ts');
const chatScreen = read('src/screens/ChatScreen.tsx');

test('the paid-cost voice endpoints check entitlement, not just sign-in', () => {
  for (const [name, source] of [['speech', speech], ['transcribe', transcribe]]) {
    assert.match(source, /requireVoicePlaybackAccess\(req\)/, name);
    assert.doesNotMatch(source, /requireSignedInUser/, name);
  }
});

test('the old sign-in-only gate is gone, so nothing can reach for it again', () => {
  assert.doesNotMatch(gate, /requireSignedInUser/);
});

test('Pro and owner always pass, everyone else needs an unspent trial', () => {
  const fn = gate.slice(gate.indexOf('export const requireVoicePlaybackAccess'));
  assert.match(fn, /if \(canUsePro\(tier\)\) return null;/);
  assert.match(fn, /voice_messages_used/);
  assert.match(fn, /used < FREE_VOICE_TRIAL_MESSAGES\) return null;/);
  assert.match(fn, /status: 402/);
  assert.match(fn, /VOICE_TRIAL_EXHAUSTED/);
});

test('the check never spends a reply, so it cannot double-charge the trial', () => {
  const fn = gate.slice(gate.indexOf('export const requireVoicePlaybackAccess'));
  assert.doesNotMatch(fn, /consume_david_intro_voice_message/);
  assert.doesNotMatch(fn, /\.rpc\(/);
});

test('a signed-out caller is refused', () => {
  const fn = gate.slice(gate.indexOf('export const requireVoicePlaybackAccess'));
  assert.match(fn, /status: 401, code: 'AUTH_REQUIRED'/);
});

test('a database blip does not lock out an entitled user', () => {
  const fn = gate.slice(gate.indexOf('export const requireVoicePlaybackAccess'));
  const blip = fn.slice(fn.indexOf('if (usageError)'));
  assert.match(blip.slice(0, 300), /return null;/);
});

test('a refused voice call surfaces the upgrade wall, not a dead button', () => {
  // The speech client turns a 402 into the same error the chat endpoint
  // raises, and the chat screen shows its existing upgrade screen.
  assert.match(ai, /throwIfLimitReached\(response\.status, error\);/);
  assert.match(chatScreen, /isChatLimitReachedError\(speakError\)\) setLimitReached\(true\)/);
});
