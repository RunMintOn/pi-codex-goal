# Goal 功能：暴露给 LLM 的最小表面定义

## 背景

基于 codex-parity-map.md 的审核讨论，明确了 Goal 功能的核心外露接口。

---

## 一、Goal 的最小实现由三部分组成

| 组成部分 | 说明 | LLM 是否感知 |
|---|---|---|
| **三个工具** | `get_goal` / `create_goal` / `update_goal` | ✅ 通过工具注册定义 |
| **三个提示词** | `continuation` / `budget_limit` / `objective_updated` | 运行时才感知（作为隐藏消息注入） |
| **一个循环** | idle + goal active → 续跑下一轮 | ❌ 完全不可见，纯基础设施 |

最简集合可以收缩为：**1 个循环 + 1 个提示词（continuation）+ 3 个工具**。`budget_limit` 和 `objective_updated` 只在开启 budget 或支持中途改目标时才需要。

---

## 二、工具注册定义 vs Schema

### 术语区分

| 术语 | 所指范围 |
|---|---|
| **Schema** | 仅指参数的 JSON Schema 定义（`Type.Object({...})`） |
| **工具注册定义** | 暴露给 LLM 的全部静态信息的完整集合 |

### 工具注册定义包含的五个字段

**通过结构化 API（function calling / tool_use）传递：**

| 字段 | 示例 |
|---|---|
| `name` | `"get_goal"` |
| `description` | `"Get the current Codex-style goal and usage for this pi session."` |
| `parameters` | 参数 schema（空对象 / `{ objective, token_budget }` / `{ status }`） |

**通过系统提示词文字传递：**

| 字段 | 示例 | 去向 |
|---|---|---|
| `promptSnippet` | `"Inspect the current goal, status, token budget..."` | `Available tools` 段落 |
| `promptGuidelines` | `["Use get_goal when...", "Use create_goal only when...", ...]` | `Guidelines` 段落 |

### 模型看不到的部分（但也是工具实现的一部分）

- 工具的错误处理逻辑（只看到抛出的错误消息，看不到内部 try/catch）
- 工具的会计逻辑（token counting、budget limit 判定）
- 工具的持久化方案（session custom entries / SQLite）
- 工具的 recovery / stale guard 状态机
- 工具的续跑调度器

这些属于**基础设施**，影响的是工具的可靠性和行为边界，但不影响 LLM 对工具功能的理解。

---

## 三、pi-codex-goal 三个工具的注册定义清单

### 3.1 `get_goal`

| 字段 | 值 |
|---|---|
| `name` | `"get_goal"` |
| `description` | `"Get the current Codex-style goal and usage for this pi session."` |
| `parameters` | 无参数 |
| `promptSnippet` | `"Inspect the current goal, status, token budget, tokens used, and active elapsed time."` |
| `promptGuidelines` | 共用 `TOOL_PROMPT_GUIDELINES`（见下文） |

### 3.2 `create_goal`

| 字段 | 值 |
|---|---|
| `name` | `"create_goal"` |
| `description` | `"Create a Codex-style long-running goal for this pi session."` |
| `parameters` | `objective: string`（必填）, `token_budget?: integer`（minimum: 1）, `replace_existing?: boolean` |
| `promptSnippet` | `"Create one goal with an objective and optional positive token budget. Fails when a non-complete goal already exists unless replace_existing is true; replaces a completed goal."` |
| `promptGuidelines` | 共用 `TOOL_PROMPT_GUIDELINES` |

**与 Codex 的差异：** 多了一个 `replace_existing` 参数。Codex 没有这个参数，靠 SQL `ON CONFLICT ... WHERE status = 'complete'` 实现等价语义。

### 3.3 `update_goal`

| 字段 | 值 |
|---|---|
| `name` | `"update_goal"` |
| `description` | `"Mark the current Codex-style goal complete only after the objective is actually achieved and no required work remains. Do not use this tool just because work is stopping, budget is low, or partial progress looks sufficient."` |
| `parameters` | `status: "complete"`（仅接受 complete） |
| `promptSnippet` | `"Mark the current goal complete only after an evidence-backed completion audit proves no required work remains."` |
| `promptGuidelines` | 共用 `TOOL_PROMPT_GUIDELINES` |

