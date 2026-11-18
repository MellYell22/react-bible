// David's Voice Pro ($12.99/month) includes 60 minutes of live conversation
// per billing period, exactly as Stripe checkout promises. The free 5-reply
// trial is a separate meter and is covered in voice-upgrade.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/screens/VoiceScreen.tsx', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../lib/chatAccess.ts', import.meta.url), 'utf8');
const trialApi = readFileSync(new URL('../api/david-trial.ts', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20261118120000_add_david_pro_voice_minutes.sql', import.meta.url),
  'utf8',
);

test('Pro gets 60 minutes per period, and the app and database agree', () => {
  assert.match(gate, /export const PRO_VOICE_SECONDS_PER_PERIOD = 60 \* 60;/);
  assert.match(migration, /v_limit constant integer := 3600;/);
});

test('minutes reset each billing period by keying usage to the period end', () => {
  assert.match(migration, /primary key \(user_id, period_end\)/);
  assert.match(gate, /stripe_current_period_end/);
});

test('the meter is locked and capped so heartbeats cannot race or be forged in bulk', () => {
  assert.match(migration, /for update/);
  assert.match(migration, /least\(greatest\(coalesce\(p_seconds, 0\), 0\), 60\)/);
  assert.match(trialApi, /Math\.min\(Math\.max\(seconds, 0\), 60\)/);
  assert.match(migration, /grant execute on function public\.consume_david_pro_voice_seconds\(uuid, timestamptz, integer\) to service_role;/);
  assert.match(migration, /revoke all on function public\.consume_david_pro_voice_seconds\(uuid, timestamptz, integer\) from authenticated;/);
});

test('only Pro is metered by minutes; the owner never is', () => {
  assert.match(trialApi, /const meteredPro = tier === 'pro';/);
  assert.match(gate, /options\.liveVoice && tier === 'pro'/);
});

test('the free trial endpoint still spends replies for free accounts', () => {
  assert.match(trialApi, /req\.method === 'POST' && !paidVoice/);
  assert.match(trialApi, /consume_david_intro_voice_message/);
});

test('a Pro account out of minutes is refused live voice on the server', () => {
  const branch = gate.slice(gate.indexOf("options.liveVoice && tier === 'pro'"));
  assert.match(branch.slice(0, 900), /code: 'PRO_VOICE_MINUTES_EXHAUSTED'/);
  assert.match(branch.slice(0, 900), /deny\(402/);
});

test('the Voice screen counts live Pro time with a heartbeat', () => {
  assert.match(source, /PRO_VOICE_HEARTBEAT_MS = 15000/);
  assert.match(source, /body: JSON\.stringify\(\{ proSeconds: seconds \}\)/);
  assert.match(source, /elevenLabsConversation\.status === 'connected'/);
  // The last stretch of a call is recorded when it ends.
  assert.match(source, /Record the last stretch of the call when it ends\./);
});

test('David finishes his sentence before the minutes cut him off', () => {
  assert.match(source, /if \(agentSpeakingRef\.current\) \{\s*\n\s*proMinutesPendingRef\.current = true;/);
  const mode = source.slice(source.indexOf('const handleAgentModeChange'));
  assert.match(mode.slice(0, 400), /if \(proMinutesPendingRef\.current\) \{ finishForProMinutes\(\); return; \}/);
});

test('a failed time report never cuts a paying member off', () => {
  const fn = source.slice(source.indexOf('const reportProVoiceTime'));
  const failure = fn.slice(fn.indexOf('catch (reportError'), fn.indexOf('const stopProHeartbeat'));
  assert.match(failure, /return true;/);
});

test('Pro members see minutes left, and a friendly reset message when out', () => {
  assert.match(source, /minutes left this month/);
  assert.match(source, /Your minutes reset at the start of your next billing period\./);
  // Out of minutes is not an upgrade wall: they already pay.
  const screen = source.slice(source.indexOf('proMinutesUsedUp) {'));
  const card = screen.slice(0, screen.indexOf('if (!userContextLoading && !trialUsageLoading && !hasVoiceAccess)'));
  assert.doesNotMatch(card, /handleUpgradeToPro/);
  assert.match(card, /See you soon/);
});
