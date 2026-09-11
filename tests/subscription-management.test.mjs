import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/create-customer-portal-session/index.ts', import.meta.url), 'utf8');
function fixture({ authenticated = true, customerId = 'cus_own', feedback = false } = {}) {
  let handler;
  let updates = 0;
  const subscription = { id: 'sub_own', status: 'active', cancel_at_period_end: false, current_period_end: 1800000000 };
  const stripe = {
    customers: { retrieve: async id => { assert.equal(id, 'cus_own'); return { livemode: false }; } },
    subscriptions: {
      list: async ({ customer }) => { assert.equal(customer, 'cus_own'); return { data: [subscription] }; },
      update: async (id, patch) => { assert.equal(id, 'sub_own'); updates++; Object.assign(subscription, patch); return subscription; },
    },
  };
  function Stripe() { return stripe; }
  Stripe.createFetchHttpClient = () => ({});
  const query = { select: () => query, eq: (field, id) => { assert.equal(id, 'user_own'); return query; }, maybeSingle: async () => ({ data: { id: 'user_own', stripe_customer_id: customerId, stripe_subscription_id: 'sub_own', subscription_tier: 'pro' } }) };
  const context = {
    serve: fn => { handler = fn; }, Stripe, Request, Response, console,
    Deno: { env: { get: key => ({ SUPABASE_URL: 'https://example.supabase.co', STRIPE_SECRET_KEY: 'sk_test_fixture' })[key] } },
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'user_own' } : null } }) }, from: () => query }),
  };
  const code = ts.transpile(source.replace(/^import .*;\n/gm, ''), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
  vm.runInNewContext(code, context);
  return { updates: () => updates, request: (body, method = 'POST') => handler(new Request('https://example.com', { method, headers: { Authorization: 'Bearer fixture' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) })) };
}
test('Pro status loads; confirmed cancellation preserves paid access and is repeat safe', async () => {
  const app = fixture();
  const before = await (await app.request({ action: 'status' })).json();
  assert.equal(before.plan, 'pro'); assert.equal(before.status, 'active'); assert.equal(before.cancelAtPeriodEnd, false); assert.equal(app.updates(), 0);
  assert.equal((await app.request({ action: 'cancel' })).status, 400);
  assert.equal(app.updates(), 0);
  const canceled = await (await app.request({ action: 'cancel', confirm: true, customer: 'cus_attacker', subscription: 'sub_attacker' })).json();
  assert.equal(canceled.cancelAtPeriodEnd, true); assert.equal(canceled.status, 'active'); assert.equal(canceled.currentPeriodEnd, before.currentPeriodEnd);
  await app.request({ action: 'cancel', confirm: true });
  assert.equal(app.updates(), 1);
  assert.equal((await (await app.request({ action: 'status' })).json()).cancelAtPeriodEnd, true);
});
test('preflight succeeds and unauthenticated requests cannot cancel', async () => {
  const app = fixture({ authenticated: false });
  const preflight = await app.request({}, 'OPTIONS');
  assert.equal(preflight.status, 200); assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.equal((await app.request({ action: 'cancel', confirm: true })).status, 401); assert.equal(app.updates(), 0);
});
test('paid profile without Stripe customer receives actionable error', async () => {
  const app = fixture({ customerId: null });
  const response = await app.request({ action: 'status' });
  assert.equal(response.status, 409); assert.match((await response.json()).error, /subscription/);
});

test('profile flow: questionnaire, feedback, keep subscription, confirm, refreshed canceled status', async () => {
  const app = fixture();
  const states = []; let cursor = 0; let feedbackCount = 0; let effect;
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: 'Fragment' };
  const rn = new Proxy({ StyleSheet: { create: value => value } }, { get: (obj, key) => obj[key] || key });
  const supabase = { from: () => ({ insert: async row => { assert.equal(row.reason, 'I do not use it enough'); feedbackCount++; return {}; } }) };
  const source = readFileSync(new URL('../src/screens/ProfileScreen.tsx', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export default function', 'function');
  const code = ts.transpile(source, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
  const context = {
    React, ...Object.fromEntries(['ActivityIndicator','Linking','Modal','ScrollView','Text','TextInput','TouchableOpacity','View','StyleSheet'].map(key => [key, rn[key]])),
    ...Object.fromEntries(['Bookmark','Check','ChevronDown','ChevronRight','ChevronUp','HelpCircle','LogOut','Mail','Settings','ShieldCheck','Trash2','UserCircle2'].map(key => [key, key])),
    useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useEffect: (fn, deps) => { if (deps.length === 2 && deps[0] === 'subscription') effect = fn; },
    useUser: () => ({ profile: { id: 'user_own', subscription_tier: 'pro' }, refreshProfile: async () => {}, signOut() {} }),
    requestSubscription: async action => { const response = await app.request({ action, confirm: action === 'cancel' }); if (!response.ok) throw Error('billing error'); return response.json(); },
    supabase, APP_COLORS: {}, APP_FONTS: {}, OWNER_EMAIL: 'owner@example.com', hasProAccess: () => true, console,
  };
  vm.createContext(context); vm.runInContext(code + '\nthis.render = ProfileScreen;', context);
  const render = () => { cursor = 0; return context.render({}); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flat(Infinity).flatMap(nodes)];
  const text = tree => typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? tree.children.flat(Infinity).map(text).join('') : '';
  const press = async label => { const button = nodes(render()).find(n => n.type === 'TouchableOpacity' && text(n) === label); assert.ok(button, label); assert.ok(!button.props.disabled, `${label} enabled`); await button.props.onPress(); await new Promise(resolve => setImmediate(resolve)); };
  await press('Subscription'); render(); effect(); await new Promise(resolve => setImmediate(resolve));
  assert.match(text(render()), /Current plan: PRO/); assert.match(text(render()), /active — current period ends/);
  await press('CANCEL SUBSCRIPTION');
  assert.equal(nodes(render()).find(n => n.type === 'Modal').props.visible, true);
  assert.equal(app.updates(), 0);
  await press('I do not use it enough'); await press('CONTINUE TO CANCELLATION');
  assert.equal(feedbackCount, 1); assert.equal(app.updates(), 0);
  await press('KEEP SUBSCRIPTION'); assert.equal(app.updates(), 0);
  await press('CANCEL SUBSCRIPTION'); await press('SKIP FEEDBACK & CONTINUE');
  await press('CONFIRM CANCELLATION');
  assert.equal(app.updates(), 1); assert.match(text(render()), /Canceled — access ends/);
  assert.ok(!nodes(render()).some(n => n.type === 'TouchableOpacity' && text(n) === 'CANCEL SUBSCRIPTION'));
});
