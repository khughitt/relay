---
id: relay-adb97d
title: Release detached inbox support for pinned consumers
status: doing
priority: 2
size: s
complexity: mid
process: direct
owner: release/v0.2.0
created: 2026-10-24T16:12:06Z
updated: 2026-10-24T16:20:46Z
started: 2026-10-24T16:20:18Z
depends: [relay-8d8e86]
tags: []
source: "relay-8d8e86:release"
agent: codex/gpt-6.1-sol
---

Detached ask/take is merged at 9e72787, but the published tag and hq launcher remain v0.1.1. Prepare the next relay release containing that merge, following [ref:release-guide]. Select the version, update manifest/lockfile and release record, freeze the release commit, run both runtime gates and git-install portability rehearsal, and complete the history/privacy review. Document the new durable histories and that older binaries may quarantine them; do not promise binary downgrade safety. Present the concrete publication actions for user approval before any push/tag publication. After approval, publish an immutable annotated tag and verify anonymous installation on the development runtime and Node 22. Done: verified published tag and release evidence, with the exact tag/commit handed to the hq pin-adoption follow-up. No live install or service changes in this task.

## References

- release-guide (input, required, kind=runbook): docs/runbooks/release.md — release procedure and portability checks
- inbox-api (input, kind=guide): docs/api.md — detached ask and take contracts

## Notes

- 2026-10-24T16:12:22Z (main): concerns: relay-8d8e86 extension — Publish the completed detached-question capability for version-pinned consumers; no implementation defect was found.
- 2026-10-24T16:20:18Z (main): started
  provenance: {"harness_session":"codex:01a16eb5-aa54-7053-9184-86423a7ca4e4","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-24T16:20:35Z (release/v0.2.0): resumed
  provenance: {"harness_session":"codex:01a16eb5-aa54-7053-9184-86423a7ca4e4","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-24T16:20:37Z (release/v0.2.0): Direct release path: prepare v0.2.0 (additive detached question API and durable-history format), reject patch-only numbering; no runtime code, live installation or service changes. Worktree: .worktrees/release-v0.2.0. Publication requires user approval after frozen-commit verification.
- 2026-10-24T16:20:46Z (release/v0.2.0): Scratch created on titan: $WORK_ROOT/relay/relay-adb97d/ for release gate logs, portability evidence and privacy controls; owner relay-adb97d; contents mutable and not yet checkpointed.
