# Prompt 对齐方案 v2：continuation 增补 + strict blocked audit

## 0. 原则

本轮目标是让 `pi-codex-goal` 的 continuation prompt 更接近 Codex 原版行为，但不引入比 Codex 更复杂的机制。

原则：

```text
尽量向 Codex 实现靠齐。
不自己多搞额外概念。
不做 runtime blocked 计数器。
不做 evidence schema。
不做 update_plan 替代品。
```

本轮只改 prompt/tool 文案和对应测试，不改状态机、不改持久化、不改工具参数结构。

## 1. 背景

Codex 原版 `continuation.md` 位于：

```text
D:/tmp/codex-source/openai-codex/codex-rs/ext/goal/templates/goals/continuation.md
```

它包含这些主要段落：

```text
Header + Objective
Continuation behavior
Budget
Work from evidence
Progress visibility
Fidelity
Completion audit
Blocked audit
Final update_goal warning
```

当前 `pi-codex-goal` 已有：

```text
Header + Objective
Budget
Completion audit
基础 blocked 提醒
```

缺少或不完整：

```text
Continuation behavior
Work from evidence
Fidelity
Strict blocked audit
```

明确跳过：

```text
Progress visibility
```

原因：Codex 这里依赖 `update_plan`；Pi 当前没有 `update_plan`，也不计划为了这次 prompt alignment 新增一个替代工具。

## 2. 当前代码状态

当前目标仓库：

```text
D:/tmp/pi-goal-ext/repos/pi-codex-goal
```

当前 `src/prompts.ts` 里：

- `continuationPrompt()` 负责完整 hidden continuation prompt。
- `compactContinuationPrompt()` 负责压缩版 continuation prompt。
- `completionAuditContinuationPromptSection()` 负责 completion audit 段。
- `TOOL_PROMPT_GUIDELINES` 会出现在工具 prompt guidance 中。

注意：上一个版本的计划说 “替换 `continuationPrompt()` 末尾的 blocked 单行”。这已经不准确。

当前 weak blocked 说明在：

```ts
completionAuditContinuationPromptSection()
```

里面：

```text
If the objective is not complete but a real blocker prevents progress now, use status "blocked" instead.
```

所以本轮必须同时处理这个弱说明，避免和新的 strict blocked audit 前后不一致。

## 3. 目标行为

改完后，模型在 continuation 时应该收到更接近 Codex 的指令：

1. 目标跨 turn 持久化，不要把 objective 缩小成当前 turn 能做完的小任务。
2. 当前 worktree / 外部状态是权威证据，不要只凭对话记忆。
3. 每一轮都要朝真实 requested end state 前进，不要选更容易通过测试的小目标。
4. complete 前仍按现有 completion audit 严格审查。
5. blocked 只能在 strict blocked audit 满足后使用：同一阻塞条件连续至少 3 个 goal turn。
6. resumed blocked goal 的 blocked audit 重新开始。

## 4. 不做的事

| 不做 | 理由 |
|---|---|
| runtime blocked 计数器 | Codex 主要也是 prompt/tool spec 约束；不做得比 Codex 更复杂 |
| blocker signature 字段 | 额外 schema，不是 Codex 必需 |
| evidence checklist schema | 复杂化工具 API，不符合本轮目标 |
| update_plan 替代品 | Pi 没有该工具，本轮不新增 |
| SQL / persistence 改动 | 与 prompt alignment 无关 |
| budgetLimitPrompt 大改 | 当前 budget prompt 已完整，非本轮重点 |
| prompt 模板文件化 | 可以以后做，本轮保持小改 |

## 5. 改动范围

预计改动文件：

```text
src/prompts.ts
src/tools.ts
test/prompts.test.ts
```

可能涉及：

```text
test/continuation.test.ts
```

如果现有测试没有断言新增文案，则只改 `test/prompts.test.ts` 即可。

## 6. 具体实现计划

### 6.1 `src/prompts.ts`：新增 continuation 行为段落 helper

新增 helper：

```ts
function continuationBehaviorPromptSection(): string[] {
  return [
    "Continuation behavior:",
    "- This goal persists across turns. Ending this turn does not require shrinking the objective to what fits now.",
    "- Keep the full objective intact. If it cannot be finished now, make concrete progress toward the real requested end state, leave the goal active, and do not redefine success around a smaller or easier task.",
    "- Temporary rough edges are acceptable while the work is moving in the right direction. Completion still requires the requested end state to be true and verified.",
  ];
}
```

来源：Codex `continuation.md` 的 `Continuation behavior` 段。

### 6.2 `src/prompts.ts`：新增 work-from-evidence 段落 helper

新增 helper：

```ts
function workFromEvidencePromptSection(): string[] {
  return [
    "Work from evidence:",
    "Use the current worktree and external state as authoritative. Previous conversation context can help locate relevant work, but inspect the current state before relying on it. Improve, replace, or remove existing work as needed to satisfy the actual objective.",
  ];
}
```

