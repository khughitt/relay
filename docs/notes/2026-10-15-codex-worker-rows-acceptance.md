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
`doing`. Each owner's row was in the registry when its `tasks start` ran, and every
claim held that row's pid, which tasks' native `CODEX_THREAD_ID` fallback never
records; the judge gained that check after review, and a rerun of the positive case
passed it. Command results (ids redacted to A, B, R, W; host, pid and path elided):

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

## Root switches in one process

Run 2026-10-25 for `relay-3d6c93`. Codex `codex-cli 0.164.0`; relay at `1a2198b` plus
the capture tool changes committed with this section. Each case ran
`tools/codex-subagent-capture/run --relay bin/relay.js --case switch-<new|resume|fork>`:
the `background` prompt (one worker running `sleep 15; echo background-ran`, the root
ending its turn without waiting), then, at the worker's first tool call, the switch typed
into the TUI (`/new`, `/resume <id>` of a session saved with `codex exec` before any hook
was configured, or `/fork`), then a prompt asking the new root to run
`echo "THREAD=$CODEX_THREAD_ID SESSION=$CODEX_SESSION_ID"`. The registry was copied to
`before-quit-agents.json` 90 s after the switch (89.3–89.7 s: the wait counts whole
seconds), while the process still lived, then
`/quit` was sent. The TUI ran with `--no-daemon`: from 0.164.0 a plain launch starts a
managed app-server daemon under the private `CODEX_HOME` that outlives the TUI. In the
two one-prompt quit probes below (with and without the flag), every hook's recorded
ancestry was bash, then the TUI's own `codex` process, then the tmux server, so the flag
did not change the handle relay resolves.

**Verdict: a row outlives its root on a live handle.** No case fired a SessionEnd for
the replaced root before `/quit`. The worker kept running across the switch, and its
later hooks still carried the old root's `session_id`, so relay kept updating the
worker row under that root. 90 s after the switch the registry held three rows on one
process handle: `codex:R` (`scope: "session"`, `done`), `codex:W1` (`scope: "worker"`,
`root: codex:R`, `done`) and `codex:R2`. Neither the SessionEnd cascade nor prune
removes the first two while the process lives. Filed as `relay-1ba6de`.

| Case | Old root's SessionEnd | New root's SessionStart | Worker after the switch | `before-quit-agents.json` | Judge |
| --- | --- | --- | --- | --- | --- |
| switch-new | none within 90 s; at `/quit` | `source: startup`, with its first prompt | ran on: PostToolUse `background-ran` and SubagentStop, `session_id` R | R, W1 (root R), R2 | FAIL (2): R still published; W1 outlives R |
| switch-resume | none within 90 s; at `/quit` | `source: resume`, with its first prompt; the saved session's id | same | R, W1 (root R), R2 | FAIL (2): same |
| switch-fork | none within 90 s; at `/quit` | `source: fork`, with its first prompt | same | R, W1 (root R), R2 | FAIL (2): same |

`/quit` after the 90 s hold fired SessionEnd (`reason: other`) for both roots in the
same tenth of a second; relay's cascade removed every row and `relay reap` left none.
In each case the TUI had not exited 20 s after `/quit`, and the run killed its tmux
server.

In every case the new root's command printed `THREAD=R2 SESSION=R2`: on 0.164.0 a tool
call's `CODEX_THREAD_ID` and `CODEX_SESSION_ID` both name the active root after each
switch, as `relay-2cd4b1` found on 0.163.0. No hook sees these variables (no `env`
entry in any record).

SessionStart for the new root arrived with its first prompt, sent about 6 s after the
switch, and not before it (openai/codex#51360 reports the same for `/resume` on 0.160.1;
these runs do not show what a longer wait would bring). Between the switch and
that prompt, relay has no row for the conversation shown in the terminal.

### SessionEnd at `/quit`

A `/quit` sent 2–3 s after a session's last activity, and one sent after 75 s idle,
fired no SessionEnd on 0.163.0 or 0.164.0, while `codex exec` on 0.164.0 did fire one:

