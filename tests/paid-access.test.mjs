// Paid access must come from a real, current Stripe subscription — never from
// the cached subscription_tier label alone. These tests cover every billing
// path: free, unpaid "Pro" labels, Plus/Pro payments, failed payments,
// cancellations, expirations, trials, owner access, and webhook ordering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  OWNER_EMAIL,
  canUsePremium,
  canUsePro,
  hasActivePaidSubscription,
  resolveAccessTier,
} from '../lib/subscriptionState.js';

const NOW = new Date('2026-10-23T22:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const future = (days = 20) => new Date(NOW + days * DAY).toISOString();
const past = (days) => new Date(NOW - days * DAY).toISOString();

const paying = (overrides = {}) => ({
  role: 'user',
  email: 'customer@example.com',
  subscription_tier: 'pro',
  stripe_customer_id: 'cus_real',
  stripe_subscription_id: 'sub_real',
  stripe_subscription_status: 'active',
  stripe_current_period_end: future(),
  ...overrides,
});
const access = (profile, userEmail = null) => resolveAccessTier({ profile, userEmail, now: NOW });

// ---------------------------------------------------------------------------
// Entitlement rules
// ---------------------------------------------------------------------------

test('free users get no paid features', () => {
  const tier = access({ role: 'user', email: 'a@b.com', subscription_tier: 'free' });
  assert.equal(tier, 'free');
  assert.equal(canUsePremium(tier), false);
  assert.equal(canUsePro(tier), false);
  assert.equal(access(null), 'free');
});

test('an account labeled Pro with no Stripe subscription at all is denied (test account #1)', () => {
  const tier = access({ role: 'user', email: 'tester@example.com', subscription_tier: 'pro', subscription_status: 'active' });
  assert.equal(tier, 'free');
  assert.equal(canUsePro(tier), false);
});

test('a "trialing" Pro label whose trial ended months ago is denied (test account #2)', () => {
  const tier = access(paying({ stripe_subscription_status: 'trialing', stripe_current_period_end: '2026-07-12T11:41:30Z' }));
  assert.equal(tier, 'free');
});

test('a Pro label with a forged or missing customer/subscription id is denied', () => {
  assert.equal(access(paying({ stripe_customer_id: null })), 'free');
  assert.equal(access(paying({ stripe_subscription_id: 'fake' })), 'free');
  assert.equal(access(paying({ stripe_current_period_end: null })), 'free');
  assert.equal(access(paying({ stripe_current_period_end: 'not a date' })), 'free');
});

test('a successful Plus payment unlocks Plus (unlimited text) but not Pro voice', () => {
  const tier = access(paying({ subscription_tier: 'plus' }));
  assert.equal(tier, 'plus');
  assert.equal(canUsePremium(tier), true);
  assert.equal(canUsePro(tier), false);
});

test('a successful Pro payment unlocks Pro', () => {
  const tier = access(paying());
  assert.equal(tier, 'pro');
  assert.equal(canUsePremium(tier), true);
  assert.equal(canUsePro(tier), true);
});

test('a valid trial unlocks its plan until the trial period ends', () => {
  assert.equal(access(paying({ stripe_subscription_status: 'trialing', stripe_current_period_end: future(5) })), 'pro');
  assert.equal(access(paying({ stripe_subscription_status: 'trialing', stripe_current_period_end: past(10) })), 'free');
});

test('failed payments (past_due, unpaid, incomplete) lose paid access', () => {
  for (const status of ['past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
    assert.equal(access(paying({ stripe_subscription_status: status })), 'free', status);
  }
});

test('a canceled-at-period-end subscription keeps access only through the paid period', () => {
  // Stripe keeps status "active" until the period ends.
  assert.equal(access(paying({ stripe_current_period_end: future(3) })), 'pro');
  // If the final "canceled" webhook never arrives, access still runs out.
  assert.equal(access(paying({ stripe_current_period_end: past(4) })), 'free');
});

test('canceled and expired subscriptions lose paid access', () => {
  assert.equal(access(paying({ stripe_subscription_status: 'canceled' })), 'free');
  assert.equal(access(paying({ stripe_current_period_end: past(30) })), 'free');
});

test('a paying customer keeps access for a short grace while a renewal webhook is late', () => {
  assert.equal(access(paying({ stripe_current_period_end: past(1) })), 'pro');
  assert.equal(hasActivePaidSubscription(paying({ stripe_current_period_end: past(2.9) }), NOW), true);
  assert.equal(hasActivePaidSubscription(paying({ stripe_current_period_end: past(3.1) }), NOW), false);
});

test('the owner account has full access with no Stripe subscription', () => {
  assert.equal(access({ role: 'owner', subscription_tier: 'free' }), 'owner');
  assert.equal(access({ role: 'user', email: OWNER_EMAIL.toUpperCase(), subscription_tier: 'free' }), 'owner');
  assert.equal(access({ role: 'user', subscription_tier: 'free' }, OWNER_EMAIL), 'owner');
});

test('test accounts are never treated as owner', () => {
  for (const email of ['alissasmith22@gmail.com', 'aadesigns87@gmail.com']) {
    assert.equal(access({ role: 'user', email, subscription_tier: 'pro' }), 'free', email);
  }
  // A legacy "owner" tier label without the owner role/email is not owner.
  assert.equal(access({ role: 'user', email: 'x@y.com', subscription_tier: 'owner' }), 'free');
});

// ---------------------------------------------------------------------------
// Every gate uses the verified rule — no raw tier checks left behind
// ---------------------------------------------------------------------------

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every server gate resolves access through resolveAccessTier', () => {
  for (const path of ['lib/chatAccess.ts', 'api/david-chat.ts', 'api/david-trial.ts']) {
    const source = read(path);
    assert.match(source, /resolveAccessTier\(/, path);
    assert.match(source, /ENTITLEMENT_COLUMNS/, path);
    assert.doesNotMatch(source, /subscription_tier\s*===\s*'(plus|pro)'/, path);
  }
});

test('live voice on /api/chat requires Pro, not just Plus', () => {
  const source = read('lib/chatAccess.ts');
  assert.match(source, /options\.liveVoice \? canUsePro\(tier\) : canUsePremium\(tier\)/);
});

test('app screens gate on verified access, not the raw label', () => {
  assert.match(read('src/utils/tier.ts'), /resolveAccessTier/);
  assert.match(read('src/screens/ChatScreen.tsx'), /hasPremiumAccess\(profile\)/);
  assert.doesNotMatch(read('src/screens/ChatScreen.tsx'), /subscription_tier === 'pro'/);
  assert.doesNotMatch(read('src/screens/PaymentSuccessScreen.tsx'), /subscription_status === 'active'/);
});

test('the database reflection limit uses the same verified rule', () => {
  const sql = read('supabase/migrations/20261023230000_verify_paid_access_in_db.sql');
  assert.match(sql, /function public\.profile_access_tier/);
  assert.match(sql, /stripe_subscription_status in \('active', 'trialing'\)/);
  assert.match(sql, /stripe_current_period_end \+ interval '3 days' > pg_catalog\.now\(\)/);
  assert.match(sql, /v_access in \('owner', 'plus', 'pro'\)/);
});

test('the local dev server no longer grants Pro on any checkout', () => {
  const source = read('server.ts');
  assert.match(source, /processStripeEvent\(/);
  assert.doesNotMatch(source, /subscription_tier: 'pro'/);
});

// ---------------------------------------------------------------------------
// Webhook synchronization (lib/stripeWebhook.ts) with in-memory Stripe + DB
// ---------------------------------------------------------------------------

const PLUS = 'price_plus_test';
const PRO = 'price_pro_test';
const TIER_PRICES = { plus: PLUS, pro: PRO };

const loadWebhook = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'webhook-test-'));
  const stateUrl = pathToFileURL(new URL('../lib/subscriptionState.js', import.meta.url).pathname).href;
  const source = read('lib/stripeWebhook.ts').replace("'./subscriptionState.js'", `'${stateUrl}'`);
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
  const file = join(dir, 'stripeWebhook.mjs');
  writeFileSync(file, js);
  return import(pathToFileURL(file).href);
};
const { processStripeEvent } = await loadWebhook();

