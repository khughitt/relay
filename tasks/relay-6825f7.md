---
id: relay-6825f7
title: Design Codex worker registration from the brief
status: doing
priority: 2
size: m
complexity: high
process: planned
owner: relay-6825f7
created: 2026-10-13T01:33:23Z
updated: 2026-10-15T09:52:44Z
started: 2026-10-15T09:36:30Z
depends: [relay-ed3f00, relay-752a6e]
parent: relay-eaca0e
tags: []
agent: claude-code/claude-opus-5-5
spec: docs/specs/2026-10-15-codex-worker-rows.md
---

Why: relay-f56e30 — tasks refuses a root row for a Codex worker, and relay has no worker row. Done: a reviewed spec in docs/specs/ choosing row key, root association, lifecycle end (no worker end event; SubagentStop is per-turn), meaning of shared-process liveness, and the schema-2 change with its tasks Rust mirror (relay-4a5559); or a reviewed decision not to register workers. Review with the tasks lane (tasks-2fa8c6). Where: docs/notes/2026-10-12-codex-worker-registration-brief.md; relay-ed3f00's capture once done; tasks docs/specs/2026-10-06-delegated-identity-design.md §4.
Ideas it wakes: On completion, run `tasks note relay-f56e30 --no-reviewed "<decision>"`.

## Notes

- 2026-10-13T09:20:01Z (main): design input from hq-872750 (dropped as covered by relay-eaca0e): on Codex 0.162.1 a worker's turn failed on a model-capacity error (mind6 controller session 01a12f9f-8550-7973-832b-e6fd98ffb80c, worker /root/task11_implement, 2026-10-12 13:46Z); the controller received FINAL_ANSWER 'Agent errored: Selected model is at capacity', but the worker's claim still looked live and needed host-load plus tasks start --force to recover. Worker liveness should cover the errored-turn case: does SubagentStop fire when a worker turn fails?
- 2026-10-15T09:27:24Z (main): Inputs from relay-ed3f00's capture: worker rows are feasible (brief §7); relay-15b49c fixes worker events landing on the root row in either alternative; relay-752a6e answers the lifecycle cases (repeat turns, failed turn, background, nested) before the spec settles row removal.
- 2026-10-15T09:35:57Z (relay-752a6e): relay-752a6e (brief §8): no worker end event in any case; SubagentStart once only; interrupted/failed turns emit no SubagentStop; worker events outlive the root's Stop; immediate parent only from SubagentStop transcript_path.
- 2026-10-15T09:36:30Z (main): started
  provenance: {"harness_session":"claude-code:91c56343-8f06-4b5e-91e7-7d018e111bd1","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-15T09:36:35Z (relay-6825f7): resumed
  provenance: {"harness_session":"claude-code:91c56343-8f06-4b5e-91e7-7d018e111bd1","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-15T09:41:58Z (relay-6825f7): Spec drafted: worker rows codex:<agent_id> sharing the root's handle with root: codex:<R>; cascade removal on root SessionEnd; SubagentStart/SubagentStop installed (SubagentStop gets Stop's refusal channel); tasks tie-break by thread hint required first (rollout order, no schema bump). Rejected: process:null rows, workers-inside-root, native-only, schema 3.
- 2026-10-15T09:41:59Z (relay-6825f7): parked (waiting on user, review): User: review .worktrees/relay-6825f7/docs/specs/2026-10-15-codex-worker-rows.md. Agent then records the review round, files the tasks tie-break piece under relay-eaca0e, and writes the implementation plan in docs/plans/.
  provenance: {"harness_session":"claude-code:91c56343-8f06-4b5e-91e7-7d018e111bd1","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-15T09:52:43Z (relay-6825f7): resumed
  provenance: {"harness_session":"claude-code:91c56343-8f06-4b5e-91e7-7d018e111bd1","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-15T09:52:44Z (relay-6825f7): review: spec round 1 — verdict: revise; findings: P2 2; reviewer: human
