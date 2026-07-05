# pi-codex-goal 改动记录：Add minimal blocked goal support

## 提交信息

- 提交：`f82d55a`
- 分支：针对 pi-codex-goal 区块功能的最小改进
- 对比基准：Codex 原始 Goal 功能的注册定义和状态机

## 改动概括

一次提交完成两个目标：

1. **清理工具注册定义**：去掉 Pi 特有的多余文字，对齐 Codex 的风格
2. **补 blocked 状态**：增加 Codex 有但 pi-codex-goal 缺失的状态和状态转移

### 第一阶段：工具名与 prompt 清理

删除 LLM 视角中无意义的 Pi 特有表述：

| 删除内容 | 原因 |
|---|---|
| description 中的 "Codex-style" | 对模型无意义，Codex 原版没有 |
| `GOAL_TOOL_NAME_GUIDANCE` 常量 | 工具名固定，无需解释 namespaced 变体 |
| prompt 中所有 `pi__get_goal` / `pi__create_goal` / `pi__update_goal` | Pi 特有 namespaced 说明，当前不使用 MCP 桥接 |
| prompt 中所有 `namespaced equivalent` / `bridged MCP` 描述 | 同上 |

涉及文件：

- `src/tools.ts` — 3 个 description 去掉 "Codex-style"
- `src/prompts.ts` — `goalToolReference()` 改为裸名；删除 `GOAL_TOOL_NAME_GUIDANCE` 及其在 4 个 prompt 中的引用
- `test/prompts.test.ts` — 断言从 `pi__` 改为裸名

### 第二阶段：blocked 状态

在 Codex 的 6 状态（Active / Paused / Blocked / BudgetLimited / UsageLimited / Complete）中，补了此前缺失的 `Blocked`。

#### 改动的文件（10 个）

| 文件 | 改动内容 |
|---|---|
| `src/types.ts` | `GoalStatus` 加 `"blocked"` |
| `src/state.ts` | `isGoalStatus()` 加 blocked；`updateGoalStatus()` 加 active→blocked 和 blocked→active 转移 |
| `src/tools.ts` | `UpdateGoalParams` 的 `StringEnum` 改为 `["complete", "blocked"]`；execute 按 status 路由到 blockGoal 或 completeGoal；`ToolHost` 增加 `blockGoal` |
| `src/goal-runtime-controller.ts` | 增加 `blockGoal()` 方法；注册工具时传入 |
| `src/goal-state-controller.ts` | 增加 `blockGoal()` 接口和实现；`resumePausedGoal()` 扩展支持 blocked |
| `src/goal-transition.ts` | `memoryEffectsFromGoalChange()` 加 blocked 分支；`planDerivedResumeActiveTransition()` 允许 blocked；`commandAfterPersistEffects` 中 `wasPausedBefore` 扩展为包含 blocked |
| `src/commands.ts` | `/goal resume` 支持 blocked |
| `src/format.ts` | blocked 的 status label、command hint、footer 展示 |
| `src/prompts.ts` | `completionAuditToolGuidelines` 加 blocked 指引；continuation prompt 加 blocked 说明；`budgetLimitPrompt` 文本调整 |
| `test/*.test.ts` | 6 个测试文件新增 blocked 相关测试（共 7 个新 test case + 多个断言） |

### 文件组织结构

改动涉及 18 个文件，按职责分四层：

**类型层**

| 文件 | 职责 | 改动内容 |
|---|---|---|
| `src/types.ts` | 状态枚举定义 | `GoalStatus` 加 `"blocked"` |

**状态转移层**

| 文件 | 职责 | 改动内容 |
|---|---|---|
| `src/state.ts` | 状态转移规则 | `isGoalStatus()` 加 blocked；`updateGoalStatus()` 加 active→blocked 和 blocked→active |
| `src/goal-transition.ts` | 状态转移规划 | `memoryEffectsFromGoalChange()` 加 blocked 分支；`resume_active` 允许 blocked |
| `src/goal-state-controller.ts` | 状态持久化入口 | 新增 `blockGoal()` 接口和实现；`resumePausedGoal()` 扩展支持 blocked |

**工具层**

