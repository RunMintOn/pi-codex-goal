# pi-codex-goal 工具注册定义：清理改动清单

## 原则

**以 Codex 的注册定义为基准，除非 Pi 环境不兼容或确实不合适。**

每一项改动都问两个问题：
1. Codex 有没有这个设计？→ 有就对齐，没有就判断是否需要
2. 如果是 Pi 环境的必要适配？→ 保留。如果是历史残留或风格差异？→ 去掉

---

## P0：必须改（低风险，1 行各）

### 1–3. 去掉 description 中的 "Codex-style"

**文件：** `src/tools.ts`

| 位置 | 当前 | 改为 |
|---|---|---|
| 第 73 行（get_goal） | `"Get the current Codex-style goal and usage for this pi session."` | `"Get the current goal and usage for this pi session."` |
| 第 93 行（create_goal） | `"Create a Codex-style long-running goal for this pi session."` | `"Create a long-running goal for this pi session."` |
| 第 136 行（update_goal） | `"Mark the current Codex-style goal complete only after..."` | `"Mark the current goal complete only after..."` |

**理由：** 模型不知道 Codex 是什么。这个词不传递任何信息。Codex 原版没有加这类修饰（`spec.rs` 中 `get_goal description` 直接写 `"Get the current goal for this thread..."`）。

**改动量：** 3 行，只改字符串字面量。

---

## P0：建议改（低风险，集中在 prompts.ts）

### 4. 简化 `goalToolReference()` 返回格式

**文件：** `src/prompts.ts` 第 11–13 行

**当前：**
```typescript
export function goalToolReference(toolName: GoalToolName): string {
  return `${toolName} (or the exposed namespaced equivalent, such as pi__${toolName})`;
}
```

**改为：**
```typescript
export function goalToolReference(toolName: GoalToolName): string {
  return toolName;
}
```

**影响范围**（全部自动改变，无需逐处修改）：

| 位置 | 当前 | 改为 |
|---|---|---|
| `TOOL_PROMPT_GUIDELINES` #2 | `"Use get_goal (or the exposed namespaced equivalent, such as pi__get_goal) when..."` | `"Use get_goal when..."` |
| `TOOL_PROMPT_GUIDELINES` #3 | 同上模式 | `"Use create_goal only when..."` |
| `completionAuditToolGuidelines` #4–#6 | 同上模式 | `"Use update_goal with status complete..."` |
| `compactContinuationPrompt` | `"Inspect the current objective and status with get_goal (or pi__get_goal) if needed."` | `"Inspect the current objective and status with get_goal if needed."` |
| 同上另一处 | `"...and call update_goal (or pi__update_goal) with status complete..."` | `"...and call update_goal with status complete..."` |
| `continuationPrompt` 中的 completion audit 段 | 同上模式 | 同上 |
| `budgetLimitPrompt` 末尾 | 同上 | 同上 |

**改动的实质：** 一行函数体改动，全局生效。不需要逐处替换。

### 5–8. 移除 `GOAL_TOOL_NAME_GUIDANCE`

**文件：** `src/prompts.ts`

**当前常量：**
```typescript
export const GOAL_TOOL_NAME_GUIDANCE =
  "Call each goal tool by the name exposed in your available tool list. In pi that is usually get_goal, create_goal, and update_goal; in bridged MCP runs it may be a namespaced variant such as pi__get_goal, pi__create_goal, or pi__update_goal. Do not assume display, history, or transcript tool names are callable unless they appear in your tool list.";
```

**删除位置：**

| # | 位置 | 行号 | 说明 |
|---|---|---|---|
| 5 | `TOOL_PROMPT_GUIDELINES` 数组第一项 | 第 57 行 | 工具使用指引不再需要命名空间说明 |
| 6 | `compactContinuationPrompt` 末尾 | 第 127 行 | 续跑 prompt 不需要向模型解释命名规则 |
| 7 | `continuationPrompt` 末尾 | 第 149 行 | 同上 |
| 8 | `budgetLimitPrompt` 末尾 | 第 170 行 | 同上 |

**理由：** 在工具名固定为 `get_goal`/`create_goal`/`update_goal` 的前提下，不需要提醒模型"名字可能不一样"。Codex 没有这个说明——它的工具名就是固定的。

**改动量：** 每处 1 行，共 4 行。都在 `prompts.ts`。

### #4–#8 合计

- 涉及文件：仅 `prompts.ts`
- 改动行数：约 5 行（1 行函数体 + 4 行删除）
- 影响：系统提示词和续跑 prompt 中的工具名引用不再附带 namespaced 说明

---

## P1：补 blocked 状态（中等复杂度，5–7 个文件）

### 9. `types.ts` — 状态枚举加 "blocked"

**位置：** 第 4 行

```typescript
// 当前
export type GoalStatus = "active" | "paused" | "budgetLimited" | "complete";

// 改为
export type GoalStatus = "active" | "paused" | "blocked" | "budgetLimited" | "complete";
```

