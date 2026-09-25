---
id: relay-c19c0a
title: Publish the verified relay v0.1.0 Git dependency
status: todo
priority: 1
size: l
complexity: mid
process: planned
created: 2026-09-17T00:50:54Z
updated: 2026-09-25T18:48:36Z
depends: [relay-06b1da, relay-4c4828, relay-baa816, ops-c8e4d1, tasks-2dd094, relay-b12132, relay-6e9410, relay-7eef39]
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
