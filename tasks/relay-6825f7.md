---
id: relay-6825f7
title: Design Codex worker registration from the brief
status: todo
priority: 2
size: m
complexity: high
process: planned
created: 2026-10-13T01:33:23Z
updated: 2026-10-13T01:33:23Z
depends: [relay-ed3f00]
parent: relay-eaca0e
tags: []
agent: claude-code/claude-opus-5-5
---

Why: relay-f56e30 — tasks refuses a root row for a Codex worker, and relay has no worker row. Done: a reviewed spec in docs/specs/ choosing row key, root association, lifecycle end (no worker end event; SubagentStop is per-turn), meaning of shared-process liveness, and the schema-2 change with its tasks Rust mirror (relay-4a5559); or a reviewed decision not to register workers. Review with the tasks lane (tasks-2fa8c6). Where: docs/notes/2026-10-12-codex-worker-registration-brief.md; relay-c4ad1d's capture once done; tasks docs/specs/2026-10-06-delegated-identity-design.md §4.
Ideas it wakes: On completion, run `tasks note relay-f56e30 --no-reviewed "<decision>"`.
