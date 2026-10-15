---
id: relay-ed3f00
title: Capture genuine Codex subagent hook delivery to a command hook
status: doing
priority: 2
size: m
complexity: mid
process: direct
owner: relay-ed3f00
created: 2026-10-13T01:33:22Z
updated: 2026-10-15T09:05:48Z
started: 2026-10-15T08:59:51Z
depends: []
parent: relay-eaca0e
tags: []
agent: claude-code/claude-opus-5-5
---

Question: At the current Codex release, do SubagentStart and SubagentStop reach a configured command hook, with which payload fields (session_id, agent_id, agent_type, cwd), and do a worker's PreToolUse/UserPromptSubmit payloads identify the worker (agent_id) apart from the controller? Is the hook process's nearest codex ancestor the shared controller process?
Where to start: docs/notes/2026-10-12-codex-worker-registration-brief.md; src/adapters/codex.js and src/install/hooks.js (events relay maps today); tasks-c0bad3's source trace and the 'Lifecycle dispatch' table in the tasks repo's docs/notes/2026-09-30-delegated-identity-brief.md.
Bound: One isolated capture with a private CODEX_HOME and a logging command hook (no relay registry write, no change to the user's hook config): one controller spawning one worker that runs a tool and finishes a turn. Record payloads (IDs redacted to stable labels) and ancestry. No adapter or schema change.
Expected result: An evidence table on this task and in the brief, with the Codex version, and a recommendation among the brief's alternatives.
Ideas it wakes: On completion, run `tasks note relay-f56e30 --no-reviewed "<finding>"` before this result's branch merges.

## Notes

- 2026-10-15T08:59:51Z (main): started
  provenance: {"harness_session":"claude-code:91c56343-8f06-4b5e-91e7-7d018e111bd1","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-15T09:00:00Z (relay-ed3f00): resumed
  provenance: {"harness_session":"claude-code:91c56343-8f06-4b5e-91e7-7d018e111bd1","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-15T09:05:48Z (relay-ed3f00): Capture (Codex 0.162.1 exec, tools/codex-subagent-capture/run): SubagentStart/SubagentStop reach a command hook with root session_id + worker agent_id/agent_type; worker PreToolUse/PostToolUse carry agent_id, controller events never do; worker gets no UserPromptSubmit/Stop/SessionEnd; spawn_agent returns a task name, not agent_id; all hooks share one codex parent; hook env has only CODEX_HOME (no THREAD/SESSION id). Table in brief §7. Recommends alternative 1.
