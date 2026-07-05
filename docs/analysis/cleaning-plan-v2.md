# pi-codex-goal 清理与 blocked 最小闭环：更新版执行计划

## 0. 背景判断

原 `cleaning-plan.md` 的方向基本正确：

1. 先清理工具注册和 prompt 中的噪音。
2. 再补 Codex 原版已有、当前缺失的 `blocked` 状态。
3. 不做 SQL、不做任务分类、不做复杂 evidence schema。

但原计划有两个需要修正的地方：

1. MCP / namespaced tool guidance 原本可能是上游兼容设计，不是无意义残留。
2. `blocked` 的实现链路比原计划写得更长，不能只改 `types.ts/state.ts/tools.ts/commands.ts/prompts.ts`。

用户已明确：本分支面向自己直接在 Pi 中使用，不使用 MCP / bridged MCP / namespaced tool 场景。

因此，本计划选择：

```text
Pi-native 简洁优先。
不保留 MCP/namespaced prompt 说明。
工具名只呈现 get_goal/create_goal/update_goal。
```

这会降低 MCP 桥接场景兼容性，但符合当前实际使用目标。

## 1. 总体原则

### 1.1 简单优先

```text
宁可比 Codex 原版稍微简单。
不要做得比 Codex 更复杂。
```

### 1.2 对齐 Codex 的行为，不机械复制架构

优先补：

- 工具名简洁
- prompt 简洁
- `blocked` 状态
- `update_goal(status: "blocked")`
- blocked 后停止自动续跑
- `/goal resume` 可继续 blocked goal

暂不做：

- SQL
- GoalService 大重构
- 自动任务分类
- evidence checklist schema
- blocked 三轮计数器
- metrics/analytics
- MCP/namespaced prompt 兼容

### 1.3 小步执行

建议分成两个独立提交：

```text
Commit 1: prompt/tool-name 清理
Commit 2: blocked 最小闭环
```

不要把文案清理和状态机改动混在一起。

## 2. 第一阶段：工具名与 prompt 清理

### 2.1 目标

让模型看到的工具说明更接近 Codex 原版：

```text
get_goal
create_goal
update_goal
```

不再出现：

```text
Codex-style
namespaced equivalent
pi__get_goal
pi__create_goal
pi__update_goal
bridged MCP
```

### 2.2 修改文件

```text
src/tools.ts
src/prompts.ts
test/prompts.test.ts
```

可能还会涉及：

```text
test 中直接断言工具 description 的文件，如果存在
```

### 2.3 具体改动

#### A. `src/tools.ts` 去掉 description 里的 `Codex-style`

当前：

```ts
description: "Get the current Codex-style goal and usage for this pi session."
description: "Create a Codex-style long-running goal for this pi session."
description: "Mark the current Codex-style goal complete only after..."
```

改为：

```ts
description: "Get the current goal and usage for this pi session."
description: "Create a long-running goal for this pi session."
description: "Mark the current goal complete only after..."
```

#### B. `src/prompts.ts` 简化 `goalToolReference()`

当前：

```ts
export function goalToolReference(toolName: GoalToolName): string {
  return `${toolName} (or the exposed namespaced equivalent, such as pi__${toolName})`;
}
```

改为：

```ts
export function goalToolReference(toolName: GoalToolName): string {
  return toolName;
}
```

#### C. 删除 `GOAL_TOOL_NAME_GUIDANCE`

删除常量：

```ts
export const GOAL_TOOL_NAME_GUIDANCE = ...
```

并从以下位置移除：

- `TOOL_PROMPT_GUIDELINES`
- `compactContinuationPrompt()`
- `continuationPrompt()`
- `budgetLimitPrompt()`

#### D. 更新 `test/prompts.test.ts`

旧测试目前明确断言：

```text
pi__get_goal
pi__create_goal
pi__update_goal
namespaced equivalent
available tool list
```

这些断言要改成：

- `goalToolReference("update_goal") === "update_goal"`
- prompt 中包含 `get_goal/create_goal/update_goal`
- prompt 中不包含 `pi__`
- prompt 中不包含 `namespaced equivalent`

### 2.4 风险

风险：低到中。

原因：

- 不改运行逻辑。
- 只改模型可见文本。
- 但会有测试更新。
- 会有意放弃 MCP/namespaced prompt 兼容。

### 2.5 验证

```text
npm install       # 如果 node_modules 不存在
npm test -- test/prompts.test.ts  # 如脚本不支持单文件，则 npm test
npm run typecheck
```

当前本地测试失败原因不是代码逻辑，而是缺少依赖：

```text
Cannot find package 'tsx'
```

所以正式验证前需要先安装依赖。

## 3. 第二阶段：blocked 最小闭环

## 3.1 目标

补 Codex 原版已有的能力：

