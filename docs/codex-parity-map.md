# Codex Goal 原版 vs pi-codex-goal 功能对齐清单

本文用于在继续实现前，先明确：Codex 原版 Goal 有哪些能力，`pi-codex-goal` 当前实现到什么程度，差距在哪里，哪些差异是 Pi 本土化导致的，哪些值得后续补齐。

标记说明：

- ✅ 已基本对齐
- 🟡 部分对齐 / 语义接近但实现不同
- ❌ 缺失
- ⚪ 暂不建议做 / Pi 中不一定适合照搬

## 1. 总体结论

`pi-codex-goal` 已经覆盖了 Codex Goal 的主要使用体验：

- `/goal` 启动长期目标
- agent 空闲后自动继续
- 模型可读取、创建、完成 goal
- session 中保存 goal 状态
- token budget 到达后停止续跑
- completion 前通过 prompt 要求审计
- 处理 stale continuation、compaction、provider/context 错误恢复

但它不是 Codex 原版的同构实现。最大差异是：

```text
Codex 原版：Goal 是 thread 的数据库状态 + runtime/service 生命周期系统
pi-codex-goal：Goal 是 Pi session custom entry + extension hook 模拟 runtime
```

后续改进应该优先补“最终行为效果”上的差距，而不是机械复刻 Codex 的内部架构。

## 2. 功能矩阵

| 领域 | Codex 原版 | pi-codex-goal 当前实现 | 对齐度 | 后续建议 |
|---|---|---|---|---|
| `/goal` 命令 | 有 `/goal` 设置/管理 thread goal | 有 `/goal`、pause、resume、clear、copy、resume cancel | ✅ | 保持兼容 |
| 模型读取 goal | `get_goal` | `get_goal` | ✅ | 保持工具名和语义 |
| 模型创建 goal | `create_goal` | `create_goal`，支持 `replace_existing` | ✅ | 保持兼容 |
| 模型更新 goal | `update_goal(status: complete 或 blocked)` | 目前只支持 `complete` | 🟡 | 优先补 `blocked` |
| 自动续跑 | thread idle 后 `continue_if_idle()` | extension 在 idle/无 pending 时发送 hidden follow-up | ✅/🟡 | 行为接近，保留 Pi 实现 |
| goal 状态 | Active / Paused / Blocked / BudgetLimited / UsageLimited / Complete | active / paused / budgetLimited / complete | 🟡 | 考虑补 blocked、usageLimited |
| blocked 语义 | 连续阻塞审计后可标 blocked | 缺显式 blocked 状态和工具更新 | ❌ | 高优先级，但保持简单 |
| usage limit 语义 | UsageLimited 状态 | provider-limit recovery / auto-resume，但没有外显 usageLimited | 🟡 | 中优先级，先评估影响 |
| token budget | SQL 原子判断 BudgetLimited | runtime accounting 判断并转 budgetLimited | 🟡 | 先补测试，不急着 SQL |
| budget limit steering | 预算达到后注入 budget prompt | 有 `budgetLimitPrompt`，通过 hidden steer message | 🟡 | 文案可进一步对齐 Codex |
| completion audit | continuation prompt 要求逐条需求审计 | prompt 中已有 requirement-to-evidence audit | ✅/🟡 | 可做 prompt parity pass |
| objective updated | 注入 objective_updated prompt | 有 objective/goal 更新后的 continuation 逻辑 | 🟡 | 文案可对齐 |
| 持久化 | SQLite `thread_goals` 表 | Pi session custom entries replay | 🟡 | 保留 Pi-native，不直接换 SQL |
| 并发/旧 goal 防护 | expected_goal_id + locks | goalId 校验 + stale queued work guard | 🟡 | 保持并加强测试 |
| accounting | turn/tool 生命周期 + token delta | turn/tool/session hook 中统计 input+output 和时间 | 🟡 | 明确 cache 排除和边界测试 |
| service 层 | GoalService + app-server JSON-RPC | 没有独立服务层，controller 直接协调 | ⚪/🟡 | 可后续轻量 facade，不急 |
| TUI 状态显示 | Codex TUI status | Pi footer status | ✅/🟡 | 保持现有体验 |
| metrics/analytics | 有事件、metrics、analytics | 无完整 metrics/analytics | ⚪ | 暂不做，非核心效果 |
| compaction | runtime restore / continue | 有 session_before_compact / session_compact 处理 | ✅/🟡 | 保持测试覆盖 |
| session resume | thread resume 恢复 active goal | 从 session branch replay custom entries | ✅/🟡 | 保持 Pi-native 语义 |
| tree/fork 分支 | Codex thread 模型 | Pi session tree 天然支持 custom entries | ✅/🟡 | 不要被 SQL 破坏 |

