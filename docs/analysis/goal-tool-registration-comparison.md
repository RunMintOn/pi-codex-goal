# Goal 三个工具注册定义：Pi vs Codex 逐字段对照

## 说明

Pi 的工具注册定义包含 **5 个 LLM 可见字段**：
`name` / `description` / `parameters` / `promptSnippet` / `promptGuidelines`

Codex 的工具注册定义包含 **3 个 LLM 可见字段**：
`name` / `description` / `parameters`

Codex **没有** `promptSnippet` 和 `promptGuidelines`。Codex 的工具使用指引放在：
- `description` 字段本身（比 Pi 长得多）
- `continuation.md` steering 模板（运行时注入，不在注册定义内）

---

## 一、get_goal

| 字段 | Pi | Codex |
|---|---|---|
| **name** | `"get_goal"` | `"get_goal"` |
| **description** | `"Get the current Codex-style goal and usage for this pi session."` | `"Get the current goal for this thread, including status, budgets, token and elapsed-time usage, and remaining token budget."` |
| **parameters** | 无参数（`Type.Object({})`） | 无参数（空对象 `BTreeMap::new()`，`required: []`，`additionalProperties: false`） |
| **promptSnippet** | `"Inspect the current goal, status, token budget, tokens used, and active elapsed time."` | 无此字段 |
| **promptGuidelines** | 共用 `TOOL_PROMPT_GUIDELINES`（7 条，见第四节） | 无此字段 |

### description 字段对比

| | Pi | Codex |
|---|---|---|
| 单词数 | 14 | 19 |
| 内容 | 提到 "Codex-style"，笼统描述 | 明确列出具体字段（status, budgets, token usage, elapsed time, remaining budget） |
| 差异 | Codex 对返回内容描述更精确 | |

---

## 二、create_goal

| 字段 | Pi | Codex |
|---|---|---|
| **name** | `"create_goal"` | `"create_goal"` |
| **description** | `"Create a Codex-style long-running goal for this pi session."`（8 词） | 两段共 35 词（见下方全文） |
| **parameters** | `objective: string`（必填）<br>`token_budget: integer`（可选，`minimum: 1`）<br>**`replace_existing: boolean`（可选，Pi 特有）** | `objective: string`（必填）<br>`token_budget: integer`（可选，无 minimum 约束） |
| **promptSnippet** | `"Create one goal with an objective and optional positive token budget. Fails when a non-complete goal already exists unless replace_existing is true; replaces a completed goal."` | 无此字段 |
| **promptGuidelines** | 共用 `TOOL_PROMPT_GUIDELINES`（7 条，见第四节） | 无此字段 |

### description 字段全文对比

**Pi（一行，8 词）：**
```
Create a Codex-style long-running goal for this pi session.
```

**Codex（两段，35 词）：**
```
Create a goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks.
Set token_budget only when an explicit token budget is requested. Fails if an unfinished goal exists; use update_goal only for status.
```

### parameters 字段对比

| 参数 | Pi | Codex |
|---|---|---|
| `objective` | string，必填<br>description: `"Concrete objective to pursue until completion."` | string，必填<br>description: `"Required. The concrete objective to start pursuing. This starts a new active goal when no goal exists or replaces the current goal when it is complete."` |
| `token_budget` | integer，可选，**`minimum: 1`**<br>description: `"Optional positive integer token budget."` | integer，可选，无 minimum 约束<br>description: `"Positive token budget for the new goal. Omit unless explicitly requested."` |
| **`replace_existing`** | boolean，可选（**Pi 特有**）<br>description: `"Replace an existing non-complete goal. Use only when the user explicitly asks to set a new goal over the current one."` | **无此参数**。Codex 的替换逻辑由 SQL 层 `ON CONFLICT ... WHERE status = 'complete'` 原子处理，不暴露给模型 |

### replace_existing 的处理逻辑差异

**Pi**：模型通过 `replace_existing: true` 参数显式要求替换。应用层判断是否需要替换。

**Codex**：无此参数。模型只能先完成当前 goal（`update_goal(status="complete")`）后才能创建新 goal。错误消息：
```
cannot create a new goal because this thread has an unfinished goal; complete the existing goal first
```

---

## 三、update_goal

| 字段 | Pi | Codex |
|---|---|---|
| **name** | `"update_goal"` | `"update_goal"` |
| **description** | 两句话（32 词，见下方全文） | **10 行**（约 170 词，见下方全文） |
| **parameters** | `status: "complete"`（仅接受 `complete`）<br>枚举值：`["complete"]` | `status: "complete" \| "blocked"`<br>枚举值：`["complete", "blocked"]` |
| **promptSnippet** | `"Mark the current goal complete only after an evidence-backed completion audit proves no required work remains."` | 无此字段 |
| **promptGuidelines** | 共用 `TOOL_PROMPT_GUIDELINES`（7 条，见第四节） | 无此字段 |

### description 字段全文对比

**Pi（两句话，32 词）：**
```
Mark the current Codex-style goal complete only after the objective is actually achieved and no required work remains. Do not use this tool just because work is stopping, budget is low, or partial progress looks sufficient.
```

