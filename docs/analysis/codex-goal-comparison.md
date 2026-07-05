# Codex Goal vs Pi 社区两个实现：参考程度与完备性研究

## 研究范围

参考基线来自 `D:/tmp/codex-source/goal-research/`，其中 Codex Goal 被拆为：

- TUI `/goal` 命令层
- app-server JSON-RPC set/get/clear 层
- GoalExtension 生命周期层
- GoalRuntimeHandle 自动续跑层
- GoalService 外部 API 层
- token/time accounting 层
- steering prompt 注入层
- SQLite thread-owned state model
- `get_goal/create_goal/update_goal` 三个模型工具
- events/metrics/analytics
- 端到端 active → continue → complete / budget-limited / error-blocked 流程

被比较实现：

1. `repos/pi-codex-goal/`，包名 `pi-codex-goal`，版本 `0.1.33`，HEAD `c647025`
2. `repos/pi-extensions/extensions/pi-goal/`，包名 `@narumitw/pi-goal`，版本 `0.10.0`，HEAD `e2c7c21`

## 一句话结论

`pi-codex-goal` 是更接近 Codex 原始 `/goal` 的工程化移植；`@narumitw/pi-goal` 是较完整的轻量 goal-mode 扩展，但更像“借鉴 Codex 交互体验”的实现，而不是完整复刻 Codex Goal 架构。

## 规模与结构对比

| 维度 | pi-codex-goal | @narumitw/pi-goal |
|---|---:|---:|
| src 文件数 | 40 | 1 |
| src 代码行数 | 约 5698 | 约 1073 |
| test 文件数 | 27 | 1 |
| 主要入口 | `src/index.ts` → `goal-runtime-controller.ts` | `src/goal.ts` |
| 设计风格 | 分层状态机 + runtime controller | 单文件闭包状态 + hook 组合 |

这个差异不是单纯代码量问题，而是抽象边界不同：`pi-codex-goal` 在 Pi 扩展能力内模拟 Codex 的 runtime/service/state 分层；`@narumitw/pi-goal` 把 command、tool、state、hook、prompt、persistence、recovery 都压进一个文件里。

## 功能矩阵

| Codex 基线能力 | pi-codex-goal | @narumitw/pi-goal | 备注 |
|---|---|---|---|
| `/goal <objective>` | 有 | 有 | 两者都有 |
| `/goal` status | 有 | 有 | 两者都有 usage/status 摘要 |
| pause/resume/clear | 有 | 有 | pi-codex-goal 另有 `copy`、`resume cancel` |
| edit objective | 无独立 edit；用 replace/clear/create 路径 | 有 `/goal edit` | narumi 在用户命令上更丰富 |
| token budget | 模型工具支持；命令刻意不解析 `--tokens`，对齐 Codex README 说明 | `/goal --tokens` 命令支持 | 两者取舍不同 |
| Codex 三模型工具 `get_goal/create_goal/update_goal` | 有 | 无 | narumi 只有 `goal_complete` |
| completion only status update | 有，`update_goal` 只接受 `complete` | 有，`goal_complete` 只完成 | 都限制完成动作，但契约名不同 |
| session/thread-owned state | 有，session custom entries 重建 | 有，session custom entry 加旧文件清理 | 两者都不是全局 cwd 状态 |
| SQLite 原子状态模型 | 无；Pi 扩展内用 session entry | 无 | Pi 扩展环境限制下合理缺失 |
| 自动 idle continuation | 有 | 有 | 两者核心都实现 |
| continuation 去重/防 stale | 强，独立 stale queued-work guard | 中，pending marker + cancelled marker + stale tool block | pi-codex-goal 更细 |
| active turn accounting | 有，turn/tool/session/compact 多点结算 | 有，但基于 session assistant token baseline | pi-codex-goal 更接近 Codex accounting |
| cache token 排除 | 有 README 明确；实现按 Pi usage input+output | 只统计 assistant input/output 总量 | pi-codex-goal 更明确 |
| budget-limit prompt | 有 `budgetLimitPrompt` | 无独立 budget prompt；达到后 notify/停止续跑 | Codex 有运行中 steering；pi-codex-goal 更接近 |
| objective-updated steering | 有 | 有 | 两者都有类似 prompt |
| before-agent system prompt injection | 主要通过 hidden continuation/custom entries | 有，每 turn 追加 active goal system prompt | narumi 更强依赖 system prompt 注入 |
| compaction handling | 有 session_before_compact/session_compact + overflow recovery | 有 before/after compact 基本恢复 | pi-codex-goal 更细 |
| provider/context overflow recovery | 有 recovery machine、provider-limit auto-resume | 有 retryable/nonretryable regex 基本处理 | pi-codex-goal 更系统 |
| usage-limit special state | 有 provider-limit auto-resume/recovery 注意力 | 无独立 usage_limited 状态 | Codex 有 UsageLimited；pi-codex-goal 较接近 |
| blocked state | 无显式 blocked status；用 paused/recovery | 无显式 blocked status | 两者都弱于 Codex 原版 |
| events/metrics/analytics | 无真正 analytics/metrics；有 runtime events | 无 | Pi 扩展环境通常没有 Codex 原设施 |
| platform smoke/release gate | 强 | 弱，主要 typecheck/biome | pi-codex-goal 工程成熟度更高 |

