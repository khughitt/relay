---
id: relay-83f587
title: Expose detached ask and take through the CLI
status: done
priority: 2
size: s
complexity: mid
process: direct
owner: feat/detached-ask
created: 2026-10-24T14:50:37Z
updated: 2026-10-24T15:32:02Z
started: 2026-10-24T15:12:29Z
completed: 2026-10-24T15:32:02Z
closed: 2026-10-24T15:32:02Z
depends: [relay-420059]
parent: relay-8d8e86
tags: []
agent: codex/gpt-6.1-sol
spec: docs/specs/2026-10-24-detached-ask-design.md
plan: docs/plans/2026-10-24-detached-ask.md
step: "Task 3: Expose detached asks and receipt through the CLI"
---

Implement plan Task 3: inbox ask-file and take, cli/terminal surface, user/asker withdrawal, existing CLI envelopes, safe subprocess fixtures, API and service-runbook updates, real CLI regression tests, development/Node 22 gates and final whole-branch review. Preserve service-side party validation and its one-connection cost as noted by the user. Requires Task 2 and parent plan approval.

## Notes

- 2026-10-24T14:50:49Z (feat/detached-ask): Implementation plan awaits user approval; unblock at execution Setup.
  provenance: {"harness_session":"codex:01a16e34-23e9-7383-a3ce-8a9e9991a96a","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-24T15:12:29Z (feat/detached-ask): started
  provenance: {"harness_session":"codex:01a16e34-23e9-7383-a3ce-8a9e9991a96a","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-24T15:17:35Z (feat/detached-ask): Ruling: tools/cli.toml is vendored and the repository gate requires its rows to land in ops first. Prepare a small direct ops task in its own worktree, then use its vendored adopt executable to bring the landed inventory into this implementation. Why: preserve canonical source and normal gate checks. Cost: cross-project metadata commit and its required baseline; no runtime/deployment change.
- 2026-10-24T15:32:00Z (feat/detached-ask): Shared worktree and plan scratch retained by open parent relay-8d8e86; parent carries verified retained records/manifest. No additional child-specific resources.
- 2026-10-24T15:32:02Z (feat/detached-ask): done
  provenance: {"harness_session":"codex:01a16e34-23e9-7383-a3ce-8a9e9991a96a","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-24T15:32:02Z (feat/detached-ask): Implemented inbox ask-file/take, cli/terminal surfaces, user/asker withdrawal and strict file validation; isolated subprocess helpers and updated docs/inventory via ops-50dfa0. RED then GREEN 27 focused tests, test-fast 739/739, just gate 739/739 on both Node 26.5.0 and 22.23.2; no skips.
  provenance: {"harness_session":"codex:01a16e34-23e9-7383-a3ce-8a9e9991a96a","harness_session_source":"CODEX_THREAD_ID"}
