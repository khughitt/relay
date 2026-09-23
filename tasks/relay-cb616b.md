---
id: relay-cb616b
title: "resolveAgentPid climbs past a tty-less harness to an outer one, publishing a nested headless session with its parent's handle"
status: doing
priority: 1
size: s
complexity: high
process: planned
owner: main
created: 2026-09-23T11:26:33Z
updated: 2026-09-23T12:03:04Z
started: 2026-09-23T11:38:02Z
depends: []
tags: [identity]
agent: "claude-code/claude-opus-5-5[1m]"
---

Observed live 2026-09-23 (tasks-1cfbad): a headless 'claude -p' (setsid, no controlling terminal) run from inside an interactive Claude Code session. Its SessionStart hook published claude-code:<nested session> with process = the OUTER claude's pid/start, because every adapter's resolveAgentPid does ancestors.find(comm === <harness> && tty !== null), skipping the nearest harness when it has no tty and adopting the next one up.

Effects: (1) the registry now holds two rows with the same handle, so tasks relay identity refuses the OUTER session with 'several relay agents match pid N' — one nested headless run locks the parent out of claim acquisition; (2) relay reap keeps the row, since the handle's process (the parent) is still alive, so the lockout lasts until a SessionEnd removes the row or the parent exits; (3) any consumer attributing by handle attributes the child's events to the parent.

Fix direction: take the nearest ancestor whose comm is the harness; if it has no tty, publish process: null rather than continuing the walk. Non-nested headless (codex exec) already publishes null correctly. Applies to claude-code, codex and opencode adapters alike.

## Notes

- 2026-09-23T11:38:02Z (main): started
  provenance: {"harness_session":"claude-code:22eb583d-5fc2-4364-a75c-e302907e2e4f","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-23T11:39:26Z (main): The tty filter is deliberate: familiar spike finding C measured a daemon-hosted shape (hook -> 2.1.x -> bg-pty-host -> claude daemon run [no tty] -> claude [tty]) in 370/1507 samples. 'Nearest claude; no tty -> null' would break it, and comm+tty cannot tell that daemon from a nested claude -p. The ops relay design forbids borrowing a terminal-session PID for a headless event, but preserves the measured terminal cases; which process a daemon-hosted session's handle should name is unresolved
- 2026-09-23T11:39:26Z (main): Reassessed to planned/high: needs a design for separating session-process identity from terminal discovery; measuring the claude --bg shape (session ids, cmdlines) first
- 2026-09-23T11:40:26Z (main): Measured claude 2.1.280 --bg (session 9a2732d5): session process comm '2.1.280' (.../claude/versions/2.1.280 --session-id <id>) owns its own pty (tty 34836); parents are bg-pty-host (comm 2.1.280, no tty) -> 'claude daemon run --origin transient' (no tty) -> systemd --user. comm==='claude' never matches the session process itself
- 2026-09-23T11:40:26Z (main): Consequence: in the spike's shape (daemon parented by an interactive claude) the tty predicate attributes a background session to the interactive terminal's session, the same misattribution as nested claude -p; under systemd it yields null and discards a provable handle. The handle's two readers want different processes: familiar wants the terminal to paint, identity wants the session's own process
- 2026-09-23T11:40:37Z (main): parked (waiting on user, decision): Design spec: separate the session-process handle (nearest harness process, tty not required) from terminal discovery; awaiting the direction decision, then brainstorm and draft in docs/specs from worktree .worktrees/nested-headless
  provenance: {"harness_session":"claude-code:22eb583d-5fc2-4364-a75c-e302907e2e4f","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-23T11:42:33Z (main): resumed
  provenance: {"harness_session":"claude-code:22eb583d-5fc2-4364-a75c-e302907e2e4f","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-23T11:45:48Z (main): parked (waiting on user, review): Spec review: docs/specs/2026-09-23-session-process-handle.md on branch fix/nested-headless (worktree .worktrees/nested-headless); on approval, writing-plans, then file the tasks-side mirror task
  provenance: {"harness_session":"claude-code:22eb583d-5fc2-4364-a75c-e302907e2e4f","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-23T12:03:04Z (main): Review: relay-first rollout could let old tasks claim as the outer session (version-named ancestor skipped), and contaminated schema-1 rows survive the upgrade. Spec revised: Snapshot.schema -> 2 so every version pairing fails closed; new relay supersedes a schema-1 store (empty, fresh generation, REGISTRY_SUPERSEDED), operator runs relay reap
- 2026-09-23T12:03:04Z (main): parked (waiting on user, review): Spec re-review after rollout/recovery revision (fbee7f5); on approval, writing-plans, then file the tasks-side mirror task
  provenance: {"harness_session":"claude-code:22eb583d-5fc2-4364-a75c-e302907e2e4f","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