来源：Codex `continuation.md` 的 `Work from evidence` 段。

### 6.3 `src/prompts.ts`：新增 fidelity 段落 helper

新增 helper：

```ts
function fidelityPromptSection(): string[] {
  return [
    "Fidelity:",
    "- Optimize each turn for movement toward the requested end state, not for the smallest stable-looking subset or easiest passing change.",
    "- Do not substitute a narrower, safer, smaller, merely compatible, or easier-to-test solution because it is more likely to pass current tests.",
    "- Treat alignment as movement toward the requested end state. An edit is aligned only if it makes the requested final state more true; useful-looking behavior that preserves a different end state is misaligned.",
  ];
}
```

说明：保留 Codex 原版三条，不删第三条。

理由：我们原则是尽量对齐 Codex；第三条虽然和前两条相关，但它强调“aligned edit”的判定，对防止做无关但看起来有用的改动有价值。

### 6.4 `src/prompts.ts`：新增 strict blocked audit helper

新增导出或非导出 helper 均可。若测试需要直接断言 helper，可导出；否则只断言最终 prompt。

推荐非导出，保持 API 简单：

```ts
function blockedAuditContinuationPromptSection(): string[] {
  return [
    "Blocked audit:",
    `- Do not call ${goalToolReference("update_goal")} with status "blocked" the first time a blocker appears.`,
    `- Only use status "blocked" when the same blocking condition has repeated for at least three consecutive goal turns, counting the original/user-triggered turn and any automatic goal continuations.`,
    `- If the user resumes a goal that was previously marked "blocked", treat the resumed run as a fresh blocked audit. If the same blocking condition then repeats for at least three consecutive resumed goal turns, call ${goalToolReference("update_goal")} with status "blocked" again.`,
    `- Use status "blocked" only when you are truly at an impasse and cannot make meaningful progress without user input or an external-state change.`,
    `- Once the blocked threshold is satisfied, do not keep reporting that you are still blocked while leaving the goal active; call ${goalToolReference("update_goal")} with status "blocked".`,
    `- Never use status "blocked" merely because the work is hard, slow, uncertain, incomplete, or would benefit from clarification.`,
    "",
    `Do not call ${goalToolReference("update_goal")} unless the goal is complete or the strict blocked audit above is satisfied. Do not mark a goal complete merely because the budget is nearly exhausted or because you are stopping work.`,
  ];
}
```

来源：Codex `continuation.md` 的 `Blocked audit` 和最后一行 warning。

Pi 本土化：只把 tool name 通过 `goalToolReference("update_goal")` 渲染，仍然是 `update_goal`，不恢复 MCP/namespaced 说明。

### 6.5 `src/prompts.ts`：修改 completion audit 末尾弱 blocked 句子

当前：

```ts
`Do not call ${UPDATE_GOAL_REF_PLACEHOLDER} with status "complete" unless the goal is complete. Do not mark a goal complete merely because the budget is nearly exhausted or because you are stopping work. If the objective is not complete but a real blocker prevents progress now, use status "blocked" instead.`
```

改为：

```ts
`Do not call ${UPDATE_GOAL_REF_PLACEHOLDER} with status "complete" unless the goal is complete. Do not mark a goal complete merely because the budget is nearly exhausted or because you are stopping work.`
```

原因：blocked 的严格条件放到独立 `Blocked audit` 段，避免一个弱 blocked 句子和 strict blocked audit 冲突。

### 6.6 `src/prompts.ts`：修改 `continuationPrompt()` 结构

当前大致结构：

```ts
objective
budget
Avoid repeating work...
completionAuditContinuationPromptSection()
```

改为：

```ts
objective
continuationBehaviorPromptSection()
budget
workFromEvidencePromptSection()
fidelityPromptSection()
Avoid repeating work...
completionAuditContinuationPromptSection()
blockedAuditContinuationPromptSection()
```

说明：

- `Continuation behavior` 放 objective 后、budget 前，对齐 Codex。
- `Work from evidence` 和 `Fidelity` 放 budget 后、completion audit 前，对齐 Codex。
- `Avoid repeating work...` 是 Pi 现有本土化句子，可保留，放在 Fidelity 后。
- `Blocked audit` 放 completion audit 后，对齐 Codex。

### 6.7 `src/prompts.ts`：修改 `compactContinuationPrompt()` 的 blocked 句子

当前：

```ts
`If a real blocker prevents completing the objective now, call ${goalToolReference("update_goal")} with status "blocked" instead of marking complete.`
```

改为一行精简版：

```ts
`Blocked audit: do not use status "blocked" the first time a blocker appears. Only use status "blocked" when the same blocking condition repeats for at least three consecutive goal turns. A resumed goal starts a fresh blocked audit.`,
```

原因：compact prompt 可能更频繁出现在 context 中，不展开完整 blocked audit，但必须保留核心三轮规则。

### 6.8 `src/prompts.ts`：修改 `TOOL_PROMPT_GUIDELINES` 的 blocked 指引