## 3. 已基本对齐的部分

### 3.1 用户入口

`pi-codex-goal` 已经提供 `/goal` 作为主入口，并支持常用管理操作。

当前命令包括：

```text
/goal
/goal <objective>
/goal pause
/goal resume
/goal resume cancel
/goal copy
/goal clear
```

这已经满足日常使用需求，后续不应该破坏。

### 3.2 模型工具基本结构

当前已有：

```text
get_goal
create_goal
update_goal
```

这点非常重要，因为 Codex Goal 不是纯用户命令，而是模型也能通过工具参与 goal 管理。

`pi-codex-goal` 在这一点上比很多轻量实现更接近 Codex。

### 3.3 自动 continuation

Codex 原版核心是：

```text
thread idle + goal active -> continue_if_idle()
```

`pi-codex-goal` 的实现是：

```text
goal active + ctx.isIdle() + no pending messages -> send hidden follow-up
```

实现机制不同，但最终行为接近。

### 3.4 completion audit prompt

当前 `src/prompts.ts` 已要求：

- 重述 objective 为具体 deliverables
- 把每个 requirement 映射到真实证据
- 检查文件、命令输出、测试结果、PR 状态等
- 不把计划、意图、部分进展当作完成

这和 Codex 的 completion audit 精神一致。

## 4. 部分对齐但值得改进的部分

### 4.1 状态机

Codex 状态：

```text
Active
Paused
Blocked
BudgetLimited
UsageLimited
Complete
```

当前状态：

```text
active
paused
budgetLimited
complete
```

缺少：

```text
blocked
usageLimited
```

建议优先考虑 `blocked`，因为它直接对应模型“无法继续完成目标”的合法终止路径。

`usageLimited` 可以稍后，因为当前已有 provider-limit recovery 和 auto-resume，贸然改变可能影响较大。

### 4.2 update_goal 只支持 complete

Codex 原版允许：

```text
update_goal(status: "complete" | "blocked")
```

当前只允许：

```text
update_goal(status: "complete")
```

这导致模型没有 Codex-style 的 blocked 出口。

建议后续扩展为：

```text
update_goal(status: "complete" | "blocked")
```

但保持简单，不增加复杂 evidence schema。

### 4.3 budget accounting

Codex 使用 SQL 原子更新 token usage 和 budget status。

当前 `pi-codex-goal` 用 runtime accounting：

- turn start 开始计时
- tool end 统计时间进展
- turn end 统计 assistant input/output tokens
- budget crossing 后发送 budget prompt

**注入机制差异**：Codex 在 `on_tool_finish` 中检测到 budget crossing 后，通过 `inject_if_running()` **向当前正在运行中的 turn 追加一条隐藏 steer 消息**，不会触发新 turn。pi-codex-goal 当前用 `sendMessage(..., { triggerTurn: true, deliverAs: "steer" })`，这会**触发一个全新的 turn** 来传递 budget 警告。前者可以让模型在当前 turn 内立即感知预算耗尽并收尾；后者需要等当前 turn 结束后再启动一个新 turn。如果后续要对齐行为，可以考虑改为向当前 turn 追加消息的方式（但受 Pi hook 模型限制，需要评估可行性）。

这日常可用，但不如 Codex 数据库事务强。

建议先补测试和文档，不急着改 SQL。

### 4.4 persistence

Codex：

```text
SQLite thread_goals 表
```

Pi：

```text
session custom entries
```

当前 Pi 方案不是低级替代，而是适配 Pi session tree 的合理做法。

它的优势是：

- 跟随 session resume
- 跟随 `/tree`
- 跟随 fork/clone
- 可随 session 导出
- 不需要额外数据库

风险是：

- 没有 SQL 原子事务
- 需要 replay branch 才能恢复当前状态
- usage entry 需要控制数量

结论：先保留，不直接换 SQL。

## 5. 当前缺失项

### 5.1 blocked 状态

缺失内容：

- `GoalStatus` 没有 blocked
- `update_goal` 不接受 blocked
- blocked 后应停止 auto-continuation
- `/goal resume` 应能从 blocked 恢复 active
- prompt 中应说明 blocked 不能轻易使用