## pi-codex-goal：参考程度评估

### 覆盖较好的部分

1. **Codex 三工具契约**

   `src/tools.ts` 注册 `get_goal`、`create_goal`、`update_goal`。这非常关键，因为 Codex 原始功能不是只有 `/goal` 命令，而是把 goal 暴露给模型，让模型能读取、创建、完成目标。`update_goal` 只接受 `complete`，和 Codex “完成才更新”的模型侧契约接近。

2. **thread/session-owned 状态**

   状态放在 Pi session custom entries 中，`src/state.ts` 通过 entry replay 重建 goal。这不是 Codex 的 SQLite，但语义上接近 Codex 的 thread-owned goal，而不是按 cwd 存一个全局文件。

3. **自动续跑机制**

   `continuation-scheduler.ts` 在 active goal、idle、无 pending message、无 recovery blocking 时发送隐藏 follow-up。这个对应 Codex `continue_if_idle()` 的核心语义。

4. **completion audit prompt 契约**

   `src/prompts.ts` 明确要求逐条把 objective requirement 映射到文件、命令输出、测试结果、PR 状态等证据，再调用 `update_goal`。这和 Codex `continuation.md` 的 fidelity/completion audit 精神一致。

5. **stale continuation 防护**

   有 `stale-queued-work-*` 一组模块，处理 pause/replacement/late terminal events/overlap 等场景。这是 Codex 原始实现里通过 goal id、runtime locks、thread lifecycle 避免旧 turn 污染新状态的 Pi 版替代物。

6. **恢复路径更接近真实运行**

   有 `recovery-*`、provider-limit auto-resume、host overflow cap reset、session compact 事件处理，说明作者处理了长目标运行中的真实 failure modes。

### 和 Codex 原始实现的差距

1. **没有 GoalService / JSON-RPC / TUI server 分层**

   这是 Pi 扩展环境限制，不一定是缺陷，但说明它不是架构级复刻。Codex 的 `thread/goal/set|get|clear` 服务边界在这里被 extension command/tool 直接替代。

2. **状态机少于 Codex**

   Codex 有 `Active/Paused/Blocked/BudgetLimited/UsageLimited/Complete`。`pi-codex-goal` 只有 `active/paused/budgetLimited/complete`，恢复状态另放 recovery machine。功能上能覆盖不少情况，但状态外显语义不如 Codex 完整。

3. **没有 SQLite 原子更新/并发锁**

   Codex 用 SQL UPDATE + expected_goal_id 原子处理 budget/status/accounting。Pi 实现依赖单进程扩展状态和 session entries，不能同等级保证跨进程/外部 API 并发。

4. **预算耗尽时的运行中 steering 弱化**

   有 `budgetLimitPrompt`，但实际注入能力受 Pi hook/event 模型限制，不完全等价 Codex `on_tool_finish` 里检测 budget 后向当前 running turn 注入 steering item。

### 结论评分

如果以 Codex 原始功能为 100：

- 交互语义：85
- 模型工具契约：90
- 自动续跑：85
- completion audit：85
- 状态/恢复：75
- accounting/budget：70
- 架构分层/API/metrics：45

综合：**约 78/100**。它不是源码结构复刻，但已经是很认真、很完整的 Pi 生态适配。

## @narumitw/pi-goal：参考程度评估

### 覆盖较好的部分

1. **用户体验完整**

   `/goal`、`pause`、`resume`、`clear`、`edit`、`--tokens` 都有，README 对使用方式写得清楚。对于普通用户，功能入口很完整。

2. **自动续跑存在且有效**

   `agent_end` 后，如果 active goal 仍存在且无 pending messages，会调用 `sendContinuationPrompt()`。这是 Goal 功能最核心的行为。

3. **每 turn 追加 active goal system prompt**

   `before_agent_start` 会把 `buildGoalSystemPrompt(activeGoal)` 拼到 system prompt。这对普通模型有强行为约束，可能实际体验上很有效。

4. **completion tool 有安全检查**

   `goal_complete` 只在 active goal 下有效，拒绝空 summary 和明显矛盾的 “not complete / tests still fail” summary，并 `terminate: true`。这是轻量但实际有用的完成门。

5. **基本处理 pause/stale work**

   pause 时 abort 当前 turn，阻止 stale tool call；extension source input 中可消费已取消 continuation marker。

### 和 Codex 原始实现的差距

1. **没有 Codex 三工具**

   只有 `goal_complete`，没有 `get_goal/create_goal/update_goal`。这意味着模型无法按 Codex 工具协议读取/创建/更新 goal。用户命令可创建，模型只可完成。这个差异很大。

2. **state model 过于轻量**

   一个模块级 `activeGoal` + session custom entry 的 last-entry restore。没有 replay 出完整状态历史，没有 expected_goal_id 类乐观锁，也没有清晰的 transition reducer。