const fakeSupabase = (rows) => {
  const table = rows.map((row) => ({ ...row }));
  const query = (filters = [], patch = null) => {
    const api = {
      select: () => api,
      limit: () => api,
      eq: (col, val) => query([...filters, (r) => r[col] === val], patch),
      ilike: (col, val) => query([...filters, (r) => (r[col] || '').toLowerCase() === val.toLowerCase()], patch),
      update: (next) => query(filters, next),
      maybeSingle: async () => {
        const row = table.find((r) => filters.every((f) => f(r)));
        if (row && patch) Object.assign(row, patch);
        return { data: row ? { ...row } : null, error: null };
      },
    };
    return api;
  };
  return { from: () => query(), rows: table };
};

const fakeStripe = (subscriptions) => ({
  subscriptions: { retrieve: async (id) => structuredClone(subscriptions[id]) },
  customers: { retrieve: async (id) => ({ id, email: null }) },
});

const sub = (id, { status = 'active', price = PRO, customer = 'cus_1', userId = 'user_1', periodDays = 30 } = {}) => ({
  id,
  status,
  customer,
  metadata: userId ? { userId } : {},
  current_period_end: Math.floor((Date.now() + periodDays * DAY) / 1000),
  items: { data: [{ price: { id: price } }] },
});

const quiet = { log() {}, warn() {}, error() {} };
const run = (event, stripe, supabase) => processStripeEvent({ event, stripe, supabase, tierPrices: TIER_PRICES, logger: quiet });
const freeUser = (overrides = {}) => ({ id: 'user_1', email: 'customer@example.com', role: 'user', subscription_tier: 'free', ...overrides });

