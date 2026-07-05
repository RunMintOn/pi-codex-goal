import assert from "node:assert/strict";
import test from "node:test";

import {
  TOOL_PROMPT_GUIDELINES,
  budgetLimitPrompt,
  compactContinuationPrompt,
  completionAuditContinuationPromptSection,
  completionAuditToolGuidelines,
  continuationGoalIdFromPrompt,
  continuationPrompt,
  goalToolReference,
  supersededContinuationMessage,
} from "../src/prompts.js";
import { createGoal } from "../src/state.js";

test("tool prompt guidelines use direct Pi goal tool names", () => {
  assert.equal(goalToolReference("update_goal"), "update_goal");

  const combined = TOOL_PROMPT_GUIDELINES.join("\n");
  assert.match(combined, /Use get_goal when/);
  assert.match(combined, /Use create_goal only when/);
  assert.match(combined, /Use update_goal with status complete/);
  assert.match(combined, /Use update_goal with status blocked/);
  assert.match(combined, /three consecutive goal turns/);
  assert.match(combined, /fresh blocked audit/);
  assert.doesNotMatch(combined, /pi__/);
  assert.doesNotMatch(combined, /namespaced equivalent/);
  for (const guideline of completionAuditToolGuidelines()) {
    assert.ok(TOOL_PROMPT_GUIDELINES.includes(guideline));
  }
});

test("continuation prompt uses the canonical completion-audit contract", () => {
  const created = createGoal(null, "ship it", 10).goal;
  assert.ok(created);

  const continuation = continuationPrompt(created);
  assert.match(continuation, /Continuation behavior:/);
  assert.match(continuation, /This goal persists across turns/);
  assert.match(continuation, /Work from evidence:/);
  assert.match(continuation, /current worktree and external state as authoritative/);
  assert.match(continuation, /Fidelity:/);
  assert.match(continuation, /Do not substitute a narrower, safer, smaller/);
  assert.match(continuation, /An edit is aligned only if it makes the requested final state more true/);
  assert.match(continuation, /Before deciding that the goal is achieved, perform a completion audit/);
  assert.match(continuation, /prompt-to-artifact checklist/);
  assert.match(continuation, /Do not accept proxy signals as completion by themselves/);
  assert.match(continuation, /Do not mark a goal complete merely because the budget is nearly exhausted/);
  assert.match(continuation, /Blocked audit:/);
  assert.match(continuation, /three consecutive goal turns/);
  assert.match(continuation, /fresh blocked audit/);
  assert.match(continuation, /truly at an impasse/);
  assert.doesNotMatch(continuation, /update_plan/);
  assert.doesNotMatch(continuation, /real blocker prevents progress now/);
  assert.ok(continuation.includes(completionAuditContinuationPromptSection().join("\n")));
});

test("compact continuation keeps marker detection without repeating the full objective", () => {
  const created = createGoal(null, "ship it", 10).goal;
  assert.ok(created);

  const compact = compactContinuationPrompt(created);
  const full = continuationPrompt(created);

  assert.equal(continuationGoalIdFromPrompt(compact), created.goalId);
  assert.match(compact, /<pi_goal_continuation goal_id="/);
  assert.doesNotMatch(compact, /<untrusted_objective>/);
  assert.match(compact, /get_goal/);
  assert.match(compact, /Blocked audit:/);
  assert.match(compact, /three consecutive goal turns/);
  assert.match(compact, /fresh blocked audit/);
  assert.ok(compact.length < full.length);
});

test("superseded continuation bookkeeping does not expose a runnable marker", () => {
  const created = createGoal(null, "ship it", 10).goal;
  assert.ok(created);

  const superseded = supersededContinuationMessage(created.goalId);
  assert.equal(continuationGoalIdFromPrompt(superseded), null);
  assert.match(superseded, /Superseded hidden goal continuation bookkeeping/);
});

test("continuation and budget-limit prompts reference direct goal-completion tool names", () => {
  const created = createGoal(null, "ship it", 10).goal;
  assert.ok(created);

  const continuation = continuationPrompt(created);
  const budget = budgetLimitPrompt(created);

  assert.match(budget, /marked the goal as budgetLimited/);
  assert.doesNotMatch(budget, /budget_limited/);

  for (const prompt of [continuation, budget]) {
    assert.match(prompt, /update_goal/);
    assert.doesNotMatch(prompt, /pi__/);
    assert.doesNotMatch(prompt, /namespaced equivalent/);
  }
});
