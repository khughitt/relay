---
id: relay-c19c0a
title: Publish the verified relay v0.1.0 Git dependency
status: doing
priority: 1
size: l
complexity: mid
process: planned
owner: main
created: 2026-09-17T00:50:54Z
updated: 2026-10-18T18:57:03Z
started: 2026-10-18T18:56:31Z
depends: [relay-06b1da, relay-4c4828, relay-baa816, ops-c8e4d1, tasks-2dd094, relay-b12132, relay-6e9410, relay-7eef39, relay-5e4d93]
parent: relay-1231bf
tags: []
source: ops-998bbb
agent: codex
---

Approved source: ops docs/specs/2026-09-16-relay-design.md (reviewed after d7e2c33); execution brief: ops docs/plans/2026-09-16-relay-bootstrap.md (approved after bc53c51 with review corrections).

Next: write a focused implementation plan against the approved spec for user review; add a spec addendum only if inspection uncovers an unresolved contract.

Create relay `docs/runbooks/release.md` with the reviewed release commit, packaged
file list, license provenance, passing gates and capability evidence. Verify the
release contains no private paths, subscriber configuration, transcripts or state.
Create the remote only after the implementation and publication artifact are
reviewable and publication is authorized. Keep `v0.1.0` unused until that commit is
ready; never move an existing tag to make a failed release look successful.

The remote is **public `khughitt/relay`**. Immediately before the gh write:

```sh
gh auth status
# Only if the active account is wrong:
gh auth switch --user khughitt
gh api user --jq .login
gh repo view khughitt/relay --json nameWithOwner,visibility,url
```

Require the login result to be `khughitt`; `<work-account>` must never be used here.
Distinguish a verified absent repository from authentication/network errors. If an
unexpected existing repository appears, stop before pushing into it. When absent
and creation is authorized, recheck the active account and create without pushing:

```sh
gh repo create khughitt/relay --public --source . --remote origin
```

Inspect `git remote -v`, require the correct owner, tag the reviewed commit with
`git tag -a v0.1.0 -m "relay v0.1.0"`, and push that commit/branch and tag through
normal repository gates. Verify the remote tag resolves to the reviewed commit.
Account state is global: recheck before every later gh write too.

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
