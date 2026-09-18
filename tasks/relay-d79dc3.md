---
id: relay-d79dc3
title: Write explicit outer timeouts in installed hook entries
status: doing
priority: 1
size: s
complexity: mid
process: planned
owner: main
created: 2026-09-18T20:19:44Z
updated: 2026-09-18T20:49:49Z
started: 2026-09-18T20:49:49Z
depends: []
tags: []
source: ops-c8e4d1
agent: codex
plan: docs/plans/2026-09-17-installers.md
step: "Task 4: Plan Claude Code and Codex cutovers against their actual targets"
---

Relay's approved design requires each installed hook entry to carry an explicit outer timeout. The ops guard probe found the installer plans no timeout field and must not accept evidence for cutover until this is implemented and tested.

## Notes

- 2026-09-18T20:49:49Z (main): started
  provenance: {"harness_session":"claude-code:e1c40f9a-38b2-418e-b944-3a6ae1e52124","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-18T20:49:49Z (main): Reusing the reviewed installers plan (docs/plans/2026-09-17-installers.md, Settled Decisions: Timeouts; Task 4: seconds timeout from the millisecond profile). Its implemented status is stale for this item: hooks.js entry() writes no timeout field. No new spec or plan.
