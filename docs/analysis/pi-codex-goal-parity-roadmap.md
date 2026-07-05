# pi-codex-goal → Codex Goal Parity Roadmap

## 0. 目标

目标不是重新发明一个 `/goal`，而是在 `pi-codex-goal` 基础上，把它尽可能逼近 Codex 原生 Goal 的行为语义。

本文把目标拆成两层：

1. **Codex parity**：尽量复刻 Codex Goal 的核心架构语义。
2. **Pi-native adaptation**：在 Pi extension/session 模型限制下，本土化实现，而不是机械照搬。

当前基线：

```text
D:/tmp/pi-goal-ext/repos/pi-codex-goal
```

Codex 参考资料：

```text
D:/tmp/codex-source/goal-research
```

## 1. 当前结论

`pi-codex-goal` 已经是一个可日常使用的高完成度实现，但它还不是 Codex 原生 Goal 的同构移植。

最核心差异：

```text
Codex:
  Goal = thread-owned database row + runtime/service/state machine

pi-codex-goal:
  Goal = Pi session custom-entry ledger + extension runtime hooks
```

这不是简单优劣关系。Codex 的 SQL 更强一致；Pi 的 session entry 更适配 Pi 的 resume/fork/tree/compact/export 语义。

因此路线不应是“把 session entry 直接替换成 SQLite”，而应是：

```text
先补 Codex 状态机和 runtime 语义；
再抽象状态后端；
最后按需要引入 SQLite-assisted backend。
```

## 2. Codex 原生 Goal 的关键语义

根据 `goal-research` 资料，Codex Goal 的关键点包括：

### 2.1 架构层

- TUI `/goal` 命令层
- app-server JSON-RPC endpoint：`thread/goal/set|get|clear`
- GoalService：外部统一 API
- GoalExtension：生命周期 hook 汇聚点
- GoalRuntimeHandle：runtime 状态与续跑
- SQLite state layer：`thread_goals` 表
- tools：`get_goal/create_goal/update_goal`
- accounting：token/time 计费
- events/analytics/metrics

### 2.2 状态机

Codex 状态：

```text
Active
Paused
Blocked
BudgetLimited
UsageLimited
Complete
```

关键转移：

```text
Active -> Paused          用户 pause
Active -> Blocked         连续阻塞 / turn error
Active -> BudgetLimited   token budget reached
Active -> UsageLimited    provider/account limit
Active -> Complete        update_goal complete
Paused/Blocked -> Active  用户 resume
BudgetLimited -> UsageLimited
```

### 2.3 工具契约

Codex 暴露：

```text
get_goal()
create_goal(objective, token_budget?)
update_goal(status: "complete" | "blocked")
```

其中：

- `create_goal` 不能覆盖未完成 goal。
- `update_goal(complete)` 只能在目标真实完成后调用。
- `update_goal(blocked)` 需要相同阻塞条件连续出现至少 3 个 goal turn。
- update_goal 不能用于 pause/resume/budget-limit/usage-limit。

### 2.4 Accounting

Codex token 公式：

```text
(input_tokens - cached_input_tokens) + output_tokens
```

不计算 reasoning output，output 负数保底 0。

Codex 通过 `progress_accounting_lock` 串行化计费，并在 SQL UPDATE 中原子完成：

```text
usage delta + budget limited status transition
```

### 2.5 Steering prompt

Codex 有三个主要模板：

```text
continuation.md
budget_limit.md
objective_updated.md
```

核心语义：

- goal 跨 turn 持久化。
- 不要把目标缩小成当前 turn 的小任务。
- completion 前逐条 audit 需求到证据。
- blocked 前需要连续阻塞审计。
- budget limit 后不要继续实质性工作。

## 3. pi-codex-goal 当前实现映射

### 3.1 已经做得好的部分

| Codex 能力 | pi-codex-goal 当前状态 |
|---|---|
| `/goal` 命令 | 有 |
| `get_goal/create_goal/update_goal` | 有 |
| active goal 自动续跑 | 有，`continuation-scheduler.ts` |
| session-owned goal | 有，session custom entries |
| completion audit | 有，`src/prompts.ts` |
| token budget | 有 |
| budget limit steering | 有，`budgetLimitPrompt()` + `deliverAs: "steer"` |
| compaction/reload/session tree | 有处理 |
| stale continuation 防护 | 有，`stale-queued-work-*` |
| provider/context overflow recovery | 有，`recovery-*` |
| tests / smoke scaffolding | 很强 |

