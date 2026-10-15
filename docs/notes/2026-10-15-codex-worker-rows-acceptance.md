# Codex worker rows — registry acceptance

Run 2026-10-15 for `relay-635fdc` (plan `docs/plans/2026-10-15-codex-worker-rows.md`,
Task 5; spec `docs/specs/2026-10-15-codex-worker-rows.md`, "Testing"). Codex
`codex-cli 0.162.1`; relay at `e558ca5` (Tasks 1–4 on branch `relay-6825f7`) plus the
capture tool changes committed with this note.

Each case ran `tools/codex-subagent-capture/run --relay bin/relay.js --case <case>`:
a private `CODEX_HOME` (auth copied in, removed on exit), relay's own Codex hooks from
`relay install` with an empty subscriber file, a private `RELAY_STATE_DIR`, and every
relay hook wrapped by the logging hook, which copies `agents.json` after relay handled
the event. `judge-registry.mjs` judged each run from those copies. The user's harness,
relay and tasks configuration were not touched.

## Judge results

| Case | Result |
| --- | --- |
| single | PASS: 3 worker events, SessionEnd removed the session's rows, reap left none |
| nested | PASS: 7 worker events, SessionEnd removed the session's rows, reap left none |
| background | PASS: 3 worker events, SessionEnd removed the session's rows, reap left none |

In every case the worker rows were `codex:<agent_id>` with `scope: "worker"` and `root`
naming the root session, on the root's process handle; no worker event changed the root
row; the root's SessionEnd publication removed the root and all its workers; `relay reap`
after Codex exited left an empty registry. In `nested`, both workers (outer and inner)
name the root session, not each other, and share its pid.

`background` is the `relay-15b49c` case: the worker runs after the controller's Stop.
The root row's state per registry copy:

| After | Root | Worker |
| --- | --- | --- |
| SessionStart | idle | — |
| UserPromptSubmit | working | — |
| PreToolUse (spawn) | working | — |
| Stop | done | — |
| SubagentStart | done | working |
| PreToolUse (worker Bash) | done | working |
| SubagentStop | done | done |
| SessionEnd | (empty registry) | |

The first `background` attempt failed the judge with "no SessionEnd publication
captured": `run` sent `/quit` and Enter in one `tmux send-keys`, the TUI read the burst
as pasted text and left `/quit` in the composer, so Codex never ended the session. `run`
now pauses one second before Enter; the rerun above fired SessionEnd.

## Hook sequences

Ids are redacted by `summarize.mjs` (R root, W1/W2 workers, P1 the codex process).

### single

| # | s | Event | Turn | `session_id` | `agent_id` / `agent_type` | codex | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.0 | SessionStart | — | R | absent | P1 | source: startup; transcript: R's rollout |
| 2 | 0.3 | UserPromptSubmit | T1 | R | absent | P1 | transcript: R's rollout |
| 3 | 3.3 | PreToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 4 | 3.6 | PostToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 5 | 7.4 | PreToolUse | T1 | R | absent | P1 | tool: collaborationwait_agent; transcript: R's rollout |
| 6 | 7.6 | SubagentStart | T2 | R | W1 / `default` | P1 | transcript: W1's rollout |
| 7 | 10.8 | PreToolUse | T2 | R | W1 / `default` | P1 | tool: Bash; transcript: W1's rollout |
| 8 | 11.2 | PostToolUse | T2 | R | W1 / `default` | P1 | tool: Bash; transcript: W1's rollout |
| 9 | 13.6 | SubagentStop | T2 | R | W1 / `default` | P1 | stop_hook_active: false; transcript: R's rollout; agent transcript: W1's rollout |
| 10 | 13.8 | PostToolUse | T1 | R | absent | P1 | tool: collaborationwait_agent; transcript: R's rollout |
| 11 | 16.9 | Stop | T1 | R | absent | P1 | stop_hook_active: false; transcript: R's rollout |
| 12 | 17.2 | SessionEnd | — | R | absent | P1 | reason: other; transcript: R's rollout |

### nested

| # | s | Event | Turn | `session_id` | `agent_id` / `agent_type` | codex | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.0 | SessionStart | — | R | absent | P1 | source: startup; transcript: R's rollout |
| 2 | 0.3 | UserPromptSubmit | T1 | R | absent | P1 | transcript: R's rollout |
| 3 | 5.2 | PreToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 4 | 5.5 | PostToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 5 | 8.9 | PreToolUse | T1 | R | absent | P1 | tool: collaborationwait_agent; transcript: R's rollout |
| 6 | 9.6 | SubagentStart | T2 | R | W1 / `default` | P1 | transcript: W1's rollout |
| 7 | 14.0 | PreToolUse | T2 | R | W1 / `default` | P1 | tool: collaborationspawn_agent; transcript: W1's rollout |
| 8 | 14.3 | PostToolUse | T2 | R | W1 / `default` | P1 | tool: collaborationspawn_agent; transcript: W1's rollout |
| 9 | 17.9 | PreToolUse | T2 | R | W1 / `default` | P1 | tool: collaborationwait_agent; transcript: W1's rollout |
| 10 | 18.4 | SubagentStart | T3 | R | W2 / `default` | P1 | transcript: W2's rollout |
| 11 | 19.2 | PostToolUse | T1 | R | absent | P1 | tool: collaborationwait_agent; transcript: R's rollout |
| 12 | 21.9 | PreToolUse | T1 | R | absent | P1 | tool: collaborationwait_agent; transcript: R's rollout |
| 13 | 22.6 | PreToolUse | T3 | R | W2 / `default` | P1 | tool: Bash; transcript: W2's rollout |
| 14 | 23.0 | PostToolUse | T3 | R | W2 / `default` | P1 | tool: Bash; transcript: W2's rollout |
| 15 | 27.5 | SubagentStop | T3 | R | W2 / `default` | P1 | stop_hook_active: false; transcript: W1's rollout; agent transcript: W2's rollout |
| 16 | 27.9 | PostToolUse | T2 | R | W1 / `default` | P1 | tool: collaborationwait_agent; transcript: W1's rollout |
| 17 | 30.3 | SubagentStop | T2 | R | W1 / `default` | P1 | stop_hook_active: false; transcript: R's rollout; agent transcript: W1's rollout |
| 18 | 30.6 | PostToolUse | T1 | R | absent | P1 | tool: collaborationwait_agent; transcript: R's rollout |
| 19 | 33.5 | Stop | T1 | R | absent | P1 | stop_hook_active: false; transcript: R's rollout |
| 20 | 33.8 | SessionEnd | — | R | absent | P1 | reason: other; transcript: R's rollout |

