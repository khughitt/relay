---
id: relay-6825f7
title: Design Codex worker registration from the brief
status: todo
priority: 2
size: m
complexity: high
process: planned
created: 2026-10-13T01:33:23Z
updated: 2026-10-15T09:27:22Z
depends: [relay-ed3f00, relay-752a6e]
parent: relay-eaca0e
tags: []
agent: claude-code/claude-opus-5-5
---

Why: relay-f56e30 — tasks refuses a root row for a Codex worker, and relay has no worker row. Done: a reviewed spec in docs/specs/ choosing row key, root association, lifecycle end (no worker end event; SubagentStop is per-turn), meaning of shared-process liveness, and the schema-2 change with its tasks Rust mirror (relay-4a5559); or a reviewed decision not to register workers. Review with the tasks lane (tasks-2fa8c6). Where: docs/notes/2026-10-12-codex-worker-registration-brief.md; relay-ed3f00's capture once done; tasks docs/specs/2026-10-06-delegated-identity-design.md §4.
Ideas it wakes: On completion, run `tasks note relay-f56e30 --no-reviewed "<decision>"`.

## Notes

- 2026-10-13T09:20:01Z (main): design input from hq-872750 (dropped as covered by relay-eaca0e): on Codex 0.162.1 a worker's turn failed on a model-capacity error (mind6 controller session 01a12f9f-8550-7973-832b-e6fd98ffb80c, worker /root/task11_implement, 2026-10-12 13:46Z); the controller received FINAL_ANSWER 'Agent errored: Selected model is at capacity', but the worker's claim still looked live and needed host-load plus tasks start --force to recover. Worker liveness should cover the errored-turn case: does SubagentStop fire when a worker turn fails?
