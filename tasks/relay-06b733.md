---
id: relay-06b733
title: Rewrite the work account's login out of relay history and recreate the private GitHub repository before v0.1.0
status: doing
priority: 1
size: m
complexity: mid
process: direct
owner: release/v0.1.0
created: 2026-10-18T19:43:09Z
updated: 2026-10-18T21:04:45Z
started: 2026-10-18T20:57:10Z
depends: []
tags: [git]
agent: claude-code/claude-opus-5-5
---

Why: relay-c19c0a makes khughitt/relay public, which publishes its whole history permanently. Plan review round 2 (docs/plans/2026-10-18-v0.1.0-publication.md) found two exposures. (1) The work gh account's login (the account gh auth status lists besides khughitt) has been in a task record since 188b541 (2026-09-16), so it is in about 1010 commits' trees, plus the plan's first two commits on release/v0.1.0. (2) The 2026-10-17 force-push (d7ac402 -> 07ee5ef, relay-653378) left its pre-images on GitHub, fetchable by sha, and the repository's activity names the old head. The public tasks and familiar repositories carry neither. Never write the login itself in a record, commit message or doc; read it from gh auth status.

Procedure (relay-653378's, which follows ops-e5b39c's pilot): no other agent session in relay on any host; bundle --all as a backup outside Dropbox; a mirror clone; git filter-repo --replace-text replacing the login (and its employer token) with <work-account> across every ref; byte-verify that the trees differ only in those strings; citation check; one guarded update-ref transaction for main, release/v0.1.0 and the detached transponder-fixtures worktree, with worktrees clean and reset to the new commits afterwards; attach the old->new commit map; just test-fast; repin transponder's relay pin as trans-007d9e did. Then the repository: the khughitt token lacks the delete_repo scope, so the user deletes khughitt/relay (web UI, or after gh auth refresh -h github.com -s delete_repo), then GH_TOKEN=$(gh auth token --user khughitt) gh repo create khughitt/relay --private, and git push origin main only.

Done: git log --all -p --diff-merges=first-parent (merge resolutions included) over every ref, and the same with --format='%an%n%cn%n%B', have no case-insensitive match for the login or its employer token; GitHub's activity for khughitt/relay shows no force_push; git ls-remote --refs origin lists only refs/heads/main, equal to local main; other hosts' checkouts (Europa) show the new history and pass git fsck.

Authorization: rewriting local refs and deleting and recreating the GitHub repository are each the user's explicit go-ahead.

## Notes

- 2026-10-18T19:46:21Z (release/v0.1.0): Gates relay-286ecb (plan Task 5 of docs/plans/2026-10-18-v0.1.0-publication.md). It rewrites release/v0.1.0 as well as main, so run it between plan steps, with .worktrees/relay-c19c0a clean and no step in progress.
- 2026-10-18T20:31:18Z (release/v0.1.0): User decision 2026-10-18: rewrite (not recreate-only, not publish as is); the user deletes khughitt/relay manually when the step comes, then the agent recreates it private and pushes main.
- 2026-10-18T20:57:10Z (release/v0.1.0): started
  provenance: {"harness_session":"claude-code:143d6b37-5966-4303-8175-b0a0e4983892","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-18T21:00:07Z (release/v0.1.0): attached: 2026-10-18-account-rewrite-commit-map.txt (86592 bytes): Account-name rewrite map: 1056 changed commit IDs (old new); resolves SHAs cited in task notes and docs from before 2026-10-18
- 2026-10-18T21:03:45Z (release/v0.1.0): Local rewrite applied 2026-10-18 (work dir WORK_ROOT/relay/history-rewrite-20261018T205736Z: all.bundle backup, mirror.git, refs-before, ref-transaction). filter-repo --replace-text over main, release/v0.1.0, relay-4c4828, relay-a1510a in a --no-local mirror; verified 1056 changed commits: headers and mapped parents identical, 1048 blob changes each exactly login->placeholder, one message short-hash remap (a7e9888->773818b); login left in rewritten refs: 0 (merge diffs included). One guarded update-ref transaction moved the four branches (main 68cbb46->db4ecd0, release/v0.1.0 95f6d56->59028a9); transponder-fixtures detached HEAD 5e8cdaa->60063d5; tasks/relay-c19c0a.md refreshed in the two checkouts whose tree changed. just test-fast 686/686. Transponder repinned under trans-6989fa (local main ed3aab2, not pushed). Left alone: refs/ops/index-health/* (index trees from ops tooling, local only, never pushed; each holds one file with the login). refs/remotes/origin/* still name the old history until the recreated remote is pushed. Europa unreachable by ssh (timeout), so its fsck waits. Next: the user deletes khughitt/relay; then gh repo create khughitt/relay --private and git push origin main.
- 2026-10-18T21:04:45Z (release/v0.1.0): parked (waiting on user, environment): User deletes the GitHub repository khughitt/relay (web UI Settings > Delete, or after gh auth refresh -h github.com -s delete_repo); then the agent runs GH_TOKEN=$(gh auth token --user khughitt) gh repo create khughitt/relay --private, git push origin main, checks git ls-remote --refs origin and the activity feed, and closes this task (Europa fsck when reachable)
  provenance: {"harness_session":"claude-code:143d6b37-5966-4303-8175-b0a0e4983892","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
