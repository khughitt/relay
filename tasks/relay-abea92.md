---
id: relay-abea92
title: "Anchor Agent.projectKey to the main worktree, as familiar's visual identity does"
status: shelved
priority: 2
created: 2026-10-19T09:56:32Z
updated: 2026-10-20T09:09:01Z
depends: []
tags: []
source: fam-6e8321
agent: claude-code/claude-opus-5-5
---

Relay keys projectKey on remote ?? repoRoot ?? cwd, where repoRoot is the worktree's own toplevel. Familiar (7c6db07) keys on remote ?? repositoryRoot ?? cwd, the main worktree, with physical paths, so a remote-less repository's worktrees share their checkout's identity. Familiar keeps its own key for visuals (familiar spec docs/specs/2026-10-19-relay-consumer-design.md §5), so the two may differ. Question: should relay's project identity anchor the same way, for tasks and other consumers?

## Notes

- 2026-10-20T09:09:00Z (main): shelved: A consumer of relay's projectKey (tasks claims, lookout, transponder, or an ask's context.project) needs the worktrees of a remote-less repository to share one project identity, or familiar wants to adopt relay's key for visuals; none keys on it today
- 2026-10-20T09:09:01Z (main): scope: shelved; evidence at relay 0520118 (src/bus/identity.js: projectKeyFor = remote ?? repoRoot ?? cwd, repoRoot from git rev-parse --show-toplevel), familiar 7c6db07 (repositoryRoot via --git-common-dir, one extra git spawn per event) and familiar spec docs/specs/2026-10-19-relay-consumer-design.md §5 on branch feat/relay-identity (a16f4da, worktree only, not on familiar main). The keys differ only for a remote-less repository with linked worktrees; a repository with an origin keys on the remote either way. Consumers checked: tasks src/relay/snapshot.rs validates projectKey as non-empty text and never keys on it; lookout reads familiar's repoRoot/repositoryRoot and the project label; obs has it only in test fixtures; relay's ask route copies it into an ask's context.project (typed-interaction spec §4.1), informational. Implementation is established if wanted (port familiar's anchor probe; s, low, direct), but no consumer needs it, so it waits on one.
