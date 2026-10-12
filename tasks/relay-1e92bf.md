---
id: relay-1e92bf
title: "HTTP surface, tailnet guard and event stream"
status: doing
priority: 2
size: m
complexity: mid
process: direct
owner: design/typed-messages
created: 2026-10-11T22:48:51Z
updated: 2026-10-12T05:42:14Z
started: 2026-10-12T05:25:23Z
depends: [relay-aa889d]
parent: relay-f58531
tags: []
agent: claude-code/claude-opus-5-5
plan: docs/plans/2026-10-11-typed-interaction-messages.md
step: "Task 8: HTTP surface, tailnet guard and event stream"
---

## Notes

- 2026-10-12T05:25:23Z (design/typed-messages): started
  provenance: {"harness_session":"codex:01a12e91-ce57-7650-843d-ea5dcd0396a6","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-12T05:39:55Z (design/typed-messages): Implementation follows approved HTTP table (F24: no HTTP seen route); Node 22 raw and incomplete pipelined connections need tracked socket cleanup after accepted response finish. Existing OpenCode 200 ms test timeout transient recorded as feedback relay-ef98dc; no integration code changed.
- 2026-10-12T05:42:14Z (design/typed-messages): parked (waiting on agent): Controller: review b813b52 for Task 8 in .worktrees/typed-messages using task-8-report.md and its RED/GREEN evidence; resolve findings, verify release, then close the step before Task 9.
  provenance: {"harness_session":"codex:01a12e91-ce57-7650-843d-ea5dcd0396a6","harness_session_source":"CODEX_THREAD_ID"}
