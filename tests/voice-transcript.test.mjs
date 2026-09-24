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

test('laughs, starred sounds and Whisper hallucinations are not a turn', () => {
  for (const text of [
    'haha', 'Ha ha ha.', 'hehe', 'lol',
    '*cough*', '*cough* *cough*', '[laughs]', '(sniffs) (coughs)', '*laughs* [music]',
    'Thanks for watching!', 'thank you for watching', 'Subtitles by the Amara.org community', 'www.example.com',
  ]) {
    assert.equal(isMeaningfulTranscript(text), false, text);
  }
});

test('real words that merely contain a laugh are still a turn', () => {
  for (const text of ['haha that was funny', 'I laughed so hard', 'ha that is every sermon', 'thank you']) {
    assert.equal(isMeaningfulTranscript(text), true, text);
  }
});
