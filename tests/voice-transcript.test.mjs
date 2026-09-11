import test from 'node:test';
import assert from 'node:assert/strict';
import { isMeaningfulTranscript } from '../src/utils/voiceTranscript.mjs';

test('accepts conversation without an emotion, including short replies', () => {
  for (const text of ['Hi', 'Hi David', 'David', 'How are you doing?', 'okay', 'ok', 'no', 'yes', 'yeah', 'mhm', 'thank you', 'bye', 'not really', "I'm sad", '7']) {
    assert.equal(isMeaningfulTranscript(text), true, text);
  }
});

test('still rejects silence and explicit nonverbal noise', () => {
  for (const text of ['', '  ', '...', '[music]', '(coughing)', 'cough', 'breathing', 'background noise', 'uh', 'um']) {
    assert.equal(isMeaningfulTranscript(text), false, text);
  }
});
