---
id: relay-f25e1e
title: Correct the README harness event mapping count
status: doing
priority: 3
size: xs
complexity: low
process: direct
owner: docs/cli-mappings
created: 2026-10-25T00:55:50Z
updated: 2026-10-25T02:26:44Z
started: 2026-10-25T02:21:04Z
depends: []
tags: [docs]
source: relay-a36561
agent: codex
---

Documentation review finding F5 at c2f0b07a18f24376189ce524d7aeb2b3f15c87c9: README.md says twenty event mappings. The current immutable tables in src/adapters/claude-code.js, src/adapters/codex.js and src/adapters/opencode.js contain 8 + 8 + 6 = 22. Correct the count to twenty-two, or remove the unnecessary number while preserving the introduction's meaning. Keep this separate from the dated-verification cleanup already owned by relay-480b51. Done when the README agrees with the three source tables and the repository's documentation gates pass. No new runtime tests are needed for the wording correction.

## Notes

- 2026-10-25T02:21:04Z (main): started
  provenance: {"harness_session":"codex:01a170db-326b-7210-974d-9e3001240e5f","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-25T02:21:27Z (docs/cli-mappings): resumed
  provenance: {"harness_session":"codex:01a170db-326b-7210-974d-9e3001240e5f","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-25T02:22:16Z (docs/cli-mappings): Baseline: just test on Node v26.5.0 after just setup in .worktrees/docs-cli-mappings; 739 tests passed, 0 failed, 0 skipped. Source event tables are 8 + 8 + 6 = 22; remove the unnecessary count to avoid recurring drift. Scope is README.md only; dated verification text stays with relay-480b51.
- 2026-10-25T02:24:26Z (docs/cli-mappings): Verification at 1c83f33: source tables confirmed 8 + 8 + 6 = 22; README removes the unnecessary count. just test-fast on Node v26.5.0 and just gate on Node v22.23.2 each passed 739/739 tests, 0 skipped, with gate hygiene/tasks/type checks clean. No new runtime tests were needed for this wording correction.
- 2026-10-25T02:26:08Z (docs/cli-mappings): review: impl round 1 — verdict: accept; findings: none; reviewer: codex/gpt-6.1-sol
- 2026-10-25T02:26:13Z (docs/cli-mappings): attached: docs-review-report.md (2299 bytes): Full read-only branch review by codex/gpt-6.1-sol of frozen revision 1c83f33; accepted with no findings.
- 2026-10-25T02:26:40Z (docs/cli-mappings): Ruling: accept the review exclusions at 1c83f33. Why: dated verification prose has its own scoped owner relay-480b51, and this diff changes no executable code; runtime, live-hook and deployment behavior need no new acceptance exercise. Cost: dated verification prose remains stale until relay-480b51, and existing runtime behavior is outside this review. No Critical, Important or deferred Minor findings.
- 2026-10-25T02:26:44Z (docs/cli-mappings): retained: {"host":"titan","kind":"worktree","path":".worktrees/docs-cli-mappings","state":"kept","verification":"verified","purpose":"Immediate local integration of the reviewed documentation fixes and checked removal in this turn","next_owner":"session:codex:01a170db-326b-7210-974d-9e3001240e5f","cleanup_trigger":"After local merge and merged gate, harvest timings, inspect ignored files and host pointers, then remove the task worktree"}
