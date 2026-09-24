import test from "node:test";
import assert from "node:assert/strict";

import { buildOpeningRules } from "../src/utils/davidOpeningRules.mjs";

test("no opening and no stage falls back to the general conversation rules", () => {
  for (const opening of [null, undefined, ""]) {
    const rules = buildOpeningRules(opening);
    assert.match(rules, /NORMAL BACK-AND-FORTH/);
    assert.match(rules, /Never ask more than one question/i);
    assert.match(rules, /No filler sounds/i);
  }
});

test("a feeling without context asks one question and forbids Scripture", () => {
  const rules = buildOpeningRules(null, { stage: "feeling-only" });
  assert.match(rules, /NAMED A FEELING, NOT WHAT CAUSED IT/);
  assert.match(rules, /ask ONE simple question/i);
  assert.match(rules, /No Scripture yet/i);
  assert.match(rules, /Do not guess the cause/i);
});

test("once they have explained, David responds to the event then brings one verse", () => {
  const rules = buildOpeningRules(null, { stage: "ready-for-scripture" });
  assert.match(rules, /THIS IS THE TURN/);
  assert.match(rules, /respond briefly and honestly to the actual situation/i);
  assert.match(rules, /ONE fitting piece of Scripture/i);
  assert.match(rules, /why it fits/i);
  assert.match(rules, /Do not ask another intake question first/i);
  assert.match(rules, /ONE gentle question only if/i);
});

test("after Scripture David just talks and does not loop", () => {
  const rules = buildOpeningRules(null, { stage: "after-scripture" });
  assert.match(rules, /ALREADY BROUGHT SCRIPTURE IN/);
  assert.match(rules, /Do not offer another verse unless/i);
  assert.match(rules, /Do not restart the conversation/i);
  assert.match(rules, /Do not keep asking check-in questions/i);
});

test("an unknown stage never crashes and uses the general rules", () => {
  assert.match(buildOpeningRules(null, { stage: "mystery" }), /NORMAL BACK-AND-FORTH/);
  assert.match(buildOpeningRules(null, {}), /NORMAL BACK-AND-FORTH/);
});

test("every opening type forbids Scripture this turn", () => {
  for (const opening of ["greeting", "small-talk", "low-signal"]) {
    const rules = buildOpeningRules(opening);
    assert.match(rules, /Do NOT offer Scripture/i);
    assert.match(rules, /^THIS TURN IS/);
  }
});

test("the header names the specific opening type", () => {
  assert.match(buildOpeningRules("greeting"), /THIS TURN IS GREETING/);
  assert.match(buildOpeningRules("small-talk"), /THIS TURN IS SMALL-TALK/);
  assert.match(buildOpeningRules("low-signal"), /THIS TURN IS LOW-SIGNAL/);
});

test("greetings are one plain line with nothing added after", () => {
  const rules = buildOpeningRules("greeting");
  assert.match(rules, /"Hey\." "Hey, how are you\?" "Hi\." "Good morning\."/);
  assert.match(rules, /Nothing added after it/i);
});

test("the corny greetings are banned by name", () => {
  const rules = buildOpeningRules("greeting");
  for (const line of [
    "What's happening in your world?",
    "Hey friend, how's life?",
    "What's on the agenda today?",
    "Look who it is.",
    "Catch me up.",
    "How's life treating you?",
  ]) {
    assert.ok(rules.includes(line), `greeting rules should ban ${JSON.stringify(line)}`);
  }
});

test("small-talk gets its own line, low-signal does not", () => {
  const smallTalk = buildOpeningRules("small-talk");
  assert.match(smallTalk, /They are asking about you/);
  assert.doesNotMatch(smallTalk, /idk.*is not a crisis/);
});

test("low-signal gets its own line, small-talk does not", () => {
  const lowSignal = buildOpeningRules("low-signal");
  assert.match(lowSignal, /idk.*is not a crisis/);
  assert.doesNotMatch(lowSignal, /They are asking about you/);
});

test("an unrecognised opening still returns the shared rules, no crash", () => {
  const rules = buildOpeningRules("mystery-type");
  assert.match(rules, /THIS TURN IS MYSTERY-TYPE/);
  assert.match(rules, /Scripture/i);
});