```text
update_goal(status: "blocked")
```

但保持最小实现。

第一版 blocked 语义：

```text
active -> blocked
blocked -> active via /goal resume
blocked 后不自动 continuation
blocked 后不继续 accounting
blocked 不等于 complete
blocked 不显示 Goal achieved
```

第一版不做：

```text
blocked 三轮计数器
blocker_signature
复杂 evidence schema
自动判断 blocker 是否相同
```

### 3.2 受影响公共契约

这一步有行为影响，必须明确 blast radius。

会影响：

- `GoalStatus` 类型
- session custom entry 中 `set` entry 的 goal.status 可能出现 `blocked`
- `update_goal` 工具 schema
- `update_goal` 工具执行逻辑
- `/goal resume` 行为
- footer/status/summary 展示
- continuation 清理逻辑

不会改变：

- `get_goal` 工具名
- `create_goal` 工具名和现有参数
- `update_goal({ status: "complete" })` 现有行为
- session custom entry version
- runtime usage entry 只记录 active/budgetLimited 的原则

### 3.3 修改文件清单

必须改：

```text
src/types.ts
src/state.ts
src/tools.ts
src/goal-state-controller.ts
src/goal-runtime-controller.ts
src/goal-transition.ts
src/commands.ts
src/format.ts
src/prompts.ts
```

必须补测试：

```text
test/state.test.ts
test/prompts.test.ts
test/commands.test.ts
test/goal-transition.test.ts
test/goal-state-controller.test.ts
```

可能补测试：

```text
test/continuation.test.ts
test/queued-goal-work*.test.ts
```

### 3.4 具体改动

#### A. `src/types.ts`

```ts
export type GoalStatus = "active" | "paused" | "blocked" | "budgetLimited" | "complete";
```

保持：

```ts
export type RuntimeUsageGoalStatus = Extract<GoalStatus, "active" | "budgetLimited">;
```

也就是说，blocked 不写 runtime usage entry。

#### B. `src/state.ts`

`isGoalStatus()` 支持 blocked：

```ts
return status === "active" || status === "paused" || status === "blocked" || status === "budgetLimited" || status === "complete";
```

`updateGoalStatus()` 增加最小转移：

```text
active -> blocked
blocked -> active
```

建议规则：

```text
complete 仍然 terminal
只有 active 可以 blocked
只有 paused 或 blocked 可以 resume active
budgetLimited 不能 resume active
budgetLimited 不能 blocked
blocked 可以 complete? 暂时允许保持现有 complete 逻辑，避免过度收紧
```

注意：当前 `complete` 分支在 pause/resume 检查前面，所以 blocked -> complete 会被允许。这个符合“不要过度复杂”的原则。

#### C. `src/tools.ts`

Schema 改为：

```ts
status: StringEnum(["complete", "blocked"] as const, ...)
```

但更关键的是 execute 不能忽略 params。

当前错误风险：

```ts
async execute(_toolCallId, _params, ...) {
  const result = host.completeGoal("tool", ctx);
}
```

必须改成：

```ts
async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
  const result = params.status === "blocked"
    ? host.blockGoal("tool", ctx)
    : host.completeGoal("tool", ctx);
}
```

`ToolHost` 增加：

```ts
blockGoal(source: GoalEntrySource, ctx: ExtensionContext): GoalResult;
```

#### D. `src/goal-state-controller.ts`

接口增加：

```ts
blockGoal(source: GoalEntrySource, ctx: ExtensionContext): GoalResult;
```

实现类似 `completeGoal()`：

```ts
const blockGoal = (source, ctx) => {
  const goal = getGoal();
  const result = updateGoalStatus(goal, "blocked");
  if (!result.ok || !result.goal) return result;
  if (goal && goalsEquivalent(goal, result.goal)) return result;
  applyGoalTransition({ kind: "set", nextGoal: result.goal, source }, ctx);
  return result;
};
```

#### E. `src/goal-runtime-controller.ts`

接口增加：

```ts
blockGoal(source, ctx): GoalResult;
```

注册工具时传入：

```ts
blockGoal: controller.blockGoal.bind(controller)
```

实现中建议和 complete 类似，但不需要 completion budget report：

```ts
const blockGoal = (source, ctx) => {
  providerLimitAutoResume.clear();
  goalAccounting.accountProgress(ctx, false, 0, true);
  return stateController.blockGoal(source, ctx);
};
```

resume 逻辑要支持 blocked：

当前 `resumeGoalWithContinuation()` 内部调用了：

```ts
stateController.resumePausedGoal(ctx)
```

需要改名或扩展为：

```ts
stateController.resumeStoppedGoal(ctx)
```

或者保持名字但让它支持 paused/blocked。为减少重命名影响，建议先保持名字，内部扩展支持 blocked。