**Codex（10 行，约 170 词）：**
```
Update the existing goal.
Use this tool only to mark the goal achieved or genuinely blocked.
Set status to `complete` only when the objective has actually been achieved and no required work remains.
Set status to `blocked` only when the same blocking condition has repeated for at least three consecutive goal turns, counting the original/user-triggered turn and any automatic continuations, and the agent cannot make meaningful progress without user input or an external-state change.
If the user resumes a goal that was previously marked `blocked`, treat the resumed run as a fresh blocked audit. If the same blocking condition then repeats for at least three consecutive resumed goal turns, set status to `blocked` again.
Once the blocked threshold is satisfied, do not keep reporting that you are still blocked while leaving the goal active; set status to `blocked`.
Do not use `blocked` merely because the work is hard, slow, uncertain, incomplete, or would benefit from clarification.
Do not mark a goal complete merely because its budget is nearly exhausted or because you are stopping work.
You cannot use this tool to pause, resume, budget-limit, or usage-limit a goal; those status changes are controlled by the user or system.
When marking a budgeted goal achieved with status `complete`, report the final token usage from the tool result to the user.
```

### 关键差异

| 维度 | Pi | Codex |
|---|---|---|
| 允许的状态 | **仅 `"complete"`** | **`"complete" \| "blocked"`** |
| status 参数描述 | `"Only complete is accepted. Do not call this until no required work remains."`（9 词） | `"Required. Set to \`complete\` only when the objective is achieved and no required work remains. Set to \`blocked\` only after the same blocking condition has recurred for at least three consecutive goal turns and the agent is at an impasse. After a previously blocked goal is resumed, the resumed run starts a fresh blocked audit."`（约 45 词） |
| 约束层 | schema 层 `StringEnum(["complete"])` 拒绝非 complete 值 | 执行器层 `matches!()` 拒绝非 `Complete \| Blocked` 值 |
| blocked 审计规则 | 无（不支持 blocked） | 3 次连续 goal turn、resume 重置计数 |
| budget report | 返回时通过 `textResult(goal, true)` 控制 | 仅 complete 时返回 `completion_budget_report` 字段 |

---

## 四、Pi 独有字段：promptGuidelines 完整内容

三个工具共用 `TOOL_PROMPT_GUIDELINES`。展开后共 7 条，全部注入系统提示词 "Guidelines" 段落。

```
1. Call each goal tool by the name exposed in your available tool list. In pi that is
   usually get_goal, create_goal, and update_goal; in bridged MCP runs it may be a
   namespaced variant such as pi__get_goal, pi__create_goal, or pi__update_goal.
   Do not assume display, history, or transcript tool names are callable unless they
   appear in your tool list.

2. Use get_goal (or the exposed namespaced equivalent, such as pi__get_goal) when
   you need to inspect the current long-running user objective.

3. Use create_goal (or the exposed namespaced equivalent, such as pi__create_goal)
   only when the user explicitly asks you to start tracking a concrete goal;
   do not infer goals from ordinary tasks and do not create a second goal while a
   non-complete goal already exists. After a goal is complete, create_goal (or the
   exposed namespaced equivalent, such as pi__create_goal) replaces it with a new
   active goal.

4. Use update_goal (or the exposed namespaced equivalent, such as pi__update_goal)
   with status complete only after a completion audit proves the objective is
   actually achieved and no required work remains.

5. Before using update_goal (or the exposed namespaced equivalent, such as
   pi__update_goal), map every explicit requirement in the goal to concrete evidence
   from files, command output, test results, PR state, or other real artifacts;
   uncertainty means the goal is not complete.

6. Do not use update_goal (or the exposed namespaced equivalent, such as
   pi__update_goal) merely because work is stopping, substantial progress was made,
   tests passed without covering every requirement, or the token budget is nearly
   exhausted.

7. When a goal is active, keep working through clear low-risk next steps instead of
   stopping at a plan.
```

### Codex 等效信息的去向

Codex 没有 equivalent，但上述信息在 Codex 中有对应的分布位置：

| Pi promptGuidelines 条目 | Codex 中的对等物 |
|---|---|
| #1 命名空间说明 | 无（Codex 工具名固定，不需要说明） |
| #2 get_goal 使用指引 | description 字段（1 句） |
| #3 create_goal 使用指引 | description 字段（第 1 段的"不要从普通任务推断 goal"） |
| #4–#6 completion audit | **continuation.md** 模板中 "Completion audit" 段落（运行时注入） |
| #7 持续推进 | **continuation.md** 模板中 "Fidelity" 段落（运行时注入） |

---

## 五、概要对照卡

| 维度 | Pi 风格 | Codex 风格 |
|---|---|---|
| description 长度 | 简短（8–32 词） | 偏长（17–170 词） |
| 使用规则位置 | 注册定义内（promptSnippet + promptGuidelines） | description 字段内 + 运行时 steering 模板 |
| get_goal 参数 | 无参 | 无参 |
| create_goal 参数 | objective（必填）+ token_budget（可选，minimum:1）+ **replace_existing**（可选） | objective（必填）+ token_budget（可选，无约束） |
| create_goal 替换语义 | `replace_existing: true` 显式替换 | SQL `ON CONFLICT ... WHERE status='complete'` 隐式约束 |
| update_goal 状态 | **仅 `"complete"`** | **`"complete" \| "blocked"`** |
| 错误信息 | schema 层直接拒绝 | 执行器层返回文本错误 |
| 返回值格式 | 文本 `{ type: "text", text }` | JSON `GoalToolResponse { goal, remaining_tokens, completion_budget_report }` |
