// A subscriber whose card failed must be able to pay again. The app treats a
// past_due/unpaid subscription as free, so checkout must send them to update
// their card — never answer "already subscribed" and never open a second
// subscription next to the unpaid one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const PLUS = 'price_plus_test';
const PRO = 'price_pro_test';
const source = readFileSync(new URL('../supabase/functions/create-checkout-session/index.ts', import.meta.url), 'utf8');

function fixture({ subscriptions = [], customerId = 'cus_own' } = {}) {
  let handler;
  const calls = { portal: 0, checkout: 0, update: 0 };
  const stripe = {
    prices: { retrieve: async (id) => ({ id, active: true, type: 'recurring', recurring: { interval: 'month' }, livemode: false, unit_amount: id === PRO ? 1299 : 999, currency: 'usd' }) },
    customers: { retrieve: async () => ({ id: customerId, livemode: false }) },
    subscriptions: {
      list: async () => ({ data: subscriptions }),
      update: async (id, patch) => { calls.update++; return { id, status: 'active', current_period_end: 1900000000, ...patch }; },
    },
    billingPortal: { sessions: { create: async ({ customer }) => { calls.portal++; assert.equal(customer, customerId); return { id: 'bps_1', url: 'https://billing.stripe.test/portal' }; } } },
    checkout: { sessions: { create: async () => { calls.checkout++; return { id: 'cs_1', url: 'https://checkout.stripe.test/new' }; } } },
  };
  function Stripe() { return stripe; }
  Stripe.createFetchHttpClient = () => ({});
  const profile = { id: 'user_own', email: 'customer@example.com', subscription_tier: 'free', stripe_customer_id: customerId, stripe_subscription_id: subscriptions[0]?.id ?? null, stripe_subscription_status: subscriptions[0]?.status ?? null };
  const query = { select: () => query, eq: () => query, update: () => query, maybeSingle: async () => ({ data: profile, error: null }), then: (r) => r({ error: null }) };
  const env = { SUPABASE_URL: 'https://example.supabase.co', STRIPE_SECRET_KEY: 'sk_test_fixture', APP_URL: 'https://app.example.com', STRIPE_PRICE_ID_PLUS: PLUS, STRIPE_PRICE_ID_PRO: PRO };
  const context = {
    serve: (fn) => { handler = fn; }, Stripe, Request, Response, console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: (key) => env[key] } },
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user_own', email: 'customer@example.com' } } }) }, from: () => query }),
  };
  const code = ts.transpile(source.replace(/^import .*;\n/gm, ''), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
  vm.runInNewContext(code, context);
  const request = async (plan) => {
    const response = await handler(new Request('https://example.com', { method: 'POST', headers: { Authorization: 'Bearer fixture' }, body: JSON.stringify({ plan }) }));
    return { status: response.status, body: await response.json() };
  };
  return { request, calls };
}

const sub = (status, price = PRO) => ({ id: 'sub_old', status, cancel_at_period_end: false, current_period_end: 1900000000, items: { data: [{ id: 'si_1', price: { id: price } }] } });

test('a past_due subscriber trying Pro again is sent to update their card', async () => {
  const app = fixture({ subscriptions: [sub('past_due')] });
  const { status, body } = await app.request('pro');
  assert.equal(status, 200);
  assert.equal(body.recoverPayment, true);
  assert.equal(body.url, 'https://billing.stripe.test/portal');
  assert.equal(app.calls.checkout, 0, 'no second subscription');
  assert.equal(app.calls.update, 0, 'no plan switch on an unpaid subscription');
});

test('a past_due subscriber picking the other plan is also sent to update their card first', async () => {
  const app = fixture({ subscriptions: [sub('past_due', PLUS)] });
  const { body } = await app.request('pro');
  assert.equal(body.recoverPayment, true);
  assert.equal(app.calls.update, 0);
  assert.equal(app.calls.checkout, 0);
});

test('an unpaid subscriber is sent to update their card instead of a second checkout', async () => {
  const app = fixture({ subscriptions: [sub('unpaid')] });
  const { body } = await app.request('pro');
  assert.equal(body.recoverPayment, true);
  assert.equal(app.calls.checkout, 0);
});

test('an active Pro subscriber is still told they already have Pro', async () => {
  const app = fixture({ subscriptions: [sub('active')] });
  const { status } = await app.request('pro');
  assert.equal(status, 409);
  assert.equal(app.calls.portal, 0);
});

test('an active Plus subscriber upgrading to Pro still switches plans', async () => {
  const app = fixture({ subscriptions: [sub('active', PLUS)] });
  const { body } = await app.request('pro');
  assert.equal(body.switched, true);
  assert.equal(app.calls.update, 1);
});

test('someone whose old subscription was canceled gets a normal new checkout', async () => {
  const app = fixture({ subscriptions: [sub('canceled')] });
  const { body } = await app.request('pro');
  assert.equal(body.url, 'https://checkout.stripe.test/new');
  assert.equal(app.calls.checkout, 1);
});
