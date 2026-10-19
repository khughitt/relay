---
id: relay-abea92
title: "Anchor Agent.projectKey to the main worktree, as familiar's visual identity does"
status: idea
priority: 2
created: 2026-10-19T09:56:32Z
updated: 2026-10-19T09:56:32Z
depends: []
tags: []
source: fam-6e8321
agent: claude-code/claude-opus-5-5
---

Relay keys projectKey on remote ?? repoRoot ?? cwd, where repoRoot is the worktree's own toplevel. Familiar (7c6db07) keys on remote ?? repositoryRoot ?? cwd, the main worktree, with physical paths, so a remote-less repository's worktrees share their checkout's identity. Familiar keeps its own key for visuals (familiar spec docs/specs/2026-10-19-relay-consumer-design.md §5), so the two may differ. Question: should relay's project identity anchor the same way, for tasks and other consumers?