### 3.2 主要缺口

| 缺口 | 说明 |
|---|---|
| 状态机不完整 | 缺 `blocked`、`usageLimited` 外显状态 |
| `update_goal` 不支持 blocked | Codex 支持 `complete | blocked` |
| 没有 GoalService/API 层 | 由 extension command/tool 直接驱动 |
| 没有 SQL atomic state | 用 session entry replay + runtime memory |
| accounting 与 Codex 不完全一致 | 当前主要按 assistant input+output，需更明确 cache 排除/turn snapshot 语义 |
| prompt 非模板文件 | prompt 在 TS 函数里，不利于和 Codex 模板 diff |
| metrics/analytics 缺失 | 可本土化为可选 telemetry/logging |
| blocked audit 语义缺失 | 目前更多是 recovery pause，而非 Codex blocked |

## 4. SQL 决策

### 4.1 SQL 在 Codex 中为什么关键

Codex 的 SQLite 不是“保存数据”这么简单，而是承载这些语义：

1. **current goal 单一事实源**：当前 thread goal 是一行。
2. **原子 budget transition**：usage 增长和 BudgetLimited 状态切换在同一 UPDATE。
3. **expected_goal_id 乐观锁**：旧 turn/tool 不能污染新 goal。
4. **服务层共享状态**：TUI/app-server/runtime/tools 共享同一个后端。
5. **并发安全**：配合 semaphore，避免多 hook 竞态。

所以要学习的不是 SQL 这个技术名词，而是 SQL 背后的状态一致性语义。

### 4.2 为什么 Pi 里不能直接照搬 SQL

Pi session 是 JSONL tree：

```text
session.jsonl entries + id/parentId tree
```

它支持：

- `/resume`
- `/fork`
- `/clone`
- `/tree`
- `/compact`
- session export/import

Pi 的 custom entry 有一个关键特点：

```text
custom entry 不进 LLM context，但属于 session tree。
```

这意味着当前 `pi-codex-goal` 的 session-entry 方案天然支持：

```text
切到哪个 branch，就 replay 哪条 branch 上的 goal 状态。
```

如果直接改成 SQLite，只按 `session_id` 存一行，就会出现问题：

```text
同一个 session 文件的两个 tree branch，goal 状态可能不同。
SQLite 当前行到底代表哪个 branch？
```

要解决这个，SQLite key 至少得包含：

```text
session_id/session_file + leaf_id/branch lineage + goal_id
```

复杂度会明显上升。

### 4.3 推荐结论

不要把 SQL 作为 P0 直接替换。

推荐状态源模型：

```text
Session custom entries = authoritative ledger
Runtime memory = hot state
Optional SQLite = materialized/indexed/transaction-assisted state
```

换句话说：

- session entry 继续是事实源，保证 Pi tree/session 语义。
- runtime memory 保持当前热状态。
- SQLite 如引入，只做辅助，不抢夺 session ledger 的权威性。

## 5. 目标架构建议

### 5.1 目标分层

建议逐步收敛成：

```text
src/
  index.ts
  goal-runtime-controller.ts

  command/
    commands.ts
    command-parser.ts

  tools/
    get-goal.ts
    create-goal.ts
    update-goal.ts
    tool-contract.ts

  state/
    goal-types.ts
    goal-transition.ts
    goal-state-controller.ts
    goal-store.ts
    session-entry-store.ts
    sqlite-assisted-store.ts   # optional, later

  runtime/
    continuation-scheduler.ts
    accounting.ts
    recovery-runtime.ts
    blocked-runtime.ts
    stale-work-guard.ts

  prompts/
    render.ts
    templates/
      continuation.md
      budget-limit.md
      objective-updated.md
      blocked.md
      usage-limit.md
```

不是要求一次性重构，而是作为方向。

### 5.2 State Backend 接口

先抽象，不急着实现 SQLite：

