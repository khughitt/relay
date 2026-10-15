---
id: relay-f56e30
title: The Codex adapter does not register SubagentStart/SubagentStop worker identities; a shared harness process and root-session row cannot uniquely identify a worker for claim ownership.
status: idea
priority: 2
created: 2026-10-06T17:25:24Z
updated: 2026-10-15T10:03:05Z
depends: []
parent: relay-eaca0e
tags: [feedback, gap, "from:tasks"]
agent: codex
---

## Notes

- 2026-10-13T01:33:56Z (main): scope: briefed; parented under goal relay-eaca0e; research relay-ed3f00 (live subagent hook capture) and design relay-6825f7 filed and wake this idea; brief: docs/notes/2026-10-12-codex-worker-registration-brief.md
- 2026-10-15T09:05:49Z (relay-ed3f00): relay-ed3f00 capture at Codex 0.162.1: SubagentStart/SubagentStop and worker tool events reach a command hook with agent_id (= worker thread id) beside the root session_id, so worker rows keyed codex:<agent_id> are feasible; no worker end event exists. Brief §7.
- 2026-10-15T10:03:05Z (relay-6825f7): Decision (relay-6825f7, spec docs/specs/2026-10-15-codex-worker-rows.md approved 2026-10-15): relay publishes worker rows codex:<agent_id> with scope worker and root codex:<R> on the shared handle; tasks-af3aac adds worker scope and a thread-hint tie-break; implementation is relay-635fdc.
