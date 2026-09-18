---
id: relay-d79dc3
title: Write explicit outer timeouts in installed hook entries
status: done
priority: 1
size: s
complexity: mid
process: planned
owner: main
created: 2026-09-18T20:19:44Z
updated: 2026-09-18T20:52:52Z
started: 2026-09-18T20:49:49Z
completed: 2026-09-18T20:52:52Z
depends: []
tags: []
source: ops-c8e4d1
model: "claude-opus-5[1m]"
agent: codex
plan: docs/plans/2026-09-17-installers.md
step: "Task 4: Plan Claude Code and Codex cutovers against their actual targets"
---

Relay's approved design requires each installed hook entry to carry an explicit outer timeout. The ops guard probe found the installer plans no timeout field and must not accept evidence for cutover until this is implemented and tested.

## Notes

- 2026-09-18T20:49:49Z (main): started
  provenance: {"harness_session":"claude-code:e1c40f9a-38b2-418e-b944-3a6ae1e52124","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-18T20:49:49Z (main): Reusing the reviewed installers plan (docs/plans/2026-09-17-installers.md, Settled Decisions: Timeouts; Task 4: seconds timeout from the millisecond profile). Its implemented status is stale for this item: hooks.js entry() writes no timeout field. No new spec or plan.
- 2026-09-18T20:52:52Z (relay-d79dc3): done
  provenance: {"harness_session":"claude-code:e1c40f9a-38b2-418e-b944-3a6ae1e52124","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-18T20:52:52Z (relay-d79dc3): Installed relay hook entries now carry timeout: outerMs/1000 (600 s default, Claude SessionEnd 60 s, Codex SessionEnd 3 s); timeoutSeconds rejects non-whole-second profiles; drifted relay entries are replaced whole. Codex hooks.json timeout verified as whole seconds in codex-rs/config hook_config.rs at rust-v0.155.0. Runbook and installers plan status updated. The ops probe driver renders relay's entry without the field; ops-88916d should add it.
  provenance: {"harness_session":"claude-code:e1c40f9a-38b2-418e-b944-3a6ae1e52124","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
