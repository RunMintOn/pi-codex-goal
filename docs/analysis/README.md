# Design Analysis Documents

This directory contains the design analysis and planning documents that guided
the development of this fork. They document the research, comparisons, and
decisions made while bringing this package closer to Codex's original goal
behavior.

**Note:** Most documents are in Chinese. They are included as-is for reference.

## Index

| File | Description |
|---|---|
| `goal-surface-definition.md` | Defines the minimal surface area of the goal feature: 3 tools, 3 prompts, 1 loop. Clarifies the distinction between tool registration definition and schema. |
| `goal-tool-registration-comparison.md` | Field-by-field comparison of the three goal tools (`get_goal` / `create_goal` / `update_goal`) between this package and Codex, including complete promptGuidelines. |
| `codex-parity-map.md` | The primary alignment map: item-by-item comparison of commands, tools, state machine, accounting, and prompts between Codex's original goal and this package. Marks gaps and priorities. |
| `compatibility-contract.md` | The externally visible behavior contract: state transitions, tool behavior, accounting rules, continuation conditions. Update when behavior changes. |
| `prompt-inventory.md` | Complete inventory of all LLM-facing prompt text in this package, with both English original and Chinese translation. Organized by category (tool definitions, continuation prompts, budget prompt, guidelines, etc.). |
| `prompt-alignment-plan.md` | Execution plan for aligning continuation prompts with Codex: added Continuation behavior, Work from evidence, Fidelity, and strict Blocked audit sections. |
| `cleaning-plan-v2.md` | Execution plan for cleaning tool registration definitions and adding blocked goal support. Phase 1 (prompt cleanup) and Phase 2 (blocked) are both complete. |
| `cleaning-plan.md` | First draft of the cleaning plan. Superseded by `cleaning-plan-v2.md`. |
| `2026-07-05-blocked-goal-support.md` | Change record for the blocked goal support commit: files changed, 8 blocked rules, gaps vs Codex. |
| `codex-goal-comparison.md` | Phase 1 research output: comparison between `pi-codex-goal` and `@narumitw/pi-goal`. The conclusion selected `pi-codex-goal` as the baseline. No longer actively maintained. |
| `pi-codex-goal-parity-roadmap.md` | Long-term roadmap from current state to full Codex parity across state machine, accounting, tools, and prompts. Not updated with each change. |