### background

| # | s | Event | Turn | `session_id` | `agent_id` / `agent_type` | codex | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.0 | SessionStart | — | R | absent | P1 | source: startup; transcript: R's rollout |
| 2 | 0.2 | UserPromptSubmit | T1 | R | absent | P1 | transcript: R's rollout |
| 3 | 3.5 | PreToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 4 | 3.7 | PostToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 5 | 6.3 | Stop | T1 | R | absent | P1 | stop_hook_active: false; transcript: R's rollout |
| 6 | 7.9 | SubagentStart | T2 | R | W1 / `default` | P1 | transcript: W1's rollout |
| 7 | 11.4 | PreToolUse | T2 | R | W1 / `default` | P1 | tool: Bash; transcript: W1's rollout |
| 8 | 26.7 | PostToolUse | T2 | R | W1 / `default` | P1 | tool: Bash; transcript: W1's rollout |
| 9 | 29.9 | SubagentStop | T2 | R | W1 / `default` | P1 | stop_hook_active: false; transcript: R's rollout; agent transcript: W1's rollout |
| 10 | 37.5 | SessionEnd | — | R | absent | P1 | reason: other; transcript: R's rollout |

## Older writer

`reapRegistry` and a Claude `applyEvent` from relay `022f29d` (before worker rows), run
against `test/fixtures/registry-workers.json` in a private `RELAY_STATE_DIR`:

```
reap refused INVALID_SCHEMA
claude event refused INVALID_SCHEMA
unchanged
```

Both refuse with `INVALID_SCHEMA` and the file's bytes are unchanged: the `scope:
"worker"` tripwire holds (spec, "Older writers").

## Claim acquisition

Run 2026-10-15 (plan Task 6) with `tools/codex-worker-claims/run`: Codex `codex-cli
0.162.1`, tasks `0.4.0` built after tasks-af3aac landed. Codex ran under `env -i`
(no `TASKS_SESSION`, `TASKS_SESSION_PID` or `CLAUDE_CODE_SESSION_ID`) with relay's own
hooks, a private relay state, and private `XDG_CONFIG_HOME`/`XDG_STATE_HOME` holding a
throwaway tasks project (two todo tasks, A and B) and `[identity] relay = true`.
`tools/codex-worker-claims/judge.mjs` judged each run from the commands' PostToolUse
results, the `tasks claims` copies taken in each relay hook, the registry copies and
`tasks show` after the run.

| Run | Sandbox | Result |
| --- | --- | --- |
| positive | danger-full-access | PASS |
| control | workspace-write | PASS |

Positive run: A's claim was held only by `codex:R` (the root row) and B's only by
`codex:W` (the worker row, `scope: "worker"`, `root: codex:R`, on the root's handle);
each task's single `started` note carries its own session's provenance; both stayed
`doing`. Command results (ids redacted to A, B, R, W; host, pid and path elided):

| By | Command | Result |
| --- | --- | --- |
| controller | `tasks start A` | started, exit=0 |
| worker | `tasks start B` | started, exit=0 |
| worker | `tasks start A` | `claimed`: claimed by session `codex:R` (live), exit=1 |
| worker | `tasks park A probe` | `claimed`: claimed by session `codex:R` (live), exit=1 |
| worker | `tasks done A probe` | `claimed`: claimed by session `codex:R` (live), exit=1 |
| controller | `tasks start B` | `claimed`: claimed by session `codex:W` (live), exit=1 |
| controller | `tasks park B probe` | `claimed`: claimed by session `codex:W` (live), exit=1 |
| controller | `tasks done B probe` | `claimed`: claimed by session `codex:W` (live), exit=1 |

Control: under the workspace-write sandbox, `tasks start A` refused before any row
matching, and A stayed unclaimed and `todo`:

```
{"error":{"detail":"relay identity: the nearest codex ancestor is pid 1 with no parent, so this command runs in a PID namespace that hides the harness session process (a sandbox helper is pid 1) and relay cannot match it from here; set TASKS_SESSION to this session's exact id, without TASKS_SESSION_PID (a pid from this namespace keeps the claim held after the session ends), or run with the host PID view","kind":"config"}}
exit=1
```