| Run | Version | `/quit` after | SessionEnd |
| --- | --- | --- | --- |
| `background` (relay judge: FAIL, "no SessionEnd publication captured") | 0.164.0 | ~3 s after SubagentStop | none; the TUI exited |
| first switch-new, -resume and -fork runs (pre-quit copy 3 s after SubagentStop; outputs not kept) | 0.164.0 | ~3 s after SubagentStop | none |
| one prompt, plain logging hooks, `--no-daemon` | 0.164.0 | ~2 s after Stop | none; the TUI exited |
| the same without `--no-daemon` | 0.164.0 | ~2 s after Stop | none; the TUI exited |
| the same, tmux `remain-on-exit` (the pane's pty stays open, so no SIGHUP) | 0.164.0 | ~2 s after Stop | none; Codex exited 0 |
| the same, idle | 0.164.0 | 75 s after Stop | none; the TUI exited |
| the same | 0.163.0 | ~2 s after Stop | none; the TUI exited |
| `codex exec`, one prompt | 0.164.0 | (exec ends itself) | fired |
| switch cases with the 90 s hold (above) | 0.164.0 | 90 s after the switch | fired for both roots |

Codex's own log (`logs_2.sqlite` in the private home) records no hook dispatch at any
of these quits; in four of them (without `--no-daemon`, `remain-on-exit`, idle and
`background`) its last thread request is an unsubscribe. On 0.162.1 the same `background` case
fired SessionEnd at `/quit` (Judge results above). What makes the hold runs differ is not
established. Filed as `relay-68ca4e`.

### Hook sequences (switch cases, 90 s hold; `background` control)

R is the first root, R2 the root after the switch; the *switch* row is when Enter was
sent after the switch command.

#### switch-new

| # | s | Event | Turn | `session_id` | `agent_id` / `agent_type` | codex | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.0 | SessionStart | — | R | absent | P1 | source: startup; transcript: R's rollout |
| 2 | 0.2 | UserPromptSubmit | T1 | R | absent | P1 | transcript: R's rollout |
| 3 | 4.5 | PreToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 4 | 4.7 | PostToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 5 | 7.4 | Stop | T1 | R | absent | P1 | stop_hook_active: false; transcript: R's rollout |
| 6 | 10.1 | SubagentStart | T2 | R | W1 / `default` | P1 | transcript: W1's rollout |
| 7 | 13.6 | PreToolUse | T2 | R | W1 / `default` | P1 | tool: Bash; transcript: W1's rollout |
| — | 15.1 | *switch: /new* |  |  |  |  |  |
| 8 | 22.9 | SessionStart | — | R2 | absent | P1 | source: startup; transcript: R2's rollout |
| 9 | 23.3 | UserPromptSubmit | T3 | R2 | absent | P1 | transcript: R2's rollout |
| 10 | 26.5 | PreToolUse | T3 | R2 | absent | P1 | tool: Bash; transcript: R2's rollout |
| 11 | 27.1 | PostToolUse | T3 | R2 | absent | P1 | tool: Bash; transcript: R2's rollout |
| 12 | 28.9 | PostToolUse | T2 | R | W1 / `default` | P1 | tool: Bash; transcript: W1's rollout |
| 13 | 31.0 | Stop | T3 | R2 | absent | P1 | stop_hook_active: false; transcript: R2's rollout |
| 14 | 33.2 | SubagentStop | T2 | R | W1 / `default` | P1 | stop_hook_active: false; transcript: R's rollout; agent transcript: W1's rollout |
| 15 | 105.6 | SessionEnd | — | R2 | absent | P1 | reason: other; transcript: R2's rollout |
| 16 | 105.6 | SessionEnd | — | R | absent | P1 | reason: other; transcript: R's rollout |

#### switch-resume

| # | s | Event | Turn | `session_id` | `agent_id` / `agent_type` | codex | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.0 | SessionStart | — | R | absent | P1 | source: startup; transcript: R's rollout |
| 2 | 0.4 | UserPromptSubmit | T1 | R | absent | P1 | transcript: R's rollout |
| 3 | 26.1 | PreToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 4 | 27.3 | PostToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 5 | 35.9 | SubagentStart | T2 | R | W1 / `default` | P1 | transcript: W1's rollout |
| 6 | 37.0 | Stop | T1 | R | absent | P1 | stop_hook_active: false; transcript: R's rollout |
| 7 | 41.1 | PreToolUse | T2 | R | W1 / `default` | P1 | tool: Bash; transcript: W1's rollout |
| — | 43.4 | *switch: /resume* |  |  |  |  |  |
| 8 | 51.7 | SessionStart | — | R2 | absent | P1 | source: resume; transcript: R2's rollout |
| 9 | 52.5 | UserPromptSubmit | T3 | R2 | absent | P1 | transcript: R2's rollout |
| 10 | 56.6 | PreToolUse | T3 | R2 | absent | P1 | tool: Bash; transcript: R2's rollout |
| 11 | 57.2 | PostToolUse | T2 | R | W1 / `default` | P1 | tool: Bash; transcript: W1's rollout |
| 12 | 58.0 | PostToolUse | T3 | R2 | absent | P1 | tool: Bash; transcript: R2's rollout |
| 13 | 60.8 | SubagentStop | T2 | R | W1 / `default` | P1 | stop_hook_active: false; transcript: R's rollout; agent transcript: W1's rollout |
| 14 | 62.7 | Stop | T3 | R2 | absent | P1 | stop_hook_active: false; transcript: R2's rollout |
| 15 | 134.3 | SessionEnd | — | R | absent | P1 | reason: other; transcript: R's rollout |
| 16 | 134.3 | SessionEnd | — | R2 | absent | P1 | reason: other; transcript: R2's rollout |

#### switch-fork

| # | s | Event | Turn | `session_id` | `agent_id` / `agent_type` | codex | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.0 | SessionStart | — | R | absent | P1 | source: startup; transcript: R's rollout |
| 2 | 0.2 | UserPromptSubmit | T1 | R | absent | P1 | transcript: R's rollout |
| 3 | 4.1 | PreToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 4 | 4.3 | PostToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 5 | 6.5 | Stop | T1 | R | absent | P1 | stop_hook_active: false; transcript: R's rollout |
| 6 | 8.7 | SubagentStart | T2 | R | W1 / `default` | P1 | transcript: W1's rollout |
| 7 | 13.7 | PreToolUse | T2 | R | W1 / `default` | P1 | tool: Bash; transcript: W1's rollout |
| — | 15.6 | *switch: /fork* |  |  |  |  |  |
| 8 | 23.4 | SessionStart | — | R2 | absent | P1 | source: fork; transcript: R2's rollout |
| 9 | 23.8 | UserPromptSubmit | T3 | R2 | absent | P1 | transcript: R2's rollout |
| 10 | 27.6 | PreToolUse | T3 | R2 | absent | P1 | tool: Bash; transcript: R2's rollout |
| 11 | 28.1 | PostToolUse | T3 | R2 | absent | P1 | tool: Bash; transcript: R2's rollout |
| 12 | 29.1 | PostToolUse | T2 | R | W1 / `default` | P1 | tool: Bash; transcript: W1's rollout |
| 13 | 31.7 | Stop | T3 | R2 | absent | P1 | stop_hook_active: false; transcript: R2's rollout |
| 14 | 31.7 | SubagentStop | T2 | R | W1 / `default` | P1 | stop_hook_active: false; transcript: R's rollout; agent transcript: W1's rollout |
| 15 | 106.0 | SessionEnd | — | R | absent | P1 | reason: other; transcript: R's rollout |
| 16 | 106.0 | SessionEnd | — | R2 | absent | P1 | reason: other; transcript: R2's rollout |

#### background

| # | s | Event | Turn | `session_id` | `agent_id` / `agent_type` | codex | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.0 | SessionStart | — | R | absent | P1 | source: startup; transcript: R's rollout |
| 2 | 0.4 | UserPromptSubmit | T1 | R | absent | P1 | transcript: R's rollout |
| 3 | 3.6 | PreToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 4 | 3.9 | PostToolUse | T1 | R | absent | P1 | tool: collaborationspawn_agent; transcript: R's rollout |
| 5 | 6.4 | Stop | T1 | R | absent | P1 | stop_hook_active: false; transcript: R's rollout |
| 6 | 9.0 | SubagentStart | T2 | R | W1 / `default` | P1 | transcript: W1's rollout |
| 7 | 11.9 | PreToolUse | T2 | R | W1 / `default` | P1 | tool: Bash; transcript: W1's rollout |
| 8 | 27.6 | PostToolUse | T2 | R | W1 / `default` | P1 | tool: Bash; transcript: W1's rollout |
| 9 | 30.0 | SubagentStop | T2 | R | W1 / `default` | P1 | stop_hook_active: false; transcript: R's rollout; agent transcript: W1's rollout |