当前：

```ts
Use update_goal with status blocked only when a real blocker prevents completing the objective now; do not use blocked for ordinary uncertainty, low budget, or because you are stopping work.
```

改为：

```ts
Use update_goal with status blocked only after the same blocking condition has repeated for at least three consecutive goal turns and you are at an impasse; after a blocked goal is resumed, start a fresh blocked audit.
```

原因：工具 guidance、tool schema、continuation prompt 必须一致。

### 6.9 `src/tools.ts`：修改 `UpdateGoalParams` description

当前：

```ts
"Set to complete only when the objective is achieved and no required work remains. Set to blocked only when a real blocker prevents completing the objective now."
```

改为：

```ts
"Set to complete only when the objective is achieved and no required work remains. Set to blocked only after the same blocking condition has repeated for at least three consecutive goal turns and the agent is at an impasse. After a previously blocked goal is resumed, the resumed run starts a fresh blocked audit."
```

来源：Codex `spec.rs` 参数 description。

### 6.10 `src/tools.ts`：修改 `update_goal` top-level description

当前：

```ts
"Mark the current goal complete only after the objective is actually achieved, or blocked only when a real blocker prevents completing it now. Do not use this tool just because work is stopping, budget is low, or partial progress looks sufficient."
```

改为更接近 Codex：

```ts
"Update the existing goal. Use this tool only to mark the goal achieved or genuinely blocked. Set status to complete only when the objective has actually been achieved and no required work remains. Set status to blocked only when the same blocking condition has repeated for at least three consecutive goal turns and the agent cannot make meaningful progress without user input or an external-state change. After a previously blocked goal is resumed, the resumed run starts a fresh blocked audit."
```

### 6.11 `src/tools.ts`：修改 `update_goal` promptSnippet

当前：

```ts
"Mark the current goal complete only after an evidence-backed completion audit proves no required work remains, or blocked only when a real blocker prevents completion now."
```

改为：

```ts
"Mark the current goal complete only after an evidence-backed completion audit proves no required work remains, or blocked only after the strict blocked audit is satisfied."
```

## 7. 测试更新

### 7.1 `test/prompts.test.ts`

更新或新增测试：

1. `continuationPrompt()` 包含新增 Codex 段落：

```text
Continuation behavior:
This goal persists across turns
Work from evidence:
Use the current worktree and external state as authoritative
Fidelity:
Do not substitute a narrower, safer, smaller
Blocked audit:
three consecutive goal turns
fresh blocked audit
truly at an impasse
```

2. `continuationPrompt()` 不包含：

```text
update_plan
pi__
namespaced equivalent
```

3. `compactContinuationPrompt()` 包含精简 blocked audit：

```text
Blocked audit:
three consecutive goal turns
fresh blocked audit
```

4. `completionAuditContinuationPromptSection()` 不再包含弱 blocked 句子：

```text
real blocker prevents progress now
```

或者更直接：完整 continuation 中只允许出现 strict blocked audit 的三轮规则。

### 7.2 `test/continuation.test.ts`

如果已有测试只看 prompt 长度或 marker，不需要改。

如果因为新增 prompt 变长导致 compact/full 长度断言仍成立，则无需改。

### 7.3 工具描述测试

当前测试主要通过 behavior 验证 tool，不一定捕获 `UpdateGoalParams` description。

本轮可以不新增复杂工具 schema introspection 测试；但如果容易拿到注册工具 spec，可以加轻量断言：

```text
update_goal description 包含 three consecutive goal turns
```

如果测试 harness 不方便，不强求。

## 8. 验证命令

执行后必须跑：

```text
npm run typecheck
npm test
```

不需要跑 platform smoke。

## 9. 风险评估

### 风险 1：prompt 变长

可接受。

原因：这是 Codex 原版已有内容，不是自定义堆 prompt。新增内容集中在 continuation prompt，不改变 runtime 逻辑。

### 风险 2：blocked 三轮规则只有 prompt 约束，没有 runtime 强制

可接受。

原因：Codex 原版也是主要通过 tool spec / prompt 约束，并没有在 `tool.rs` 中做 blocker signature / 三轮计数器强制。

### 风险 3：strict blocked audit 可能让模型更晚调用 blocked

这是预期行为。

Codex 的目标就是避免模型第一次遇到问题就 blocked。

### 风险 4：跳过 update_plan 会不会偏离 Codex

这是合理 Pi 本土化。

Codex 原文也是 “If update_plan is available”。Pi 当前没有该工具，不应该为了 prompt parity 新增复杂工具。

## 10. 最终结论

本方案可以执行。

它是一个纯 prompt/tool wording alignment：

```text
Codex continuation 行为段落 + strict blocked audit
```

不改变状态机、不改变持久化、不改变工具 schema 结构。

执行后，`pi-codex-goal` 会更接近 Codex 原版的续跑行为约束，同时仍保持 Pi-native 简洁实现。
