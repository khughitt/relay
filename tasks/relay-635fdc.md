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
updated: 2026-10-15T10:03:07Z
started: 2026-10-15T10:03:07Z
depends: [tasks-af3aac]
parent: relay-eaca0e
tags: []
source: relay-6825f7
agent: claude-code/claude-opus-5-5
spec: docs/specs/2026-10-15-codex-worker-rows.md
---

Implement docs/specs/2026-10-15-codex-worker-rows.md: route agent_id events to codex:<agent_id> rows (scope worker, root codex:<R>), SubagentStart/SubagentStop mappings and installer bindings, cascade removal on root SessionEnd, validators and docs/api.md, the shared registry-workers.json fixture, and the live acceptance runs. Merges only after tasks-af3aac (Rollout step 1). Subsumes relay-15b49c.

## Notes

- 2026-10-15T10:03:07Z (relay-6825f7): started
  provenance: {"harness_session":"claude-code:91c56343-8f06-4b5e-91e7-7d018e111bd1","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