```ts
interface GoalStore {
  loadFromSessionBranch(ctx: ExtensionContext): ThreadGoal | null;
  getGoal(): ThreadGoal | null;
  setGoal(goal: ThreadGoal, source: GoalEntrySource, ctx: ExtensionContext): GoalPersistResult;
  clearGoal(source: GoalEntrySource, ctx: ExtensionContext): GoalPersistResult;
  accountUsage(input: UsageDelta, ctx: ExtensionContext): GoalPersistResult;
  updateStatus(input: StatusUpdate, ctx: ExtensionContext): GoalPersistResult;
  flush(source: GoalEntrySource, ctx: ExtensionContext): void;
}
```

当前实现为：

```text
SessionEntryGoalStore
```

未来可加：

```text
SqliteAssistedGoalStore
```

但业务层不直接关心底层。

## 6. 分阶段路线

### Phase 0：锁定兼容契约

目标：避免改进过程中破坏已有用户。

必须保持兼容：

- 工具名：`get_goal/create_goal/update_goal`
- `create_goal` 参数：`objective/token_budget/replace_existing`
- `update_goal(status: "complete")` 现有行为
- `/goal`、`/goal pause/resume/clear/copy/resume cancel`
- session custom entry v1 可读
- active goal 自动续跑
- completed goal terminal 语义

产物：

- `docs/compatibility-contract.md`
- 对 session entry 格式加 fixture tests

### Phase 1：补状态机 parity

目标：更接近 Codex 状态模型。

新增状态：

```ts
type GoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usageLimited"
  | "budgetLimited"
  | "complete";
```

新增转移：

```text
active -> blocked
active -> usageLimited
budgetLimited -> usageLimited
blocked -> active
usageLimited -> active?  # 需由用户确认/恢复策略控制
```

注意：

- 不能把现有 recovery pause 全部粗暴改成 blocked。
- blocked 应该表示“模型已完成 blocked audit 后声明无法继续”，不是任意错误。
- provider usage limit 应该进入 usageLimited 或 paused+autoResume，两者要明确策略。

建议：

```text
usageLimited = 已确认 provider/account limit 阻塞
blocked = 非资源限制、目标层面的真实阻塞
paused = 用户或安全机制主动停止
```

### Phase 2：扩展 `update_goal` 支持 blocked

当前：

```text
update_goal(status: "complete")
```

Codex parity：

```text
update_goal(status: "complete" | "blocked", reason?, evidence?)
```

但为了兼容，可先这样：

```ts
status: StringEnum(["complete", "blocked"])
```

blocked 需要额外约束：

- summary/reason 不为空
- runtime 记录连续 blocked attempt
- 相同 blocker 连续 3 个 goal turn 才允许成功
- resume 后 blocked count reset

如果不满足，工具返回拒绝：

```text
Goal blocked rejected: same blocker has not persisted for 3 consecutive goal turns.
```

### Phase 3：Prompt template parity pass

把 prompt 从 TS 字符串函数中拆为模板文件：

```text
src/prompts/templates/continuation.md
src/prompts/templates/budget-limit.md
src/prompts/templates/objective-updated.md
src/prompts/templates/blocked.md
src/prompts/templates/usage-limit.md
```

每个模板标注：

```text
Codex parity section
Pi adaptation section
Tool-name compatibility section
```

目标：

- 方便和 Codex 原模板 diff。
- 允许本土化扩展，例如 DeepSeek 防漂移规则。
- 让 prompt tests 直接 snapshot 模板渲染结果。

### Phase 4：Accounting parity

增强 `goal-accounting.ts`：

1. 明确 token delta 公式：

```text
input + output, exclude cacheRead/cacheWrite
```

Pi usage 中已有：

```ts
input/output/cacheRead/cacheWrite
```

要明确测试：

```text
cacheRead/cacheWrite 不计入 goal tokensUsed
```

2. 更接近 Codex 的 turn snapshot：

```text
turn_start baseline
on tool_execution_end account elapsed/time, maybe 0 tokens
turn_end account completed assistant tokens
```

当前已经接近，但需要文档和测试更明确。

3. budget crossing 单次 steering：

当前已有 `budgetWarningSentFor`，继续强化测试。

### Phase 5：GoalService-like facade

Pi extension 不需要真的做 JSON-RPC app-server，但可以在内部建一个 facade：

```ts
interface GoalService {
  setThreadGoal(request): GoalSetOutcome;
  getThreadGoal(): ThreadGoal | null;
  clearThreadGoal(source): GoalClearOutcome;
  accountProgress(...): GoalAccountOutcome;
}
```

