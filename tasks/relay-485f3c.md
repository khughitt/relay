---
id: relay-485f3c
title: Scope the API general command list to match the current CLI
status: doing
priority: 3
size: xs
complexity: low
process: direct
owner: docs/cli-mappings
created: 2026-10-25T00:55:59Z
updated: 2026-10-25T02:26:10Z
started: 2026-10-25T02:20:51Z
depends: []
tags: [docs]
source: relay-a36561
agent: codex
---

Documentation review finding F7 at c2f0b07a18f24376189ce524d7aeb2b3f15c87c9: docs/api.md 501-506 introduces an apparently exhaustive CLI command list but omits serve, ask, inbox and presence, all declared in src/commands.js. Prefer changing the introduction to describe registry/installation/model commands and pointing to the interaction CLI section, rather than duplicating the full command table. Check the destination section against src/commands.js, including inbox ask/take, before linking it. Done when the command inventory's scope is explicit, every claimed command and option agrees with the declarations, the internal link resolves, and the repository's documentation gates pass. No CLI behavior change is in scope.

## Notes

- 2026-10-25T02:20:51Z (main): started
  provenance: {"harness_session":"codex:01a170db-326b-7210-974d-9e3001240e5f","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-25T02:21:21Z (docs/cli-mappings): resumed
  provenance: {"harness_session":"codex:01a170db-326b-7210-974d-9e3001240e5f","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-25T02:22:00Z (docs/cli-mappings): Scope checked: only docs/api.md wording/link changes; general declarations and the interaction CLI table (including inbox ask --file and inbox take ID) agree with src/commands.js. No callers, tests, fixtures, config or exports need changes.
- 2026-10-25T02:22:13Z (docs/cli-mappings): Baseline: just test on Node v26.5.0 after just setup in .worktrees/docs-cli-mappings; 739 tests passed, 0 failed, 0 skipped.
- 2026-10-25T02:24:23Z (docs/cli-mappings): Verification at 1c83f33: just test-fast on Node v26.5.0 passed 739/739, 0 skipped; just gate on Node v22.23.2 passed hygiene/tasks/type checks and 739/739 tests, 0 skipped. Manual comparison confirms documented general commands/options and interaction table against src/commands.js; an assertion check verified interaction command coverage and the #cli-and-capability-gate destination. No runtime behavior changed.
- 2026-10-25T02:26:06Z (docs/cli-mappings): review: impl round 1 — verdict: accept; findings: none; reviewer: codex/gpt-6.1-sol
- 2026-10-25T02:26:10Z (docs/cli-mappings): attached: docs-review-report.md (2299 bytes): Full read-only branch review by codex/gpt-6.1-sol of frozen revision 1c83f33; accepted with no findings.
