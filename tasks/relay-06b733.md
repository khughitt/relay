---
id: relay-06b733
title: Rewrite the work account's login out of relay history and recreate the private GitHub repository before v0.1.0
status: todo
priority: 1
size: m
complexity: mid
process: direct
created: 2026-10-18T19:43:09Z
updated: 2026-10-18T19:43:09Z
depends: []
tags: [git]
agent: claude-code/claude-opus-5-5
---

Why: relay-c19c0a makes khughitt/relay public, which publishes its whole history permanently. Plan review round 2 (docs/plans/2026-10-18-v0.1.0-publication.md) found two exposures. (1) The work gh account's login (the account gh auth status lists besides khughitt) has been in a task record since 188b541 (2026-09-16), so it is in about 1010 commits' trees, plus the plan's first two commits on release/v0.1.0. (2) The 2026-10-17 force-push (d7ac402 -> 07ee5ef, relay-653378) left its pre-images on GitHub, fetchable by sha, and the repository's activity names the old head. The public tasks and familiar repositories carry neither. Never write the login itself in a record, commit message or doc; read it from gh auth status.

Procedure (relay-653378's, which follows ops-e5b39c's pilot): no other agent session in relay on any host; bundle --all as a backup outside Dropbox; a mirror clone; git filter-repo --replace-text replacing the login (and its employer token) with <work-account> across every ref; byte-verify that the trees differ only in those strings; citation check; one guarded update-ref transaction for main, release/v0.1.0 and the detached transponder-fixtures worktree, with worktrees clean and reset to the new commits afterwards; attach the old->new commit map; just test-fast; repin transponder's relay pin as trans-007d9e did. Then the repository: the khughitt token lacks the delete_repo scope, so the user deletes khughitt/relay (web UI, or after gh auth refresh -h github.com -s delete_repo), then GH_TOKEN=$(gh auth token --user khughitt) gh repo create khughitt/relay --private, and git push origin main only.

Done: git log --all -p over every ref has no case-insensitive match for the login or its employer token; GitHub's activity for khughitt/relay shows no force_push; the remote lists only refs/heads/main, equal to local main; other hosts' checkouts (Europa) show the new history and pass git fsck.

Authorization: rewriting local refs and deleting and recreating the GitHub repository are each the user's explicit go-ahead.