### 10. `tools.ts` — update_goal 参数接受 "blocked"

**位置：** 第 30–33 行

```typescript
// 当前
const UpdateGoalParams = Type.Object({
  status: StringEnum(["complete"] as const, {
    description: "Only complete is accepted. Do not call this until no required work remains.",
  }),
});

// 改为
const UpdateGoalParams = Type.Object({
  status: StringEnum(["complete", "blocked"] as const, {
    description: "Set to `complete` only when the objective is achieved and no required work remains. Set to `blocked` when the same blocking condition has recurred for at least three consecutive goal turns and the agent is at an impasse.",
  }),
});
```

### 11. `state.ts` — 状态验证函数加 "blocked"

**位置：** 第 140 行附近的 `isGoalStatus()`

```typescript
// 当前
export function isGoalStatus(status: unknown): status is GoalStatus {
  return status === "active" || status === "paused" || status === "budgetLimited" || status === "complete";
}

// 改为
export function isGoalStatus(status: unknown): status is GoalStatus {
  return status === "active" || status === "paused" || status === "blocked" || status === "budgetLimited" || status === "complete";
}
```

### 12. `state.ts` — `updateGoalStatus()` 加 blocked 转移

**位置：** `updateGoalStatus()` 函数中，新增 blocked → active resume 分支

```typescript
// 在现有 paused → active 分支旁边或内部

// resume from blocked
if (status === "active" && current.status === "blocked") {
  const goal = cloneGoal(current);
  goal.status = statusAfterBudgetLimit(status, goal.usage.tokensUsed, goal.tokenBudget);
  goal.updatedAt = unixSeconds();
  return { ok: true, message: "Goal resumed from blocked.", goal };
}

// mark as blocked
if (status === "blocked" && current.status === "active") {
  const goal = cloneGoal(current);
  goal.status = "blocked";
  goal.updatedAt = unixSeconds();
  return { ok: true, message: "Goal marked blocked.", goal };
}
```

### 13. `commands.ts` — resume 支持 blocked

**位置：** 第 83 行附近的 resume 分支

```typescript
// 当前
if (trimmed === "resume" && current?.status === "paused") {

// 改为
if (trimmed === "resume" && (current?.status === "paused" || current?.status === "blocked")) {
```

### 14. `goal-transition.ts` — blocked 状态清理

**位置：** `memoryEffectsFromGoalChange()` 中的 status 判断

```typescript
// 在 paused 处理分支旁边加 blocked（同样 clear accounting + clear continuation）
if (next.status === "blocked") {
  effects.push({ type: "clearContinuation" }, { type: "clearActiveAccounting" });
}
```

### 15. `prompts.ts` — blocked 说明

在以下位置补充 blocked 的使用约束：

- `TOOL_PROMPT_GUIDELINES` 中加一条关于 blocked 的指引
- `continuationPrompt()` 的 blocked audit 段（参考 Codex `continuation.md` 中的 "Blocked audit" 段落）
- `update_goal` 的 `promptSnippet` 或 `description` 中提及 blocked

具体文案可参考 Codex `spec.rs` 中 `update_goal` 的 description（第 3–10 行关于 blocked 的规则）。

### #9–#15 合计

| 文件 | 改动量 | 说明 |
|---|---|---|
| `types.ts` | 1 行 | 加枚举值 |
| `tools.ts` | 2 行 | schema 加枚举值 + description 更新 |
| `state.ts` | ~12 行 | isGoalStatus + updateGoalStatus 转移逻辑 |
| `commands.ts` | 1 行 | resume 条件扩展 |
| `goal-transition.ts` | ~3 行 | 新增 blocked 的 transition effect |
| `prompts.ts` | ~15 行 | description + guidelines + continuation prompt |
| **合计** | **~35 行** | **5–6 个文件** |

---

## P3：保留不动（以后再说）

### 17. `replace_existing` 参数

**决定：** 保留不动。

**理由：**
- 改动涉及 schema 定义、执行逻辑、测试（`tools.ts` 第 18–26 行 schema + 第 98–104 行执行逻辑）
- Codex 虽然不提供这个能力，但它在某些场景下有用（用户明确要求换目标时模型可以自己处理，不需要 `/goal clear`）
- 优先级低于补 blocked 和清理提示词

---

## 总结

| 优先级 | 改动 | 文件数 | 行数 | 风险 |
|---|---|---|---|---|
| P0 | 去掉 description 中的 "Codex-style" | 1 | 3 | 无 |
| P0 | 简化 `goalToolReference` + 移除 `GOAL_TOOL_NAME_GUIDANCE` | 1 | 5 | 无 |
| P1 | 补 `"blocked"` 状态 | 5–6 | ~35 | 中（需补测试） |
| P3 | 保留 `replace_existing` | — | — | — |

所有 P0 改动都不影响行为逻辑，只是清理模型看到的文字。P1 是唯一真正改变功能的改动。
