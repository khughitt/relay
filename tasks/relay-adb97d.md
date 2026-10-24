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
updated: 2026-10-24T16:25:30Z
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
- 2026-10-24T16:21:33Z (release/v0.2.0): Baseline: just test on Node 26.5.0 ran 739 tests, all passed. Release scope reaches package.json, package-lock.json and docs/runbooks/release.md; public API/service downgrade warnings are already current. Runbook commands execute from the task worktree to honor isolation, with privacy path controls derived from the main checkout.
- 2026-10-24T16:23:46Z (release/v0.2.0): Frozen release REL=067c63921602e694682d47bdb2412862359c75ff (do not amend/rebase). just gate: Node 26.5.0 739/739 and Node 22.23.2 739/739, strict checking clean on both. git-install rehearsal on Node26 passed; Node22 rehearsal pending. Fast suite 739/739 also passed, but its completion was confirmed after the preparation commit; frozen-commit gates are subsequent and green. Privacy v0.1.1..REL: 146 commits, first-parent merge diffs, gitleaks no leaks; 4 path patterns and 2 private terms controlled, both scans 0; state/transcript filenames 0; one maintainer address; force-push preimages 0. No optional host file, following earlier releases. Remote main is an ancestor; only main/v0.1.0/v0.1.1 exist. Independent release review dispatched.
- 2026-10-24T16:24:34Z (release/v0.2.0): attached: release-preflight.md (3777 bytes): v0.2.0 frozen-commit preflight, both runtime gates and portable rehearsal outputs; raw outputs retained on task
- 2026-10-24T16:25:04Z (release/v0.2.0): review: impl round 1 — verdict: accept; findings: none; reviewer: codex/gpt-6.1-sol
- 2026-10-24T16:25:15Z (release/v0.2.0): attached: release-review-report.md (2292 bytes): Full independent release review by codex/gpt-6.1-sol at frozen REL; no findings
- 2026-10-24T16:25:16Z (release/v0.2.0): attached: release-review-ledger.md (1505 bytes): Controller rulings for review scope and completed pending checks; no deferred minors
- 2026-10-24T16:25:18Z (release/v0.2.0): Node22 git-install rehearsal also passed; both rehearsals verified manifest, exact REL lock resolution, installed-package smoke and empty-cache npm ci. Regenerable bare rehearsal clone and private pattern files removed. Full independent review and controller rulings attached. Public-tag portability remains pending publication approval. Scope handoff: hq-536849 will receive v0.2.0 / 067c63921602e694682d47bdb2412862359c75ff only after successful anonymous public-tag checks.
- 2026-10-24T16:25:28Z (release/v0.2.0): retained: {"host":"titan","state":"kept","verification":"verified","next_owner":"task:relay-adb97d","cleanup_trigger":"After approved publication, public-tag checks and hq handoff, inspect and preserve needed evidence before checked cleanup","kind":"worktree","path":".worktrees/release-v0.2.0","purpose":"Frozen release candidate and task records awaiting explicit publication approval"}
- 2026-10-24T16:25:30Z (release/v0.2.0): retained: {"host":"titan","state":"kept","verification":"verified","next_owner":"task:relay-adb97d","cleanup_trigger":"After approved publication, public-tag checks and hq handoff, inspect and preserve needed evidence before checked cleanup","kind":"evidence","path":"$WORK_ROOT/relay/relay-adb97d/evidence","purpose":"Raw runtime gate, privacy and rehearsal outputs plus full review and rulings","manifest":"$WORK_ROOT/relay/relay-adb97d/evidence/manifest.sha256","sha256":"030f98f52983db049a6c6a17eb9d58fbcbb1d030a582626537d8db7dc75f1a34"}