test('webhook: completed Pro checkout unlocks Pro with full Stripe identifiers', async () => {
  const db = fakeSupabase([freeUser()]);
  const stripe = fakeStripe({ sub_1: sub('sub_1') });
  await run({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', client_reference_id: 'user_1' } } }, stripe, db);
  const row = db.rows[0];
  assert.equal(row.subscription_tier, 'pro');
  assert.equal(row.stripe_customer_id, 'cus_1');
  assert.equal(row.stripe_subscription_id, 'sub_1');
  assert.equal(row.stripe_subscription_status, 'active');
  assert.equal(resolveAccessTier({ profile: row }), 'pro');
});

test('webhook: completed Plus checkout unlocks Plus only', async () => {
  const db = fakeSupabase([freeUser()]);
  const stripe = fakeStripe({ sub_1: sub('sub_1', { price: PLUS }) });
  await run({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', client_reference_id: 'user_1' } } }, stripe, db);
  assert.equal(resolveAccessTier({ profile: db.rows[0] }), 'plus');
});

test('webhook: an abandoned checkout (incomplete subscription) grants nothing', async () => {
  const db = fakeSupabase([freeUser()]);
  const stripe = fakeStripe({ sub_1: sub('sub_1', { status: 'incomplete' }) });
  await run({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', client_reference_id: 'user_1' } } }, stripe, db);
  assert.equal(db.rows[0].subscription_tier, 'free');
  assert.equal(resolveAccessTier({ profile: db.rows[0] }), 'free');
});

test('webhook: a subscription for another app\'s price is ignored', async () => {
  const db = fakeSupabase([freeUser()]);
  const stripe = fakeStripe({ sub_1: sub('sub_1', { price: 'price_some_other_app' }) });
  const result = await run({ type: 'customer.subscription.created', data: { object: sub('sub_1', { price: 'price_some_other_app' }) } }, stripe, db);
  assert.equal(result.ignored, true);
  assert.equal(db.rows[0].subscription_tier, 'free');
});

test('webhook: a failed payment reconciles to Stripe\'s current status immediately', async () => {
  const db = fakeSupabase([freeUser({ subscription_tier: 'pro', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', stripe_subscription_status: 'active' })]);
  const stripe = fakeStripe({ sub_1: sub('sub_1', { status: 'past_due' }) });
  await run({ type: 'invoice.payment_failed', data: { object: { id: 'in_1', subscription: 'sub_1' } } }, stripe, db);
  assert.equal(db.rows[0].stripe_subscription_status, 'past_due');
  assert.equal(resolveAccessTier({ profile: db.rows[0] }), 'free');
});

test('webhook: cancellation removes paid access', async () => {
  const db = fakeSupabase([freeUser({ subscription_tier: 'pro', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', stripe_subscription_status: 'active' })]);
  const stripe = fakeStripe({ sub_1: sub('sub_1', { status: 'canceled' }) });
  await run({ type: 'customer.subscription.deleted', data: { object: sub('sub_1', { status: 'canceled' }) } }, stripe, db);
  assert.equal(db.rows[0].subscription_tier, 'free');
  assert.equal(resolveAccessTier({ profile: db.rows[0] }), 'free');
});

test('webhook: a late, out-of-order "active" event cannot resurrect a canceled subscription', async () => {
  const db = fakeSupabase([freeUser({ stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', stripe_subscription_status: 'canceled' })]);
  const stripe = fakeStripe({ sub_1: sub('sub_1', { status: 'canceled' }) });
  // The stale event payload says active; Stripe's live state says canceled.
  await run({ type: 'customer.subscription.updated', data: { object: sub('sub_1', { status: 'active' }) } }, stripe, db);
  assert.equal(db.rows[0].subscription_tier, 'free');
  assert.equal(db.rows[0].stripe_subscription_status, 'canceled');
});

test('webhook: duplicate deliveries are harmless', async () => {
  const db = fakeSupabase([freeUser()]);
  const stripe = fakeStripe({ sub_1: sub('sub_1') });
  const event = { type: 'invoice.paid', data: { object: { id: 'in_1', subscription: 'sub_1' } } };
  await run(event, stripe, db);
  const first = { ...db.rows[0] };
  await run(event, stripe, db);
  assert.deepEqual(db.rows[0], first);
  assert.equal(resolveAccessTier({ profile: db.rows[0] }), 'pro');
});

test('webhook: an old subscription ending does not downgrade a customer paying on a newer one', async () => {
  const db = fakeSupabase([freeUser({ subscription_tier: 'pro', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_new', stripe_subscription_status: 'active', stripe_current_period_end: future() })]);
  const stripe = fakeStripe({ sub_old: sub('sub_old', { status: 'canceled' }) });
  const result = await run({ type: 'customer.subscription.deleted', data: { object: sub('sub_old', { status: 'canceled' }) } }, stripe, db);
  assert.equal(result.ignored, true);
  assert.equal(db.rows[0].subscription_tier, 'pro');
  assert.equal(db.rows[0].stripe_subscription_id, 'sub_new');
});

test('webhook: an email-only match tied to a different Stripe customer is ignored', async () => {
  const db = fakeSupabase([freeUser({ stripe_customer_id: 'cus_someone_else' })]);
  const stripeSub = sub('sub_1', { customer: 'cus_1', userId: null });
  const stripe = {
    subscriptions: { retrieve: async () => structuredClone(stripeSub) },
    customers: { retrieve: async () => ({ id: 'cus_1', email: 'customer@example.com' }) },
  };
  const result = await run({ type: 'customer.subscription.created', data: { object: stripeSub } }, stripe, db);
  assert.equal(result.ignored, true);
  assert.equal(db.rows[0].subscription_tier, 'free');
});

test('webhook: billing never changes the owner account', async () => {
  const db = fakeSupabase([freeUser({ role: 'owner', email: OWNER_EMAIL })]);
  const stripe = fakeStripe({ sub_1: sub('sub_1', { status: 'canceled' }) });
  await run({ type: 'customer.subscription.deleted', data: { object: sub('sub_1', { status: 'canceled' }) } }, stripe, db);
  assert.equal(db.rows[0].role, 'owner');
  assert.equal(resolveAccessTier({ profile: db.rows[0] }), 'owner');
});

test('webhook signatures are verified before any processing', () => {
  assert.match(read('api/stripe-webhook.ts'), /stripe\.webhooks\.constructEvent\(/);
  assert.match(read('supabase/functions/stripe-webhook/index.ts'), /constructEventAsync\(/);
  assert.match(read('server.ts'), /stripe\.webhooks\.constructEvent\(req\.rawBody/);
});
