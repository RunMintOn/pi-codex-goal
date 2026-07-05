# Changelog

## Unreleased

- Add minimal blocked goal support: `update_goal` now accepts `status: "blocked"`,
  `/goal resume` works from blocked, blocked goals stop auto-continuation.
- Clean up tool registration descriptions: remove "Codex-style" prefix, remove
  MCP/namespaced prompt guidance.
- Align continuation prompt with Codex: add Continuation behavior, Work from
  evidence, Fidelity, and strict Blocked audit sections.
