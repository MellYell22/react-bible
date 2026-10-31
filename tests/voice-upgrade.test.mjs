// Live voice is Pro-only: there is no free voice trial anywhere in the app,
// and nobody is stranded on a dead end without a way to upgrade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/screens/VoiceScreen.tsx', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../lib/chatAccess.ts', import.meta.url), 'utf8');
const trialApi = readFileSync(new URL('../api/david-trial.ts', import.meta.url), 'utf8');

test('voice access on the Voice screen is paid access, with nothing else to earn it', () => {
  assert.match(source, /const hasVoiceAccess = hasPaidVoiceAccess;/);
  assert.doesNotMatch(source, /trialVoiceSecondsRemaining/);
  assert.doesNotMatch(source, /recordTrialVoiceUsage|refreshTrialUsage/);
});

test('Start Conversation waits until paid access is known', () => {
  assert.match(source, /const voiceAccessChecking = !hasPaidVoiceAccess && userContextLoading;/);
  assert.match(source, /startConversationIsEnabled = !voiceAccessChecking &&/);
  assert.match(source, /if \(voiceAccessChecking\) return;\s*\n\s*if \(!hasVoiceAccess\) \{ setError\(VOICE_PRO_REQUIRED_MESSAGE\)/);
});

test('a stale upgrade message clears once voice access is confirmed', () => {
  assert.match(source, /setError\(current => \(current === VOICE_PRO_REQUIRED_MESSAGE \? null : current\)\)/);
});

test('the upgrade message always comes with an upgrade button', () => {
  const banner = source.slice(source.indexOf('error === VOICE_PRO_REQUIRED_MESSAGE && ('));
  assert.ok(banner.length > 0);
  assert.match(banner.slice(0, 800), /onPress=\{handleUpgradeToPro\}/);
});

test('the Voice screen never advertises free voice minutes', () => {
  assert.doesNotMatch(source, /free voice minutes/i);
  assert.doesNotMatch(source, /voice minutes/i);
});

test('the server gate denies live voice to everyone below Pro', () => {
  assert.match(gate, /options\.liveVoice \? canUsePro\(tier\) : canUsePremium\(tier\)/);
  assert.doesNotMatch(gate, /david_intro_trial_usage|FREE_VOICE_TRIAL_SECONDS|voice-trial/);
  const branch = gate.slice(gate.indexOf('if (options.liveVoice) {'));
  assert.match(branch.slice(0, 400), /deny\(402/);
});

test('the trial endpoint hands out no voice allowance and accepts no voice spend', () => {
  assert.match(trialApi, /remainingSeconds: 0/);
  assert.doesNotMatch(trialApi, /consume_david_intro_voice_seconds/);
  assert.doesNotMatch(trialApi, /voiceSeconds/);
});

test('free text messages are untouched by the voice change', () => {
  assert.match(trialApi, /const TEXT_LIMIT = 25;/);
  assert.match(trialApi, /text_messages_used/);
});
