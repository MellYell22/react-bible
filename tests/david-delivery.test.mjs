import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/utils/davidSpeechDelivery.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { sanitizeForDavidSpeech } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('speech keeps question intonation and thought boundaries without stage directions', () => {
  assert.equal(sanitizeForDavidSpeech('[warmly] You got the job! What part worries you?'), 'You got the job! What part worries you?');
  assert.equal(sanitizeForDavidSpeech('Take your time... we can talk — whenever you’re ready.'), "Take your time... we can talk — whenever you're ready.");
});

test('speech preparation is stable across client and server cleanup', () => {
  const text = 'It is okay... [pause] What feels hardest?';
  const once = sanitizeForDavidSpeech(text);
  assert.equal(sanitizeForDavidSpeech(once), once);
});

test('intentional ellipses survive repeated speech cleanup', () => {
  for (const text of ['I wonder… what changed?', 'I wonder...... what changed?']) {
    const result = sanitizeForDavidSpeech(text);
    assert.equal(result, 'I wonder... what changed?');
    assert.equal(sanitizeForDavidSpeech(result), result);
  }
});

test('approved sample C preserves plain punctuation without injected pauses', () => {
  for (const text of ["Okay. What do you think is making you feel that way?", "Hey. I'm David. What's on your mind?", "Yeah. That's hard.", "How are you doing today?"]) {
    assert.equal(sanitizeForDavidSpeech(text), text);
    assert.equal(sanitizeForDavidSpeech(sanitizeForDavidSpeech(text)), text);
  }
});

test('leading filler sounds never reach David display or speech', () => {
  assert.equal(sanitizeForDavidSpeech("Mm. That's a lot to carry."), "That's a lot to carry.");
  assert.equal(sanitizeForDavidSpeech("Mhmm... What happened?"), 'What happened?');
  assert.equal(sanitizeForDavidSpeech("Mm-hm. I get it."), 'I get it.');
  assert.equal(sanitizeForDavidSpeech("Um... give me a second."), 'give me a second.');
});

test('written sighs and mid-sentence filler never reach the voice', () => {
  assert.equal(sanitizeForDavidSpeech("Sigh. That's a lot."), "That's a lot.");
  assert.equal(sanitizeForDavidSpeech("Ugh, that's rough."), "that's rough.");
  assert.equal(sanitizeForDavidSpeech("Okay, mm, I get it."), 'Okay, I get it.');
  assert.equal(sanitizeForDavidSpeech("*sighs* That's hard. (pause) What happened?"), "That's hard. What happened?");
});

test('at most one ellipsis per reply, so the voice does not drift into dramatic pauses', () => {
  assert.equal(
    sanitizeForDavidSpeech("Well... I get it... and then... what happened?"),
    'Well... I get it, and then, what happened?',
  );
  assert.equal(
    sanitizeForDavidSpeech("Yeah... that's hard... You're not crazy."),
    "Yeah... that's hard. You're not crazy.",
  );
  const once = sanitizeForDavidSpeech("Yeah... that's hard... You're not crazy.");
  assert.equal(sanitizeForDavidSpeech(once), once, 'cleanup is stable');
});

test('quoted Scripture is never altered for rhythm', () => {
  const text = '"Be still... and know... that I am God." That line stays with me... every time.';
  assert.equal(sanitizeForDavidSpeech(text), text);
});
