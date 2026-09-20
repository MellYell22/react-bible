import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const authScreen = await readFile(
  new URL('../src/screens/AuthScreen.tsx', import.meta.url),
  'utf8',
);

test('auth screen guards against an unconfigured Supabase client', () => {
  assert.match(authScreen, /if \(!supabase\)/);
  assert.match(authScreen, /Sign in is temporarily unavailable/);
});

test('auth screen does not offer Apple or Google sign-in', () => {
  assert.doesNotMatch(authScreen, /signInWithOAuth/);
  assert.doesNotMatch(authScreen, /Continue with Apple/);
  assert.doesNotMatch(authScreen, /Continue with Google/);
});
