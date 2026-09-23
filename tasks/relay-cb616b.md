---
id: relay-cb616b
title: "resolveAgentPid climbs past a tty-less harness to an outer one, publishing a nested headless session with its parent's handle"
status: doing
priority: 1
size: s
complexity: high
process: planned
owner: fix/nested-headless
created: 2026-09-23T11:26:33Z
updated: 2026-09-23T13:52:37Z
started: 2026-09-23T11:38:02Z
depends: []
tags: [identity]
agent: "claude-code/claude-opus-5-5[1m]"
spec: docs/specs/2026-09-23-session-process-handle.md
plan: docs/plans/2026-09-23-session-process-handle.md
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
- 2026-09-23T12:19:15Z (main): Second review: old tasks continues a held claim by process proof without reading the registry, so the schema gate covers fresh acquisition only. Spec now makes updated tasks a per-host precondition (where the relay opt-in is on) for activating schema-2 relay, adds the held-claim verification, and narrows the mixed-version guarantee
- 2026-09-23T12:19:15Z (main): parked (waiting on user, review): Spec re-review after held-claim precondition (6752aa4); on approval, writing-plans, then file the tasks-side mirror task
  provenance: {"harness_session":"claude-code:22eb583d-5fc2-4364-a75c-e302907e2e4f","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-23T12:19:48Z (main): resumed
  provenance: {"harness_session":"claude-code:22eb583d-5fc2-4364-a75c-e302907e2e4f","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-23T12:26:37Z (fix/nested-headless): parked (waiting on user, review): Plan review and execution choice: docs/plans/2026-09-23-session-process-handle.md (5eae79d); then execute steps relay-21ed8f..relay-be0d6e in this worktree
  provenance: {"harness_session":"claude-code:22eb583d-5fc2-4364-a75c-e302907e2e4f","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-23T12:45:30Z (fix/nested-headless): Plan review: Darwin args splitting could publish a daemon under a home with a space (argv[0] now located by comm, else PROCESS_UNREADABLE; regression tests in Tasks 2-3); live probes now isolate subscribers via a wrapper setting XDG_CONFIG_HOME and --subscribers; spec status moves to Task 6 after the checks pass; background step walks from a child process instead of prompting via attach
- 2026-09-23T12:45:30Z (fix/nested-headless): parked (waiting on user, review): Plan re-review and execution choice after the Darwin argv, probe isolation and status-timing revisions
  provenance: {"harness_session":"claude-code:22eb583d-5fc2-4364-a75c-e302907e2e4f","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-23T12:55:36Z (fix/nested-headless): Plan review 3: probe now calls hook --harness NAME --subscribers FILE EVENT (order verified against the real CLI in a scratch dir); background step is a bg-probe script that records the session id and only a new daemon ancestral to it, with EXIT/INT/TERM cleanup and a bg.owned record for Step 7
- 2026-09-23T12:55:36Z (fix/nested-headless): parked (waiting on user, review): Plan re-review and execution choice after the hook argument order and background-probe ownership fixes
  provenance: {"harness_session":"claude-code:22eb583d-5fc2-4364-a75c-e302907e2e4f","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-23T13:05:22Z (fix/nested-headless): Plan approved by user (execute subagent-driven)
- 2026-09-23T13:05:22Z (fix/nested-headless): resumed
  provenance: {"harness_session":"claude-code:be3ceb58-71ac-4edf-ad48-2caead5c2411","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-23T13:44:22Z (fix/nested-headless): Final review fixes: runbook precondition names tasks-2dd094 with behavioural fallback; docs/api.md documents REGISTRY_SUPERSEDED code and the schema-1 supersede exceptions; ancestry.json corrects interactive-codex source and adds claude-ancestor-under-codex chain; removed unused reduceState/STATES imports in claude-code.test.js and opencode.test.js
- 2026-09-23T13:50:22Z (fix/nested-headless): Step 6 live verification (task 6-brief): Step1 PASS (paths under $S, usage-ok). Step2 PASS: interactive session pid=3810957 checked against /proc/3810957/comm=claude and /proc/3810957/stat field7 tty_nr=34831 (nonzero, pts/15). Step3 FAIL: nested 'claude -p --model haiku' (exact brief command, retried once) refused to run the probe, citing 'variable expansion restrictions' on $CLAUDE_CODE_SESSION_ID inside its own Bash tool; relay list --json showed no second row -- no nested-session pid to check. Step4 PASS: bg session pid=475564 checked against claude agents --json (id 90a42baf, comm=2.1.280, --session-id 90a42baf-... in /proc/475564/cmdline); child pid=475706 resolved via adapterFor('claude-code').resolveSessionPid == 475564; owned daemon pid=475535 (claude daemon run --origin transient, ancestor of 475564) cleaned up by trap, confirmed absent from /proc afterward; $S/bg.owned removed; session 90a42baf no longer in claude agents --json. od -c evidence: bg-pty-host pid 475551 and claude-daemon-run pid 475535 cmdlines are NUL-separated ('claude\0bg-pty-host\0...' and '/home/keith/.local/bin/claude\0daemon\0run\0--origin\0transient\0...'), not space-joined. Step5 PASS: codex pid=477260 checked against relay list --json row codex:01a0ce86-c364-7c30-8024-fa9c6a5c9886 with process.pid=477260 (non-null), matching the 'session id' printed by codex exec output. Step6 PASS: after bumping agents.json schema to 1, first list failed with REGISTRY_SUPERSEDED; reap named both prior ids (claude-code:be3ceb58... and codex:01a0ce86...) on stderr; final list showed exactly one fresh schema-2 row for claude-code:be3ceb58-71ac-4edf-92d890fa... (this session). Overall: Step 3 missed its expectation; per brief Step 7 failure path, spec Status left unchanged, no Step 8 commit.
- 2026-09-23T13:52:37Z (fix/nested-headless): Live Step 3 rerun: nested claude -p published claude-code:9b459a13 with pid 488890 start 96498667, beside the outer claude-code:be3ceb58 at pid 3810957 (comm claude, tty_nr 34831); distinct handles. First attempt failed only because the nested session's permission check refused $CLAUDE_CODE_SESSION_ID expansion in the prompt; rerun used a probe-self wrapper that reads the id itself. Steps 2-6 all met expectations; daemon and bg-pty-host cmdlines confirmed NUL-separated (od -c)
