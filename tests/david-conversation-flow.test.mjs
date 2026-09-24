import test from "node:test";
import assert from "node:assert/strict";

import {
  countDavidQuestions,
  detectDavidFlowStage,
  givesContext,
  mentionsScripture,
  namesFeeling,
  shapeDavidReply,
  splitSpokenSentences,
} from "../src/utils/davidConversationFlow.mjs";

const user = (content) => ({ role: "user", content });
const david = (content) => ({ role: "assistant", content });

/* ---------------- the required rhythm ---------------- */

test("the required flow: greeting, feeling, one question, reason, then Scripture, then plain talk", () => {
  const thread = [david("Hey, how's it going?")];

  thread.push(user("I'm not really feeling the greatest. I feel a little sad."));
  assert.equal(detectDavidFlowStage(thread), "feeling-only");

  thread.push(david("I'm sorry to hear that. What's going on?"));
  thread.push(user("I got evicted."));
  assert.equal(detectDavidFlowStage(thread), "ready-for-scripture");

  thread.push(david("That's a lot to lose at once. There's a line in Psalm 34 about God being close to the brokenhearted, and I think it fits because it's written for exactly this."));
  thread.push(user("Yeah. I don't even know where I'm sleeping tomorrow."));
  assert.equal(detectDavidFlowStage(thread), "after-scripture");
});

test("each of the example reasons is enough to turn to Scripture", () => {
  for (const reason of ["I got evicted.", "My boyfriend broke up with me.", "I got fired."]) {
    const thread = [david("Hey."), user("I feel a little sad."), david("Sorry to hear that. What happened?"), user(reason)];
    assert.equal(detectDavidFlowStage(thread), "ready-for-scripture", reason);
  }
});

test("a feeling on its own is never answered with a verse", () => {
  for (const text of ["I'm sad", "feeling anxious today", "I'm so tired of everything", "not feeling great", "I'm kind of down"]) {
    assert.equal(detectDavidFlowStage([david("Hey, how are you?"), user(text)]), "feeling-only", text);
  }
});

test("enough context in the very first message skips the question", () => {
  for (const text of [
    "I'm sad because my dad passed away last week",
    "I got fired today and I don't know what to do",
    "my boyfriend broke up with me last night",
  ]) {
    assert.equal(detectDavidFlowStage([david("Hey."), user(text)]), "ready-for-scripture", text);
  }
});

test("a vague answer to David's question still turns instead of asking again", () => {
  const thread = [user("I feel sad"), david("What's going on?"), user("idk, everything")];
  assert.equal(detectDavidFlowStage(thread), "ready-for-scripture");
});

test("once a verse has been given, David stays in plain conversation", () => {
  for (const reply of [
    "There's this line in Psalm 34 I keep coming back to.",
    "Isaiah 41:10 says it plainly.",
    "Paul wrote about that kind of peace in Philippians.",
    "There's a verse about that I love.",
  ]) {
    const thread = [user("I'm sad"), david("What happened?"), user("I got fired"), david(reply), user("thanks")];
    assert.equal(detectDavidFlowStage(thread), "after-scripture", reply);
  }
});

test("small talk and good news stay general", () => {
  for (const text of ["hi david", "what do you think about the weather", "I got the job!!", "lol my sermon notes make no sense"]) {
    assert.equal(detectDavidFlowStage([david("Hey."), user(text)]), "general", text);
  }
});

test("empty or malformed input never throws", () => {
  assert.equal(detectDavidFlowStage([]), "general");
  assert.equal(detectDavidFlowStage(undefined), "general");
  assert.equal(detectDavidFlowStage([null, {}, { role: "system", content: "x" }]), "general");
  assert.equal(detectDavidFlowStage([david("Hey.")]), "general");
});

/* ---------------- classifiers ---------------- */

test("feelings, context and Scripture are recognised", () => {
  assert.equal(namesFeeling("I'm anxious"), true);
  assert.equal(namesFeeling("what time is it"), false);
  assert.equal(givesContext("my landlord kicked me out"), true);
  assert.equal(givesContext("bad day"), false);
  assert.equal(mentionsScripture("Psalm 23 has that line about still waters."), true);
  assert.equal(mentionsScripture("That's rough. What happened?"), false);
  assert.equal(mentionsScripture("My surgery is at 3:15."), false);
});

/* ---------------- reply shaping ---------------- */

test("a reply is cut after David's first question so he never asks two", () => {
  const shaped = shapeDavidReply("That's rough. What happened? And how long ago was it?");
  assert.equal(shaped, "That's rough. What happened?");
  assert.equal(countDavidQuestions(shaped), 1);
});

test("a question inside quoted Scripture is not David asking a question", () => {
  const text = "\"Why are you downcast, O my soul?\" Psalm 42 asks that too. I think it fits. What happened?";
  assert.equal(shapeDavidReply(text), text);
  assert.equal(countDavidQuestions(text), 1);
  assert.deepEqual(splitSpokenSentences("\"Why are you downcast, O my soul?\" Psalm 42 asks that too."), [
    "\"Why are you downcast, O my soul?\" Psalm 42 asks that too.",
  ]);
});

test("a ramble is capped to a short spoken reply", () => {
  const long = Array.from({ length: 9 }, (_, i) => `Sentence number ${i + 1} here.`).join(" ");
  const shaped = shapeDavidReply(long, { maxSentences: 4 });
  assert.equal(splitSpokenSentences(shaped).length, 4);
});

test("markdown, brackets and stage directions never reach the voice", () => {
  assert.equal(shapeDavidReply("**Hey.** [VERSE USED: Psalm 23:1] *sighs* (pause) That's a lot."), "Hey. That's a lot.");
  assert.equal(shapeDavidReply("- first\n- second"), "first second");
});

test("verse references and abbreviations do not split sentences", () => {
  assert.deepEqual(splitSpokenSentences("Read Psalm 23.1 slowly. Then rest."), ["Read Psalm 23.1 slowly.", "Then rest."]);
  assert.deepEqual(splitSpokenSentences("Dr. Luke wrote it. Really."), ["Dr. Luke wrote it.", "Really."]);
});

test("shaping is safe on empty input", () => {
  assert.equal(shapeDavidReply(""), "");
  assert.equal(shapeDavidReply(undefined), "");
  assert.equal(shapeDavidReply(null), "");
});
