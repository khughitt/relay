---
id: relay-635fdc
title: Publish Codex worker rows
status: doing
priority: 2
size: m
complexity: mid
process: planned
owner: relay-6825f7
created: 2026-10-15T10:02:39Z
updated: 2026-10-15T10:26:44Z
started: 2026-10-15T10:03:07Z
depends: [tasks-af3aac]
parent: relay-eaca0e
tags: []
source: relay-6825f7
agent: claude-code/claude-opus-5-5
spec: docs/specs/2026-10-15-codex-worker-rows.md
plan: docs/plans/2026-10-15-codex-worker-rows.md
---

Implement docs/specs/2026-10-15-codex-worker-rows.md: route agent_id events to codex:<agent_id> rows (scope worker, root codex:<R>), SubagentStart/SubagentStop mappings and installer bindings, cascade removal on root SessionEnd, validators and docs/api.md, the shared registry-workers.json fixture, and the live acceptance runs. Merges only after tasks-af3aac (Rollout step 1). Subsumes relay-15b49c.

## Notes

- 2026-10-15T10:03:07Z (relay-6825f7): started
  provenance: {"harness_session":"claude-code:91c56343-8f06-4b5e-91e7-7d018e111bd1","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-15T10:12:46Z (relay-6825f7): parked (waiting on user, review): User: review .worktrees/relay-6825f7/docs/plans/2026-10-15-codex-worker-rows.md and pick an execution method. Agent then records the plan review round and executes Tasks 1-5 in the relay-6825f7 worktree; Task 6 waits for tasks-af3aac.
  provenance: {"harness_session":"claude-code:91c56343-8f06-4b5e-91e7-7d018e111bd1","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-15T10:24:28Z (relay-6825f7): resumed
  provenance: {"harness_session":"claude-code:91c56343-8f06-4b5e-91e7-7d018e111bd1","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-15T10:24:29Z (relay-6825f7): review: plan round 1 — verdict: revise; findings: P2 4; reviewer: human
- 2026-10-15T10:26:43Z (relay-6825f7): Plan round 1 fixes: registry judge skips logging-only events and requires a captured SessionEnd publication removing the session's rows (reap checked separately; background quits via /quit); summarize.mjs filters hook records; claims judge matches PostToolUse results (exit codes, tasks error kinds claimed/config from tasks source).
- 2026-10-15T10:26:44Z (relay-6825f7): parked (waiting on user, review): User: re-review .worktrees/relay-6825f7/docs/plans/2026-10-15-codex-worker-rows.md (round 2) and pick an execution method. Agent then records the round and executes Tasks 1-5 in the relay-6825f7 worktree; Task 6 waits for tasks-af3aac.
  provenance: {"harness_session":"claude-code:91c56343-8f06-4b5e-91e7-7d018e111bd1","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
