---
id: relay-c19c0a
title: Publish the verified relay v0.1.0 Git dependency
status: doing
priority: 1
size: l
complexity: mid
process: planned
owner: release/v0.1.0
created: 2026-09-17T00:50:54Z
updated: 2026-10-18T21:36:19Z
started: 2026-10-18T18:56:31Z
depends: [relay-06b1da, relay-4c4828, relay-baa816, ops-c8e4d1, tasks-2dd094, relay-b12132, relay-6e9410, relay-7eef39, relay-5e4d93]
parent: relay-1231bf
tags: []
source: ops-998bbb
agent: codex
plan: docs/plans/2026-10-18-v0.1.0-publication.md
---

Approved source: ops docs/specs/2026-09-16-relay-design.md (reviewed after d7e2c33); execution brief: ops docs/plans/2026-09-16-relay-bootstrap.md (approved after bc53c51 with review corrections).

Next: write a focused publication plan against the approved spec for user review; add a spec addendum only if inspection uncovers an unresolved contract.

Darwin is not a publication gate (rescope note 2026-10-18). The approved design requires
a Darwin live probe before changing Darwin's installed hooks; that run is relay-848c0f and
gates the Mac cutover. The release runbook, README and docs/api.md say v0.1.0 is verified
on Linux and fixture-tested on Darwin, with the physical probe pending.

Create relay `docs/runbooks/release.md` with the reviewed release commit, packaged
file list, license provenance, passing gates and capability evidence. Verify the
release contains no private paths, subscriber configuration, transcripts or state.
The whole history becomes public with the repository, task records included. The
2026-10-18 scan was clean (rescope note); rerun it on the release commit.
Make the repository public only after the implementation and publication artifact are
reviewable and publication is authorized. Keep `v0.1.0` unused until that commit is
ready; never move an existing tag to make a failed release look successful.

The remote **`khughitt/relay`** exists and is private (main pushed 2026-10-17).
Publication makes it public. Name the account on every gh command rather than
switching the global one:

```sh
GH_TOKEN=$(gh auth token --user khughitt) gh api user --jq .login
GH_TOKEN=$(gh auth token --user khughitt) gh repo view khughitt/relay --json nameWithOwner,visibility,url
```

Require the login result to be `khughitt`; the work gh account must never be used here.
If the repository is missing, or is not the private relay whose main matches
origin/main, stop. When publication is authorized:

```sh
GH_TOKEN=$(gh auth token --user khughitt) gh repo edit khughitt/relay --visibility public --accept-visibility-change-consequences
```

Inspect `git remote -v`, require the correct owner, tag the reviewed commit with
`git tag -a v0.1.0 -m "relay v0.1.0"`, and push that commit/branch and tag through
normal repository gates. Verify the remote tag resolves to the reviewed commit.

In an isolated temporary checkout with an empty npm cache, empty Git credential
configuration, no local relay path and terminal credential prompts disabled,
install `git+https://github.com/khughitt/relay.git#v0.1.0`. Inspect the generated
lockfile's resolved commit, exercise the CLI and named exports, then repeat with
`npm ci`. Keep credentials out of logs. This is the portability test; the earlier
local Git URL experiment only established tag-pinning semantics.

Prerequisites: relay-06b1da, relay-4c4828, relay-baa816, ops-c8e4d1. Release goal: relay-1231bf. Bootstrap ops-998bbb closure does not mean this deliverable has shipped.

## Notes

