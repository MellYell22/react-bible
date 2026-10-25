// The Voice screen must never strand someone: no false "used up" message
// while free minutes are loading, and every upgrade prompt has a button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/screens/VoiceScreen.tsx', import.meta.url), 'utf8');

test('Start Conversation waits until free voice minutes are known', () => {
  assert.match(source, /const voiceAccessChecking = !hasPaidVoiceAccess && \(userContextLoading \|\| trialUsageLoading\)/);
  assert.match(source, /startConversationIsEnabled = !voiceAccessChecking &&/);
  assert.match(source, /if \(voiceAccessChecking\) return;\s*\n\s*if \(!hasVoiceAccess\) \{ setError\(VOICE_TRIAL_USED_UP_MESSAGE\)/);
});

test('a stale "used up" message clears once voice access is confirmed', () => {
  assert.match(source, /setError\(current => \(current === VOICE_TRIAL_USED_UP_MESSAGE \? null : current\)\)/);
});

test('the "used up" message always comes with an upgrade button', () => {
  const banner = source.slice(source.indexOf('error === VOICE_TRIAL_USED_UP_MESSAGE && ('));
  assert.ok(banner.length > 0);
  assert.match(banner.slice(0, 800), /onPress=\{handleUpgradeToPro\}/);
});

test('trial users see an upgrade button next to their free minutes', () => {
  const row = source.slice(source.indexOf('styles.trialUpgradeRow'));
  assert.match(row.slice(0, 900), /free voice minutes left[\s\S]*onPress=\{handleUpgradeToPro\}/);
});