好处：

- command/tool/runtime 不再各自操作 state controller。
- 更接近 Codex 的统一入口。
- 将来加 SQLite assisted backend 更容易。

### Phase 6：SQLite-assisted backend 评估与实现

只有在 Phase 1-5 完成后再决定。

如果做，推荐设计：

```text
session custom entries = source of truth
sqlite = materialized active branch state + atomic accounting helper
```

SQLite 表不要简单按 session_id 存一行，而应包含：

```text
session_file
leaf_id
branch_fingerprint
custom_entry_id 或 last_replayed_entry_id
goal_id
objective
status
token_budget
tokens_used
active_seconds
created_at
updated_at
```

运行逻辑：

1. session_start / tree / compact：
   - replay branch entries
   - hydrate SQLite snapshot

2. runtime accounting：
   - SQLite 原子 UPDATE 做 budget crossing
   - 同步 append custom entry

3. flush/recovery：
   - session entry 仍可完全恢复状态

如果无法可靠拿到 branch fingerprint/leaf id，则暂缓 SQLite。

## 7. 对抗性审查与辩论

### 反方 A：既然 Codex 用 SQL，我们也应该马上上 SQL

论点：

- SQL 是 Codex 的关键架构。
- 没 SQL 就没有原子 budget/accounting。
- 越晚上 SQL，后面改动越大。

反驳：

- Pi session 是 tree，不是单 thread row。直接 SQL 会破坏 tree/fork/resume 语义。
- 当前最缺的是状态机 parity，而不是存储技术。
- 如果没有先抽象 Store，直接上 SQL 会把业务逻辑和存储耦死。

结论：

```text
先抽象 Store，再考虑 SQLite-assisted；不要直接替换 session entry。
```

### 反方 B：session entry replay 太弱，不能承担事实源

论点：

- event replay 不如数据库直观。
- usage entry 多了可能膨胀。
- 状态恢复逻辑复杂。

反驳：

- Pi 的官方 session persistence 就是 JSONL tree。
- custom entry 不进 LLM context，适合扩展状态。
- 它天然支持 `/tree`，这是 SQL row 不天然支持的。
- 可以通过 coalesced runtime usage entry 和 compaction 控制膨胀。

结论：

```text
session entry 继续做 authoritative ledger 是合理的。
```

### 反方 C：状态机加 blocked/usageLimited 会增加复杂度，不一定用户需要

论点：

- 用户只关心 active/paused/complete/budget。
- recovery 里已有 provider-limit auto-resume。
- 加状态可能引入更多边界 bug。

反驳：

- 目标是逼近 Codex，不是最小产品。
- blocked/usageLimited 是 goal 运行终态语义，不只是 UI 标签。
- 没有 blocked，模型无法按 Codex 合法停止于真实阻塞。
- 没有 usageLimited，资源限制和用户 pause 混在一起，不利于恢复策略。

结论：

```text
应加，但要通过状态转移测试和 migration 保守推进。
```

### 反方 D：Prompt 模板化只是整理代码，收益不大

论点：

- 当前 `src/prompts.ts` 已经可测。
- 拆模板可能增加读文件/render 复杂度。

反驳：

- 我们的目标包含 Codex parity，prompt 文本就是产品行为。
- 模板文件可以更容易和 Codex 原模板比对。
- 本土化规则可以显式分区，不会混在代码字符串里。

结论：

```text
模板化值得做，但不要影响运行时性能；可以 build-time/raw string 或简单 fs 读取缓存。
```

### 反方 E：GoalService facade 是过度抽象

论点：

- Pi extension 没有 app-server。
- 当前 controller 已经够用。

反驳：

- 不是为了模拟 app-server，而是为了统一 command/tool/runtime 的状态入口。
- 未来 Store 抽象、blocked、usageLimited、SQLite 都需要统一边界。
- 如果不建 facade，状态逻辑会继续分散。

结论：

```text
可以轻量实现，不要做网络/API，只做内部 use-case layer。
```

## 8. 最终推荐版本

### 8.1 总体策略

```text
Codex 语义优先，存储技术后置。
```

不要先追 SQL。先把 `pi-codex-goal` 的状态机、工具契约、prompt、accounting、runtime facade 往 Codex 靠。

最终目标架构：