#### F. `src/goal-transition.ts`

`memoryEffectsFromGoalChange()` 增加：

```ts
else if (next.status === "blocked") {
  clearContinuation
  clearActiveAccounting
}
```

`planDerivedResumeActiveTransition()` 当前要求：

```ts
requireStatus(current, "paused", kind);
```

改成允许：

```text
paused 或 blocked
```

可以新增 helper：

```ts
function requireStatusOneOf(...)
```

也可以简单写 if，避免抽象过度。

`commandAfterPersistEffects()` 中 `wasPausedBefore` 可改成：

```ts
const wasStoppedBefore = current?.status === "paused" || current?.status === "blocked";
```

这样 command resume 后 resetRecovery 仍合理。

#### G. `src/commands.ts`

`/goal resume` 支持 blocked：

```ts
if (trimmed === "resume" && (current?.status === "paused" || current?.status === "blocked")) {
  ...
}
```

替换目标时：

```ts
if (current && current.status !== "complete")
```

无需改。blocked 仍是 non-complete goal，替换前应确认。

#### H. `src/format.ts`

必须补 blocked 展示，避免显示成 achieved。

`statusLabel()`：

```ts
if (status === "blocked") return "blocked";
```

`commandHint()`：

```ts
if (status === "paused" || status === "blocked") {
  return "/goal copy, /goal resume, /goal clear";
}
```

`formatFooterStatus()`：

```ts
if (goal.status === "blocked") {
  return "Goal blocked (/goal resume)";
}
```

#### I. `src/prompts.ts`

工具 guidelines 增加一句最小 blocked 规则：

```text
Use update_goal with status blocked only when the objective cannot currently be completed because of a real blocker; do not use blocked for ordinary uncertainty, low budget, or because you are stopping work.
```

completion audit 中可补一句：

```text
If the objective is not complete but a real blocker prevents progress, use update_goal with status "blocked" instead of marking complete.
```

不要加入复杂三轮计数器，除非后续用户明确要更贴 Codex。

### 3.5 测试计划

#### `test/state.test.ts`

新增：

```text
active -> blocked 成功
blocked -> active 成功
blocked 不接受 pause
budgetLimited 不接受 blocked
complete 仍 terminal
blocked -> complete 保持允许或明确测试当前选择
```

#### `test/prompts.test.ts`

更新：

```text
不再包含 pi__*
不再包含 namespaced equivalent
包含 update_goal status blocked 指引
```

#### `test/commands.test.ts`

新增：

```text
/goal resume 可以恢复 blocked goal
blocked goal summary hint 包含 /goal resume
```

#### `test/goal-transition.test.ts`

新增：

```text
blocked transition 清 continuation + active accounting
resume_active 支持 blocked -> active
runtime accounting 不接受 blocked
```

#### `test/goal-state-controller.test.ts`

新增：

```text
blockGoal 持久化 set entry
blocked 后不会继续 active accounting
```

#### `test/format.test.ts` 或 `state.test.ts` 中已有 formatter 测试

新增：

```text
blocked footer 不显示 Goal achieved
blocked summary hint 包含 /goal resume
```

### 3.6 验证命令

先安装依赖：

```text
npm install
```

然后：

```text
npm run typecheck
npm test
```

如果只想快速验证第一阶段：

```text
npm test -- test/prompts.test.ts
```

如果 test runner 不支持该形式，就直接跑：

```text
npm test
```

## 4. 不做项

本轮明确不做：

```text
- SQL / SQLite backend
- GoalStore 抽象
- GoalService facade
- usageLimited
- blocked 三轮计数器
- blocker signature
- evidence checklist schema
- 自动任务分类
- MCP/namespaced guidance 兼容
- package/README 大范围措辞清理
```

## 5. 最终执行顺序

推荐实际执行：

```text
Step 1: prompt/tool-name 清理
Step 2: 更新 prompts 测试
Step 3: 跑 typecheck/test，确认文案清理无行为破坏
Step 4: blocked 状态类型和 state.ts
Step 5: tools/controller/runtime 接线
Step 6: transition/commands/format 补齐
Step 7: prompts 增加 blocked 指引
Step 8: 补测试
Step 9: 跑 typecheck/test
```

如果要更稳，可以拆成两个提交：

```text
commit A: remove MCP/namespaced prompt guidance for Pi-native usage
commit B: add minimal blocked goal status
```

## 6. 最终判断

这个更新版计划可以执行。

相比原计划，主要修正是：

1. MCP/namespaced 删除是明确产品取舍，不再假装“无影响”。
2. blocked 不再低估为 5–6 个文件的小改，而是按完整链路执行。
3. 不引入比 Codex 更复杂的机制。
4. 先做最小闭环，再考虑是否继续补 usageLimited 或更严格 blocked audit。
