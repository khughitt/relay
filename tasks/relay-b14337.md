---
id: relay-b14337
title: "The CLI surface: rows in ops, adoption, and wiring"
status: doing
priority: 2
size: m
complexity: mid
process: direct
owner: design/typed-messages
created: 2026-10-11T22:48:54Z
updated: 2026-10-12T09:36:36Z
started: 2026-10-12T09:29:40Z
depends: [relay-e889bc, ops-342668]
parent: relay-f58531
tags: []
agent: claude-code/claude-opus-5-5
plan: docs/plans/2026-10-11-typed-interaction-messages.md
step: "Task 12: The CLI surface: rows in ops, adoption, and wiring"
---

## Notes

- 2026-10-12T09:29:40Z (design/typed-messages): started
  provenance: {"harness_session":"codex:01a12f71-1e6b-75e2-86ea-0d3e6f283caf","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-12T09:32:12Z (design/typed-messages): Ruling F27: add matching inbox parent metadata with summary Manage questions and notices in the inbox to source table and relay COMMANDS; bare or unknown inbox remains usage exit 2. Shared parent validation unchanged.
- 2026-10-12T09:34:27Z (design/typed-messages): Rulings F27/F28: inbox parent output none both sides; source --since uses shared since role bound value int repeatable false with exception Inbox cursor is a durable sequence number. Preserve sequence cursor semantics in CLI wiring; no validator changes.
- 2026-10-12T09:36:36Z (design/typed-messages): Phase A source commit ops 8ba6f2d in ops .worktrees/relay-cli-rows is ready for controller independent source review. Ops focused 18 tests and test-fast 1461 tests pass skipped 1; ops just gate blocked by unrelated consumer vendored drift. No adoption or relay implementation started.
