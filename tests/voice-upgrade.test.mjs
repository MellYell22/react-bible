// David's free voice trial is a fixed number of spoken exchanges per account,
// spent server-side. Nobody gets stranded without a way to upgrade, and the
// trial can never be reset from the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/screens/VoiceScreen.tsx', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../lib/chatAccess.ts', import.meta.url), 'utf8');
const trialApi = readFileSync(new URL('../api/david-trial.ts', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20261031090000_add_david_intro_voice_message_trial.sql', import.meta.url),
  'utf8',
);

test('the free voice trial is five spoken exchanges', () => {
  assert.match(gate, /export const FREE_VOICE_TRIAL_MESSAGES = 5;/);
  assert.match(migration, /v_limit constant integer := 5;/);
});

test('the trial count is spent in the database, never kept in the browser', () => {
  assert.match(gate, /consume_david_intro_voice_message/);
  assert.match(trialApi, /consume_david_intro_voice_message/);
  assert.doesNotMatch(source, /voiceSeconds/);
});

// The spoken conversation runs inside the ElevenLabs agent. Its replies never
// reach /api/chat, so a counter that only watches that endpoint counts
// nothing and David never stops — which is exactly what shipped once.
test('David\'s spoken replies are counted from the live agent conversation', () => {
  assert.match(source, /useConversation\(\{[\s\S]*?onMessage:/);
  assert.match(source, /onAgentMessageRef\.current = handleAgentMessage;/);
  const handler = source.slice(source.indexOf('const handleAgentMessage'));
  const body = handler.slice(0, handler.indexOf('const handleAgentModeChange'));
  assert.match(body, /role !== 'ai'/);
  assert.match(body, /spendOneFreeReply\(\)/);
});

test('the opening greeting is free', () => {
  const handler = source.slice(source.indexOf('const handleAgentMessage'));
  assert.match(handler.slice(0, 1200), /if \(!userHasSpokenRef\.current\) return;/);
  assert.match(source, /userHasSpokenRef\.current = true;/);
});

test('a reply streamed in parts is charged once, not once per fragment', () => {
  const handler = source.slice(source.indexOf('const handleAgentMessage'));
  assert.match(handler.slice(0, 1200), /countedReplyIdsRef\.current\.has\(replyId\)/);
  assert.match(handler.slice(0, 1200), /countedReplyIdsRef\.current\.add\(replyId\)/);
  assert.match(handler.slice(0, 1200), /response_id/);
});

test('a new conversation starts the greeting and reply ids fresh', () => {
  const start = source.slice(source.indexOf('const handleStartConversation'));
  assert.match(start.slice(0, 1600), /userHasSpokenRef\.current = false;/);
  assert.match(start.slice(0, 1600), /countedReplyIdsRef\.current = new Set\(\);/);
  assert.match(start.slice(0, 1600), /paywallPendingRef\.current = false;/);
});

test('David finishes his last sentence before the wall appears', () => {
  // The charge happens while he is still speaking, so the cut must wait for
  // the agent to stop rather than firing inside the message handler.
  const spend = source.slice(source.indexOf('const handleAgentMessage'));
  const spendBody = spend.slice(0, spend.indexOf('const handleAgentModeChange'));
  assert.match(spendBody, /paywallPendingRef\.current = true;/);
  assert.doesNotMatch(spendBody, /endVoiceSessionForPaywall/);

  const mode = source.slice(source.indexOf('const handleAgentModeChange'));
  assert.match(mode.slice(0, 700), /if \(mode === 'speaking'\) return;/);
  assert.match(mode.slice(0, 700), /endVoiceSessionForPaywall\(\)/);
  assert.match(source, /onAgentModeChangeRef\.current = handleAgentModeChange;/);
});

test('a failed charge never strands someone mid-conversation', () => {
  const spend = source.slice(source.indexOf('const spendOneFreeReply'));
  const failure = spend.slice(spend.indexOf('catch'), spend.indexOf('const handleAgentMessage'));
  assert.match(failure, /return true;/);
});

test('paid voice is never charged against the trial', () => {
  const handler = source.slice(source.indexOf('const handleAgentMessage'));
  assert.match(handler.slice(0, 1200), /if \(hasPaidVoiceAccess\) return;/);
  assert.match(trialApi, /req\.method === 'POST' && !paidVoice/);
});

test('the database decrements under a row lock so the last reply cannot double-spend', () => {
  assert.match(migration, /for update/);
  assert.match(migration, /voice_messages_used = david_intro_trial_usage\.voice_messages_used \+ 1/);
});

// The OUT parameter and the column share a name, so an unqualified reference
// throws "column reference is ambiguous" at runtime and the trial silently
// never counts down. Both trial functions were written that way once.
test('trial counters qualify the column so the increment cannot be ambiguous', () => {
  const textFix = readFileSync(
    new URL('../supabase/migrations/20261031090100_fix_ambiguous_column_in_text_trial.sql', import.meta.url),
    'utf8',
  );
  assert.match(textFix, /text_messages_used = david_intro_trial_usage\.text_messages_used \+ 1/);
  for (const sql of [migration, textFix]) {
    assert.doesNotMatch(sql, /set (text|voice)_messages_used = (text|voice)_messages_used \+ 1/);
  }
});

test('an exhausted trial is a 402 the client can recognise', () => {
  const branch = gate.slice(gate.indexOf('if (options.liveVoice) {'));
  assert.match(branch.slice(0, 1600), /code: 'VOICE_TRIAL_EXHAUSTED'/);
  assert.match(branch.slice(0, 1600), /deny\(402/);
});

test('an unmeterable trial refuses voice rather than giving it away free', () => {
  const branch = gate.slice(gate.indexOf('if (options.liveVoice) {'));
  assert.match(branch.slice(0, 1600), /VOICE_TRIAL_METER_UNAVAILABLE/);
  assert.match(branch.slice(0, 1600), /deny\(503/);
});

test('running out mid-conversation shows the upgrade wall, not an error', () => {
  const handler = source.slice(source.indexOf('if (isChatLimitReachedError(err))'));
  assert.ok(handler.length > 0, 'the limit error must be handled');
  assert.match(handler.slice(0, 400), /setTrialVoiceRepliesRemaining\(0\)/);
  assert.match(handler.slice(0, 400), /endVoiceSessionForPaywall\(\)/);
  assert.match(handler.slice(0, 400), /setError\(VOICE_TRIAL_USED_UP_MESSAGE\)/);
});

test('the paywall shutdown stops the microphone and audio', () => {
  const fn = source.slice(source.indexOf('const endVoiceSessionForPaywall'));
  assert.match(fn.slice(0, 600), /stopListening\(true\)/);
  assert.match(fn.slice(0, 600), /stopCurrentAudio\(\)/);
  assert.match(fn.slice(0, 600), /setVoiceModeActive\(false\)/);
});

// A signed-in person with a full trial was being sent to the upgrade wall
// before any request was made, because an unreadable count was treated as
// an empty one. The server spends and enforces the trial, so the screen must
// let an unknown count through and let the server answer.
test('an unknown reply count lets the person start, it does not wall them off', () => {
  assert.match(
    source,
    /const hasVoiceAccess = hasPaidVoiceAccess\s*\n\s*\|\| trialVoiceRepliesRemaining === null\s*\n\s*\|\| trialVoiceRepliesRemaining > 0;/,
  );
  // Every path that cannot determine the count must leave it unknown (null),
  // never zero.
  const refresh = source.slice(source.indexOf('const refreshTrialUsage'));
  const body = refresh.slice(0, refresh.indexOf('const setPhase'));
  assert.match(body, /if \(!session\?\.user\?\.id\) \{ setTrialVoiceRepliesRemaining\(null\)/);
  const failure = body.slice(body.indexOf('catch (trialError'));
  assert.match(failure, /setTrialVoiceRepliesRemaining\(null\)/);
  assert.doesNotMatch(failure, /setTrialVoiceRepliesRemaining\(0\)/);
});

test('a lagging access token is retried instead of being read as signed out', () => {
  const fn = source.slice(source.indexOf('const getTrialHeaders'));
  assert.match(fn.slice(0, 800), /for \(let attempt = 0; attempt < 3; attempt\+\+\)/);
});

test('Start Conversation waits until the free replies are known', () => {
  assert.match(source, /const voiceAccessChecking = !hasPaidVoiceAccess && \(userContextLoading \|\| trialUsageLoading\)/);
  assert.match(source, /startConversationIsEnabled = !voiceAccessChecking &&/);
  assert.match(source, /if \(voiceAccessChecking\) return;\s*\n\s*if \(!hasVoiceAccess\) \{ setError\(VOICE_TRIAL_USED_UP_MESSAGE\)/);
});

test('a stale "used up" message clears once voice access is confirmed', () => {
  assert.match(source, /setError\(current => \(current === VOICE_TRIAL_USED_UP_MESSAGE \? null : current\)\)/);
});

test('every upgrade prompt comes with an upgrade button', () => {
  const banner = source.slice(source.indexOf('error === VOICE_TRIAL_USED_UP_MESSAGE && ('));
  assert.ok(banner.length > 0);
  assert.match(banner.slice(0, 800), /onPress=\{handleUpgradeToPro\}/);

  const row = source.slice(source.indexOf('styles.trialUpgradeRow'));
  assert.match(row.slice(0, 900), /free replies left[\s\S]*onPress=\{handleUpgradeToPro\}/);
});

test('the screen counts replies, never minutes', () => {
  assert.doesNotMatch(source, /voice minutes/i);
  assert.match(source, /free replies left/);
});

test('the trial endpoint reports replies left and spends them one at a time', () => {
  assert.match(trialApi, /FREE_VOICE_TRIAL_MESSAGES/);
  assert.match(trialApi, /voice_messages_used/);
  // GET reports, POST spends, nothing else is accepted.
  assert.match(trialApi, /req\.method !== 'GET' && req\.method !== 'POST'/);
  // The old seconds-based meter must stay gone.
  assert.doesNotMatch(trialApi, /consume_david_intro_voice_seconds/);
  assert.doesNotMatch(trialApi, /voice_seconds_used/);
});

test('free text messages are untouched by the voice change', () => {
  assert.match(trialApi, /const TEXT_LIMIT = 25;/);
  assert.match(trialApi, /text_messages_used/);
});
