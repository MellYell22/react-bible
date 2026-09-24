import test from "node:test";
import assert from "node:assert/strict";

import { detectConversationOpening, isSubstantiveTurn } from "../src/utils/conversationOpening.mjs";

test("plain greetings are recognised, with or without David's name", () => {
  for (const text of [
    "hi David", "hi david", "Hi David!", "hey", "Hey!", "hello", "hey there",
    "yo", "howdy", "good morning", "Good Evening", "morning",
    "hey David 👋", "hello david its me",
  ]) {
    assert.equal(detectConversationOpening(text, []), "greeting", `expected greeting for ${text!==undefined?JSON.stringify(text):text}`);
  }
});

test("small talk about David is separated from greetings", () => {
  for (const text of ["what can you do?", "who are you", "are you real", "what is this", "how does this work", "how are you David?", "how are you?", "what's going on David?", "what's going on?", "hey David, how are you?"]) {
    assert.equal(detectConversationOpening(text, []), "small-talk", `for ${JSON.stringify(text)}`);
  }
});

test("low-signal replies are recognised", () => {
  for (const text of ["idk", "I don't know", "dunno", "nothing much", "not much", "meh", "ok", "fine", "sure"]) {
    assert.equal(detectConversationOpening(text, []), "low-signal", `for ${JSON.stringify(text)}`);
  }
});

test("a greeting carrying real content is NOT an opening", () => {
  // This is the case that must never suppress Scripture or mood handling:
  // the greeting is only the doorway into something that matters.
  for (const text of [
    "hey david, my wife is sick",
    "hi, I am really struggling today",
    "good morning, I couldn't sleep again",
  ]) {
    assert.equal(detectConversationOpening(text, []), null, `for ${JSON.stringify(text)}`);
  }
});

test("substantive messages are never treated as openings", () => {
  for (const text of [
    "I am really anxious about my job",
    "my dad passed away last month",
    "I don't know if I still believe any of this",
  ]) {
    assert.equal(detectConversationOpening(text, []), null, `for ${JSON.stringify(text)}`);
  }
});

test("once someone has opened up, a short reply belongs to that thread", () => {
  const history = ["my dad passed away last month"];
  // Answering "idk" here is part of the grief conversation, not a fresh opening,
  // so David must keep the context he already has instead of resetting.
  assert.equal(detectConversationOpening("idk", history), null);
  assert.equal(detectConversationOpening("hey", history), null);
});

test("empty and non-string input is handled", () => {
  for (const text of ["", "   ", null, undefined, 42, {}]) {
    assert.equal(detectConversationOpening(text, []), null, `for ${JSON.stringify(text)}`);
  }
  assert.equal(detectConversationOpening("hey", null), "greeting");
});

test("isSubstantiveTurn distinguishes real content from filler", () => {
  assert.equal(isSubstantiveTurn("my wife has cancer"), true);
  assert.equal(isSubstantiveTurn("hey"), false);
  assert.equal(isSubstantiveTurn("idk"), false);
  assert.equal(isSubstantiveTurn(""), false);
});