**与 Codex 的差距：** Codex 接受 `"complete" | "blocked"`，pi-codex-goal 只接受 `"complete"`。这是唯一真正的 schema 缺口。

### 3.4 共用 promptGuidelines（`TOOL_PROMPT_GUIDELINES`）

来源：`src/prompts.ts` 第 56–61 行，包含：

- 工具命名空间说明（`GOAL_TOOL_NAME_GUIDANCE`）
- `get_goal` 使用指引
- `create_goal` 使用指引（不推断用户意图、不重复创建）
- completion audit 指引（`completionAuditToolGuidelines()`）
  - 逐条需求→证据映射
  - 不确定性视为未完成
  - 未完成前不调用 update_goal
- 活跃 goal 下持续推进而非停留在计划的指引

---

## 四、Codex 三个工具的注册定义对照

Codex 的工具定义位于 `spec.rs`（`create_get_goal_tool()` / `create_create_goal_tool()` / `create_update_goal_tool()`），以 Responses API `ToolSpec::Function(ResponsesApiTool)` 的形式注册。

### 关键差异汇总

| 维度 | Codex | pi-codex-goal |
|---|---|---|
| 工具命名 | `get_goal` / `create_goal` / `update_goal` | 一致 |
| `update_goal` 允许的状态 | `"complete" \| "blocked"` | 仅 `"complete"` |
| `create_goal` 的替代机制 | SQL 层原子判断（仅 complete 时可替换） | `replace_existing` 参数 + 应用层判断 |
| `token_budget` 约束 | 运行时验证 `<= 0` | schema 层 `minimum: 1` |
| 工具描述（description） | 较长的自然语言说明 | 较短的说明 |
| promptGuidelines  | 无等效字段（Codex 用 `continuation.md` steering 承载使用指引） | `TOOL_PROMPT_GUIDELINES` 数组注入系统提示词 |
| completion audit | `continuation.md` 模板中描述 | `promptGuidelines` 中 + `continuation` prompt 中 |

---

## 五、补充：两个被 parity map 遗漏的 Codex 细节

### 5.1 自动 blocked 路径

Codex 在 `on_turn_error` 中，当错误类型不是 `UsageLimitExceeded` 时，自动将 goal 标记为 `Blocked`。这个路径不经过模型调用 `update_goal`，也不要求 3 轮审计。

来源：`extension.rs` 第 140–150 行：
```rust
CodexErrorInfo::UsageLimitExceeded => ActiveGoalStopReason::UsageLimit,
_ => ActiveGoalStopReason::TurnError,  // → stop_active_goal_for_turn → Blocked
```

### 5.2 budget steering 注入机制差异

Codex 通过 `inject_if_running()` **向当前正在运行中的 turn 追加一条隐藏 steer 消息**，不触发新 turn。pi-codex-goal 用 `sendMessage(..., { triggerTurn: true, deliverAs: "steer" })` 触发**新 turn** 来传递 budget 警告。

来源：
- Codex：`runtime.rs` 第 130 行 `inject_active_turn_steering()` → `thread.inject_if_running()`
- pi-codex-goal：`goal-accounting.ts` 第 90 行 `sendMessage(..., { triggerTurn: true, deliverAs: "steer" })`

---

## 六、术语索引

| 术语 | 指向 |
|---|---|
| **工具注册定义** | `name` + `description` + `parameters` + `promptSnippet` + `promptGuidelines` 的总和 |
| **Schema** | 仅指 `parameters` 字段的 JSON Schema 定义 |
| **续跑循环** | idle + active goal → `maybeContinue()`，LLM 不可见 |
| **提示词注入** | `continuation` / `budget_limit` / `objective_updated`，LLM 在运行时才看到 |