| 文件 | 职责 | 改动内容 |
|---|---|---|
| `src/tools.ts` | 工具注册定义 + 执行 | schema 接受 `["complete", "blocked"]`；execute 按 status 路由到 blockGoal/completeGoal |
| `src/goal-runtime-controller.ts` | 运行时控制器 | 新增 `blockGoal()` 方法，注册到工具宿主 |
| `src/format.ts` | UI 展示 | blocked 的 label、hint、footer 文字 |
| `src/commands.ts` | 用户命令 | `/goal resume` 支持 blocked |
| `src/prompts.ts` | LLM 提示词 | 删除 namespaced 说明；新增 blocked 指引 |

**测试层**

| 文件 | 新增内容 |
|---|---|
| `test/state.test.ts` | blocked 转移、create 拒绝、format 展示 |
| `test/goal-transition.test.ts` | transition effect 验证、resume_active 支持 blocked |
| `test/goal-state-controller.test.ts` | `blockGoal` 持久化验证 |
| `test/continuation.test.ts` | `update_goal blocked` 返回值验证（无 budget report） |
| `test/commands.test.ts` | `/goal resume` 恢复 blocked goal |
| `test/prompts.test.ts` | 不再包含 `pi__` / `namespaced` |
| `test/package-manifest.test.ts` | CRLF 兼容性修正 |

**文档层**

| 文件 | 职责 |
|---|---|
| `docs/codex-parity-map.md` | 对齐清单（本轮增补了 blocked 相关分析和优先级） |
| `docs/compatibility-contract.md` | 契约文档（本轮新增） |

## blocked 的规则

| # | 规则 | 代码位置 |
|---|---|---|
| 1 | 仅 `active` 可标记 `blocked` | `state.ts:348` |
| 2 | `blocked` → `active` 可通过 `/goal resume` 恢复 | `state.ts:364` + `commands.ts:123` |
| 3 | `blocked` 后不自动续跑（`continuation-scheduler` 检查 `=== "active"`） | `continuation-scheduler.ts:103` |
| 4 | `blocked` 不显示为 "achieved" | `format.ts:173` |
| 5 | `budgetLimited` → `blocked` 拒绝 | `state.ts:348`（规则 1 兜住） |
| 6 | `blocked` 可被 `/goal <新目标>` 替换（和 paused/active 相同） | `commands.ts:134` |
| 7 | `blocked` → `complete` 允许（complete 分支在转移检查之前） | `state.ts` 执行顺序保证 |
| 8 | `blocked` 不写 runtime usage entry（类型上 `RuntimeUsageGoalStatus` 排除了 blocked） | `types.ts` 类型定义 |

## 与 Codex 的差距（有意保留）

| 不做的事 | Codex 有吗 | 原因 |
|---|---|---|
| blocked 3 轮连续 goal turn 审计 | ✅ 有（`continuation.md`） | 最小闭环，后续可按需补 |
| resume 后阻塞计数重置 | ✅ 有 | 同上 |
| `on_turn_error` 自动 blocked | ✅ 有（`extension.rs:140`） | 当前 recovery 机器已覆盖错误恢复，暂不融合 |
| blocked evidence / blocker signature | ❌ Codex 也没有 | 不做超配 |
| `usageLimited` 状态 | ✅ 有 | 优先级低于 blocked，影响评估中 |

## 当前对齐状态

基于 `codex-parity-map.md` 的评估：

| 领域 | 之前 | 现在 |
|---|---|---|
| `blocked` 状态 | ❌ 缺失 | ✅ 已补（最小闭环） |
| `update_goal` 接受的值 | 仅 `"complete"` | `"complete" \| "blocked"` |
| 状态枚举数 | 4（active/paused/budgetLimited/complete） | 5（+blocked） |
| prompt 中的 Pi 特有命名 | 包含 `pi__` / `namespaced` | 已全部清除 |
| description 中的 "Codex-style" | 3 处 | 0 处 |

仍缺失：`usageLimited` 状态、`/goal edit` 命令、SQLite 持久化、metrics/analytics。

## 相关文档

- 改动计划：`notes/cleaning-plan-v2.md`
- 字段对照：`notes/goal-tool-registration-comparison.md`
- 对齐总图：`repos/pi-codex-goal/docs/codex-parity-map.md`
