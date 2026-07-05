# Compatibility Contract

This package is being extended toward closer Codex Goal behavior. Changes should preserve the existing user-facing and model-facing contracts unless a breaking change is explicitly approved.

## Must preserve

- `/goal` command remains the main user entry point.
- Existing management commands continue to work:
  - `/goal`
  - `/goal <objective>`
  - `/goal pause`
  - `/goal resume`
  - `/goal resume cancel`
  - `/goal copy`
  - `/goal clear`
- Model tool names remain stable:
  - `get_goal`
  - `create_goal`
  - `update_goal`
- Existing `create_goal` parameters remain supported:
  - `objective`
  - `token_budget`
  - `replace_existing`
- Existing `update_goal({ status: "complete" })` behavior remains supported.
- Existing session custom entry data remains readable.
- Completed goals remain terminal.
- Active goals continue automatically when the agent becomes idle and no user/pending work is queued.
- Paused, cleared, completed, and budget-limited goals do not auto-continue.
- Stale queued goal work must not affect a replaced, paused, cleared, or completed goal.
- Token budget behavior remains conservative: once a goal reaches its budget, automatic continuation stops.

## Prefer simple Codex-like behavior

- Prefer behavior already present in Codex Goal over new custom concepts.
- Do not add automatic task classification.
- Do not require complex completion evidence schemas unless explicitly approved.
- Do not introduce SQLite or another storage backend before the session-entry behavior is preserved and the need is proven.
- Do not do broad rewrites when a small compatibility-preserving change is enough.

## Allowed direction

These changes are considered compatible if implemented conservatively:

- Add Codex-like statuses such as `blocked` or `usageLimited` while preserving existing status handling.
- Extend `update_goal` to accept `blocked`, provided `complete` remains unchanged.
- Improve prompt wording for continuation, budget limit, objective update, and completion audit.
- Add tests that lock current behavior before changing runtime logic.

## Validation expectation

For behavior changes, prefer targeted tests first:

- command parsing and command behavior tests
- tool schema and tool execution tests
- state transition tests
- continuation/stale queued work tests
- persistence/reload tests when session entries change

Full platform smoke is release-sensitive and not required for every local design step.