3. **状态机少且命名不对齐**

   `active/paused/budget_limited/complete`，没有 `blocked/usage_limited`，budget-limited resume 逻辑也较简单。

4. **accounting 粗糙**

   `currentTokenTotal()` 扫 session branch 中 assistant usage 的 input/output，并用 goal baseline 差值。它不是 Codex 的 completed assistant turn + tool finish 增量会计，也没有 cache accounting 明确处理。

5. **completion audit 主要靠 prompt，不靠工具契约**

   它要求模型 audit requirement，但最终完成只是 `goal_complete(summary)`，没有像 `update_goal` 那样和 get/create/update 三工具体系联动。

6. **单文件复杂度高**

   1073 行单文件承载 command、tool、runtime hooks、prompt、persistence、recovery、format、parse、tests hooks。短期可读，长期维护风险高。

### 结论评分

如果以 Codex 原始功能为 100：

- 交互语义：75
- 模型工具契约：35
- 自动续跑：75
- completion audit：60
- 状态/恢复：55
- accounting/budget：45
- 架构分层/API/metrics：25

综合：**约 56/100**。它是可用的 goal-mode 实现，但更像轻量仿制/产品化体验，而不是完整参考 Codex 的架构和工具协议。

## 两者关键分歧

### 1. “Goal 是用户命令”还是“Goal 是模型可操作对象”

- `@narumitw/pi-goal`：主要是用户用 `/goal` 启动，模型只调用 `goal_complete`。
- `pi-codex-goal`：用户和模型都能通过 goal 工具体系参与，保留 `get_goal/create_goal/update_goal`。

Codex 原版明显偏后者。这个点决定了参考程度高低。

### 2. “自动续跑”是一个 hook，还是一个状态机

- `@narumitw/pi-goal`：`agent_end` hook 中直接判断并继续。
- `pi-codex-goal`：有 continuation scheduler、queued work guard、recovery machine、turn/session/tool event handler 分层。

Codex 原版是 runtime 状态机，所以 `pi-codex-goal` 更像。

### 3. 完成判定靠 summary 还是 requirement-to-evidence audit

- `@narumitw/pi-goal`：拒绝明显矛盾 summary，但本质上还是 summary gate。
- `pi-codex-goal`：prompt/tool guideline 要求逐项证据映射，虽然仍靠模型执行，但契约更接近 Codex。

## 哪个更适合作为后续实现基线

如果你要研究或实现“Codex 原始 Goal 功能在 Pi 里的完整形态”，优先参考：

```text
repos/pi-codex-goal/
```

尤其是这些文件：

- `src/goal-runtime-controller.ts`
- `src/continuation-scheduler.ts`
- `src/tools.ts`
- `src/prompts.ts`
- `src/state.ts`
- `src/goal-persistence.ts`
- `src/recovery-runtime.ts`
- `src/stale-queued-work-*.ts`

如果你要快速理解最小可用实现，参考：

```text
repos/pi-extensions/extensions/pi-goal/src/goal.ts
```

它适合看“用 Pi hooks 最少要怎么拼出一个 goal loop”。但如果照它继续堆功能，很容易变成大单文件状态机。

## 对抗性审查：这份判断可能哪里错

1. **Codex 原版有一些能力 Pi extension 本来无法实现**

   所以把 JSON-RPC、SQLite、metrics 缺失算成低分可能不完全公平。更公平的说法是：这些是“架构参考程度”缺口，不一定是“Pi 扩展缺陷”。

2. **用户体验不等于 Codex 相似度**

   `@narumitw/pi-goal` 的 `/goal --tokens` 和 `/goal edit` 对用户可能更直觉，但这不代表更像 Codex。本文评分按“参考 Codex 程度”，不是按“用户是否喜欢”。

3. **prompt 行为无法仅靠静态代码判断**

   两个实现都依赖模型遵循 completion audit。真正完备性还需要交互 smoke：长任务、失败测试、预算耗尽、用户 pause、compaction、provider error 等场景。

4. **pi-codex-goal 复杂度本身也是风险**

   它更完整，但也更难维护。对一个社区扩展来说，复杂 runtime/recovery/stale-work 状态机可能带来隐藏 bug。它的测试覆盖缓解了这一点，但不能消除。

## 后续建议

1. 做一轮运行时 smoke，对两个实现分别跑同一组场景：
   - `/goal` 创建文件、验证、完成
   - 主动 pause 后确认不续跑、不执行 stale tool
   - budget 达到后是否停止且正确报告
   - 故意让模型尝试未验证完成，看 completion gate 是否拦住
   - session reload/compact 后 goal 是否恢复

2. 如果要做自己的实现，建议以 `pi-codex-goal` 为结构基线，但吸收 `@narumitw/pi-goal` 的两个点：
   - `/goal edit` 的用户体验
   - 简洁的 contradictory completion summary 拦截

3. 不建议从 `@narumitw/pi-goal` 直接扩展成完整 Codex 复刻，除非先拆分文件和状态边界。