建议优先补。

### 5.2 blocked audit

Codex 原版要求：相同阻塞条件至少连续多个 goal turn 才能 blocked。

**此外，Codex 还有一条自动 blocked 路径**：`on_turn_error` 中，当错误类型不是 `UsageLimitExceeded` 时（如 provider 500、compaction 错误等不可恢复错误），系统会自动将 goal 标记为 `Blocked`，防止自动续跑导致反复消耗 token。这个路径不经过模型主动调用 `update_goal`，也不要求 3 轮审计——错误发生时直接终止。`pi-codex-goal` 已有的 `recovery-runtime.ts` 和 `recovery-machine.ts` 处理了类似的错误恢复场景，但恢复后 goal 仍为 active 而非 blocked。如果要补自动 blocked，可以结合 recovery 状态机：当无法恢复的错误连续发生时，转入 blocked 而非继续尝试恢复。

当前没有这个机制。

为了保持简单，第一版可以先做较轻的版本：

```text
- prompt 中要求不要轻易 blocked
- update_goal 支持 blocked
- blocked 是 terminal-ish stopped state
- resume 后可继续
```

暂时不做复杂 blocker signature / 计数器，除非确实需要。

### 5.3 usageLimited 外显状态

当前 provider limit 更多通过 recovery/pause/auto-resume 处理。

是否补 `usageLimited` 要谨慎，因为它会影响恢复策略。

建议排在 blocked 之后。

### 5.4 Codex prompt 模板化

当前 prompt 在 TS 函数里，不利于和 Codex 原模板逐行比较。

可以后续整理为：

```text
continuation
budget-limit
objective-updated
blocked
```

但这不是第一优先级实现，不要为了模板化做大重构。

## 6. 不建议近期照搬的部分

### 6.1 SQLite

Codex 的 SQL 很关键，但 Pi 中直接照搬会破坏 session tree 语义。

暂不建议第一阶段做。

更合理的长期方向是：

```text
session custom entries = 事实源
SQLite = 可选辅助缓存 / 原子 accounting helper
```

但现在不做。

### 6.2 metrics / analytics

Codex 有 OpenTelemetry metrics 和 analytics。

这对产品观测有用，但不是当前最终效果的核心。

暂不做。

### 6.3 复杂 evidence schema

虽然 completion evidence 很诱人，但 Codex 原版没有要求复杂 schema。

为了保持简单，不应第一阶段把 `update_goal` 改成复杂 checklist 工具。

completion audit 继续主要靠 prompt 和工具说明。

### 6.4 自动任务分类

Codex Goal 是通用 objective，不按任务类型分类。

不做 task kind 识别。

## 7. 建议优先级

### P0：锁定现状

- 保留现有命令和工具行为
- 保留 session custom entry 可读性
- 补行为对照文档和测试边界

### P1：补 blocked 最小闭环

目标：对齐 Codex 最明显缺口，但保持简单。

包括：

- `GoalStatus` 加 `blocked`
- `update_goal` 支持 `blocked`
- blocked 后不自动 continuation
- `/goal resume` 可恢复 blocked goal
- prompt 加 blocked 谨慎使用说明
- 补工具、状态、continuation 测试

### P2：prompt parity 小步整理

- continuation 文案更接近 Codex
- budget-limit 文案更接近 Codex
- completion audit 保持强约束但不加复杂 schema

### P3：usageLimited 评估

- 梳理当前 provider-limit recovery
- 判断是否需要外显 `usageLimited`
- 如果做，保持简单

### P4：accounting 测试增强

- 明确 cacheRead/cacheWrite 不计入 goal usage
- budget crossing 只触发一次
- turn/tool 边界测试

### P5：SQL 只保留研究项

- 不作为近期实现目标
- 只有当 session entry 方案遇到真实问题时再考虑

## 8. 后续实现原则

1. **最终效果优先**
   - 不为了像 Codex 内部结构而牺牲 Pi 的简单性。

2. **宁可低配 Codex，不要超配 Codex**
   - Codex 没有的复杂机制，不轻易加。

3. **先补明显缺口**
   - `blocked` 比 SQL 更值得先做。

4. **保持现有用户可用性**
   - 任何新行为都不能破坏当前 `/goal` 的基本体验。

5. **小步提交**
   - 每次只改一个方向：状态、工具、prompt、测试分开做。