- 2026-09-17T08:15:54Z (relay-06b1da): R1 passed Node 26.5.0 and 22.23.2 full gates (150 tests including tarball and Linux IPC) and independent review. Physical Darwin process/terminal verification has not run: retain that explicit release/cutover gate; portable Darwin fixtures ran on Linux only. Registry API and repair procedure are in docs/api.md and docs/runbooks/registry-lock-repair.md.
- 2026-09-25T21:47:24Z (main): Probe attempt 3 is built: dist/relay-darwin-probe-df6f741.tar.gz (relay df6f741, ops 1169107 with the token write-back); just darwin-bundle-check passed (claude-code and codex preflight ok). Mac Claude brief: dist/relay-mac-handoff-3.md (baseline npm test, lock load acceptance for relay-5e4d93, relay-ba3153 test premises). The user runs ./run after that session, with the Mac idle.
- 2026-09-25T21:47:24Z (main): parked (waiting on user, environment): User: (1) give a Mac Claude session dist/relay-mac-handoff-3.md plus the probe tarball and return ~/Downloads/relay-mac-report-3.md and relay-mac-3.bundle; (2) on the idle Mac run tar xzf relay-darwin-probe-df6f741.tar.gz && cd relay-darwin-probe-df6f741 && ./run and return the results tarball. Agent then merges mac/relay-ba3153, runs just darwin-judge on the tarball in a worktree, commits attempt 3, and writes the v0.1.0 publication plan
  provenance: {"harness_session":"claude-code:3c606fb5-d94a-4c2d-b41f-4c120db27c0d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-18T18:56:31Z (main): started
  provenance: {"harness_session":"claude-code:143d6b37-5966-4303-8175-b0a0e4983892","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-18T18:57:03Z (main): Rescope 2026-10-18: the approved ops design ('Required verification for the release') requires a Darwin live probe 'before changing its installed hooks', i.e. before the Mac cutover, not before tagging; 'physical Darwin remains a release gate' entered through relay-06b1da's execution note and spread to README, docs/api.md and the probe runbook. Attempt 3's bundle (df6f741, 2026-09-25) is 795 commits behind main, and Darwin paths changed since (proc.js start interval and nearest harness, lock.js, identity.js, transaction.js, the Codex model resolver), so it cannot evidence any release commit. Dependents need only a public pin: fam-6e8321 pins the tag; hq-539508 already records platforms awaiting probes rather than claiming a universal cutover. The Mac run moves to its own child of relay-1231bf, rebuilt at a current commit, gating the Mac cutover and familiar's rollout on the Mac.
- 2026-10-18T18:58:03Z (release/v0.1.0): resumed
  provenance: {"harness_session":"claude-code:143d6b37-5966-4303-8175-b0a0e4983892","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-18T19:02:16Z (release/v0.1.0): Pre-plan findings 2026-10-18: (1) a git-dependency install omits jsonc-parser: bundledDependencies names it, but a clone has no node_modules, so the packed git package lacks it and npm does not fetch a bundled name; relay list and the exports load, relay install fails ERR_MODULE_NOT_FOUND (rehearsed with git+file of a bare clone at a scratch tag, empty cache). The local tarball smoke passes only because npm pack runs beside node_modules. (2) History is publishable: gitleaks clean over 997 commits; no transcripts, state, credentials or bundles ever tracked; one author email; no user paths outside tasks/, whose machine paths match the public tasks and familiar repos; the tailnet hostname was already rewritten out on 2026-10-13.
- 2026-10-18T19:33:08Z (release/v0.1.0): review: plan round 1 — verdict: revise; findings: P1 1, P2 1, P3 1; reviewer: human
- 2026-10-18T19:38:29Z (release/v0.1.0): review: plan round 2 — verdict: revise; findings: Critical 0, Important 9, Minor 12; reviewer: claude-code/claude-opus-5-5
- 2026-10-18T19:46:40Z (release/v0.1.0): parked (waiting on user, review): User reviews docs/plans/2026-10-18-v0.1.0-publication.md at 89ba5f0 in .worktrees/relay-c19c0a, including relay-06b733 (rewrite the work account's login out of history and recreate the private repo); on approval the agent executes Task 1 (relay-3d876f) onward inline, runs relay-06b733 between steps once authorized, and dispatches a whole-branch review before Task 5
  provenance: {"harness_session":"claude-code:143d6b37-5966-4303-8175-b0a0e4983892","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-18T20:31:16Z (release/v0.1.0): resumed
  provenance: {"harness_session":"claude-code:143d6b37-5966-4303-8175-b0a0e4983892","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-18T20:31:17Z (release/v0.1.0): review: plan round 3 — verdict: revise; findings: P1 1, P2 1; reviewer: human
- 2026-10-18T20:32:50Z (release/v0.1.0): Plan round 3 fixes applied (merge diffs in every history scan, gitleaks included, both reproduced with a control; --refs remote inventories, checked against the live remote). The user's round-3 verdict was fix-then-execute; executing inline from Task 1. Scans rerun with merge diffs over 1039 commits (14 merges): gitleaks, path and filename searches clean.
- 2026-10-18T21:36:18Z (release/v0.1.0): resumed
  provenance: {"harness_session":"claude-code:143d6b37-5966-4303-8175-b0a0e4983892","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-18T21:36:19Z (release/v0.1.0): review: impl round 1 — verdict: revise; findings: Critical 0, Important 1, Minor 9; reviewer: claude-code/claude-opus-5-5