```text
Command / Tools / Runtime hooks
        ↓
GoalService-like facade
        ↓
GoalStateController + GoalStore
        ↓
SessionEntryGoalStore  [authoritative]
        ↓
Optional SqliteAssistedStore [later]
```

### 8.2 推荐实施顺序

1. **写 compatibility contract**
   - 锁住已有命令、工具、session entry v1。

2. **补 Codex 状态枚举**
   - `blocked`、`usageLimited`。

3. **扩展 `update_goal`**
   - 支持 `blocked`，并实现三轮相同 blocker 规则。

4. **Prompt 模板化**
   - 与 Codex 三模板做 parity diff。

5. **强化 accounting parity**
   - cache excluded tests、budget steering tests、turn snapshot tests。

6. **引入 GoalService-like facade**
   - 统一 command/tool/runtime 状态入口。

7. **抽象 GoalStore**
   - 当前 session entry backend 先实现接口。

8. **再决定 SQLite-assisted backend**
   - 只有在 branch key、replay、atomic accounting 方案清楚后做。

### 8.3 SQL 的最终判断

SQL 是重要研究方向，但不应成为第一阶段改造。

推荐结论：

```text
不直接复制 Codex SQLite。
保留 session entry 为事实源。
将 SQL 设计为可选 materialized/atomic helper。
```

这既保留 Pi 的 session/tree 语义，也能逐步吸收 Codex SQL 的核心价值：

- expected_goal_id
- atomic budget crossing
- consistent accounting
- stale write rejection

## 9. 当前最应该做的下一步

下一步建议不是实现 SQLite，而是新增：

```text
docs/compatibility-contract.md
docs/codex-parity-map.md
```

然后从 Phase 1 开始小步改：

```text
GoalStatus 增加 blocked/usageLimited
```

这是最能逼近 Codex、同时风险可控的一步。

## 10. Simplicity Constraint：宁可低配 Codex，不要超配 Codex

用户明确约束：

```text
能简单就简单。
可以比 Codex 原版稍微简单。
不要为了“更可靠”做得比 Codex 更复杂。
```

这条约束会覆盖本文前面所有 optional/strict/assisted 方案。后续实现选择必须满足：

1. **不引入任务分类器**
   - Codex Goal 是通用 objective，不按 task kind 分流。
   - 不做关键词识别、不做自动 mode classification。

2. **不强制复杂 evidence schema**
   - 不把 `update_goal` 变成复杂 checklist API。
   - completion audit 主要放在 prompt/tool guidance 中。
   - 如果未来加 evidence，也必须是可选且极简，不作为第一阶段。

3. **不优先引入 SQLite**
   - SQL 只作为后期可选研究。
   - 第一阶段继续使用 session custom entries。
   - 不为了追求 Codex 内部架构相似而破坏 Pi-native 简洁性。

4. **状态机只补 Codex 必要状态，不扩展新概念**
   - 可以考虑补 `blocked` / `usageLimited`，因为 Codex 原版有。
   - 不新增自定义复杂状态，例如 auditPending、verificationRequired、evidenceMissing 等。

5. **Prompt 只做 Codex parity，不做过度治理**
   - 目标是把 Codex 的 continuation / budget-limit / objective-updated / blocked 语义表达清楚。
   - 不堆很长的 DeepSeek 专用价值观 prompt。
   - 模型约束以“完成前 audit、不要缩小目标、不要停在 plan、blocked 要谨慎”为主。

6. **实现优先级改为最小 Codex-like 核心**

推荐最小路线：

```text
P0: 写 compatibility contract
P1: Prompt parity pass，整理 continuation / budget / completion audit 文案
P2: update_goal 支持 blocked（保持 schema 简单）
P3: 增加 blocked / usageLimited 状态（如果实现成本可控）
P4: 加必要测试覆盖 stale continuation / budget / blocked / resume
P5: 暂不做 SQLite；只保留设计接口余地
```

明确暂缓：

```text
- 强制 evidence checklist
- 自动任务分类
- DeepSeek 专用复杂 runtime mode
- SQLite assisted backend
- Metrics/analytics 系统
- 大规模目录重构
```

最终原则：

```text
Codex 有且对最终效果关键的，尽量学。
Codex 没有的，不因为“看起来更可靠”就加。
Pi 里实现成本高、收益不确定的，先不做。
```
