# Codex model resolver

Status: draft 2026-10-17, awaiting review.
Task: `relay-2cd4b1` (goal `hq-fce47e`; consumer `tasks-970049`).
Evidence: lore `docs/notes/2026-10-02-codex-model-identity-brief.md` §5 (hq-1bd166, Codex
0.162.1), the scoping note on `relay-2cd4b1`, and the probes in "Facts" below (Codex
0.163.0, 2026-10-17).
Scope: one read-only command that tells a process running inside a Codex tool call which
model its turn runs, the contract its callers rely on, and the rules that decide when it
refuses to say. How tasks stamps the result (`tasks-970049`) and how the review-note
instruction uses it are separate changes; "Rollout" names them.

## Problem

A Codex session cannot name its own model. ops's Codex config exports
`TASKS_AGENT=codex` as a constant, and the configured default model is not evidence of
the running one (`-m`, profiles, `/model`, a sub-agent spawned on another model). Task
stamps and `review:` notes therefore carry `codex` alone, and the person running the
session adds the model by hand, or it is lost. Claude Code has no such gap: a hook
exports `TASKS_AGENT=claude-code/<model>` on every Bash call.

## Facts the design rests on

From the brief §5 (0.162.1: `codex exec`, `exec resume -m`, multi-agent v2 children):

1. Each turn writes one `turn_context` record, carrying `payload.model` and
   `payload.effort`, to its thread's rollout before its first tool call. The last
   `turn_context` in the rollout is therefore the running turn's, read from inside a
   tool call. Between a model switch and the next turn's record it is stale.
2. `CODEX_THREAD_ID` names the calling thread's own rollout
   (`rollout-<local time>-<thread>.jsonl`), in a top-level session and in a sub-agent.
   `CODEX_SESSION_ID` names the root session, so in a sub-agent it names the parent's
   rollout and model.
3. A sub-agent spawned from the same `codex` process gets its own `CODEX_THREAD_ID`, so
   Codex sets the variable for each thread when it runs a command, not once per process.
4. `session_meta` is not evidence of the running model. A forked sub-agent's rollout
   starts with its own `session_meta`, then copies of the parent's `session_meta` and
   `turn_context`, then its own `turn_context`; the first line's `payload.id` is the
   rollout's own thread id.

Probed on 0.163.0 (2026-10-17, scratch directories, `codex exec`):

5. A tool shell sees `CODEX_THREAD_ID`, `CODEX_SESSION_ID`, `CODEX_TOOL_CALL_ID`,
   `CODEX_VERSION` and `CODEX_PERMISSION_PROFILE`, and no variable carrying a model.
   `CODEX_HOME` appears only when the user set it.
6. Hook processes (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop) see no
   `CODEX_THREAD_ID` and no `CODEX_TOOL_CALL_ID`, only the `CODEX_HOME` that was set.
7. When the command runs, the running tool call is not yet in the rollout (its id first
   appears at `item_completed`), while the turn's `turn_context` already is. A tool-call
   id cannot be used to tie a rollout to the call.
8. Under the `workspace-local` permission profile the command runs in a PID namespace:
   its ancestry ends at pid 1, whose `comm` is `codex`.
9. Every one of 16,392 rollouts lives in `sessions/YYYY/MM/DD/`, where the date is the
   local date of its thread id's UUIDv7 timestamp. This is an observed layout, not a
   documented contract. Archived rollouts sit flat in `archived_sessions/`.
10. Rollout sizes: median 0.4 MB, p95 5.6 MB, largest 1.2 GB. In the five largest under
    400 MB the last `turn_context` is within 400 KB of the end. In the 1.2 GB one it is
    1.2 GB from the end, after a single runaway turn.
11. relay's CLI starts in about 80 ms. Listing one day directory and matching the name
    takes under 1 ms.

## Decision

### The command

`relay model --harness codex`, declared in `src/commands.js`; `--harness` is the shared
`harness` option, restricted to `codex`. Claude Code needs no resolver, and OpenCode is
not assessed; both are refused as usage errors until a design adds them. It reads no
stdin, writes nothing, and takes no other options beyond the global `--json` and
`--pretty`. Pretty is the default.

The command answers one of two ways and always exits 0 when it answers:

- **Verified**: the running turn's model was read from this thread's rollout.
- **Unverified**: one of the conditions below holds, and the answer is the bare harness
  `codex`, with a reason. This is a defined result, not an error: the caller stamps
  the harness alone, which instruction-provenance T13 requires when the model is
  unknown. The reason is always printed, so the fallback is never silent.

`--json` prints one object on stdout:

```json
{"verified":true,"agent":"codex/gpt-6.1-sol","harness":"codex","model":"gpt-6.1-sol","effort":"high","thread":"01a1495c-749f-7900-a62b-7853183bbcad","rollout":"/home/u/.codex/sessions/2026/10/17/rollout-2026-10-17T06-15-58-01a1495c-749f-7900-a62b-7853183bbcad.jsonl","reason":null}
{"verified":false,"agent":"codex","harness":"codex","model":null,"effort":null,"thread":null,"rollout":null,"reason":"no-thread"}
```

`thread` and `rollout` are filled once they are known, so an unverified answer shows
how far resolution got. `effort` is `null` when the record carries none.

Pretty prints the `agent` value alone on stdout (`codex/gpt-6.1-sol`, or `codex`), so a
shell can use `$(relay model --harness codex)` directly. An unverified answer adds one
line on stderr: `relay: model unverified (<reason>): <detail>`.

A failure, meaning the inputs exist but are not what this design expects, exits 1 with
relay's usual envelope (`kind` `model_failed`); a usage error exits 2. A caller that
needs a stamp treats exit 1 like an unverified answer and reports the error. That is
the caller's decision; relay does not turn a failure into an answer.

### Resolution

In order; the first condition that holds decides.

1. `CODEX_THREAD_ID` unset or empty: unverified, `no-thread`. This covers every hook
   (fact 6) and every process outside Codex.
2. `CODEX_THREAD_ID` that is not a lowercase UUIDv7: failure, `INVALID_INPUT`.
3. Ancestry: walk the process chain from relay itself, nearest first, and find the
   nearest process that any adapter recognises as a harness: Claude Code's predicate,
   including its versioned `comm`; `codex`; `opencode`. If there is none, or it is not
   `codex`: unverified, `not-under-codex`. This catches what inherits the variable
   without running in the thread's tool call: a tmux server or `setsid` daemon once it
   is reparented, and another harness started from a Codex shell, whose own commands
   would otherwise borrow the Codex thread. An unreadable process table is a failure,
   `PROCESS_UNREADABLE`. The sandbox's pid-1 `codex` counts as a Codex ancestor
   (fact 8).
4. The store is `$CODEX_HOME`, else `$HOME/.codex`. A `CODEX_HOME` that is set but not
   absolute is a failure, `INVALID_CONFIG`.
5. Locate the rollout. First list the day directory named by the thread id's UUIDv7
   timestamp in local time (fact 9), and keep entries named
   `rollout-*-<thread>.jsonl`. If that directory holds no match or does not exist, list
   every `sessions/*/*/*/` directory and `archived_sessions/`. This scan costs about
   0.13 s on this store and covers a time-zone change since the thread started. The
   two passes are one lookup: the second runs only when the first finds nothing, and
   both apply the same match rule. No match: unverified, `no-rollout`, which covers an
   ephemeral session if it exports a thread id. More than one match in the pass that
   found any: unverified, `ambiguous-rollout`. Any filesystem error other than a
   missing directory is a failure, `IO_ERROR`.
6. The first line must be a `session_meta` record whose `payload.id` equals the thread
   id; otherwise failure, `INVALID_ROLLOUT`. A rollout that does not name its own
   thread first is a layout this design does not know.
7. Read backward from the end in 64 KiB blocks for the last `turn_context` record. A
   final line without a terminating newline is a write in progress and is skipped. Any
   other line in the scanned range that is not valid JSON is a failure,
   `INVALID_ROLLOUT`. A `turn_context` whose `payload.model` is not a non-empty string
   is also a failure, `INVALID_ROLLOUT`, as is a present `payload.effort` that is not a
   string.
8. If no `turn_context` appears in the last 64 MiB: unverified, `scan-limit`. If none
   appears in a smaller file: unverified, `no-turn-context`. The limit bounds a runaway
   turn (fact 10) at well under a second of reading; ordinary rollouts never reach it.
9. Otherwise verified: `agent` is `codex/<model>`.

`INVALID_ROLLOUT` is a new error code, added to `docs/api.md`'s list.

### Time budget

On this host the verified path takes about 100 ms (startup plus one directory listing
and a tail read), and the full scan adds about 0.13 s. A caller should allow 2 s and
treat a timeout like a failure. The plan's tests assert the work, not the wall clock:
the day-directory pass lists exactly one directory, and the backward scan reads at most
the limit.

### Where it lives

- `src/adapters/codex-model.js`: steps 1–9, with the environment, the ancestry walk,
  the clock zone and the filesystem passed in, so tests run against fixture stores.
  Rollout layout is Codex-private knowledge and belongs with the Codex adapter.
- `src/adapters/*.js`: each adapter exports its harness predicate (`isHarness`), which
  its own `resolveSessionPid` already builds inline. Step 3 combines them.
- `bin/relay.js`: one branch for `model`, writing the answer in either mode.
- `docs/api.md`: the command, its JSON, its reasons, and the call contract below.

## The questions the task left open

1. **Name and home**: `relay model --harness codex`, above. A tasks stamp pays one Node
   start (about 80 ms).
2. **Inherited `CODEX_THREAD_ID`**: step 3. A tmux server that is still a descendant of
   Codex passes the check while it lives, and its commands then read the thread's
   current model. That is the same answer the thread's own call would get, so the
   stamp is right even though the caller is not the turn.
3. **Locating the rollout**: the UUIDv7 day directory, then the full scan with
   `archived_sessions/`. `state_5.sqlite` is rejected: its schema is private,
   `node:sqlite` is still experimental at relay's Node 22 floor, and when it updates
   relative to a switch is unprobed. The app-server's `thread/read` is rejected because
   it needs a running app-server.
4. **Ephemeral sessions**: no rollout means `no-rollout`; acceptance confirms which
   reason an ephemeral session actually gets.
5. **`/new`, `/resume`, `/fork` and `/model` in the TUI**: the command reads whatever
   thread id the tool call carries. Fact 3 says Codex sets it per thread, so it follows
   the thread a TUI command switches to. Acceptance checks this live in a detached tmux
   session (no desktop). If it fails, the design returns for revision; it is not patched
   in the plan.
6. **Effort, and how a fallback reports itself**: `effort` is in the JSON and absent
   from pretty output. Every unverified answer carries a reason code, and pretty mode
   also writes its reason on stderr.

## Rejected

- **Requiring `CODEX_TOOL_CALL_ID`** to keep hooks out: hooks already lack the thread id
  (fact 6), and every process that inherits one inherits the other, so the variable
  adds no case step 1 and step 3 miss.
- **Checking that the nearest `codex` process holds the rollout open**
  (`/proc/<pid>/fd`): live TUI processes do, but the check is Linux-only, its
  readability inside the sandbox is unprobed, and the only case it adds is a hook of a
  Codex started inside another Codex's shell, which never calls this command.
- **Inferring the model afterward from session logs** (brief §4, alternative 2):
  `review:` notes would stay unverified text until a later pass, and the ids hold
  (fact 2).
- **tasks reading the rollout itself** (alternative 3): it would couple a Rust CLI to
  Codex's private layout, which relay already owns.
- **The config default as a fallback**: it can name a model the session is not running.

## Testing

Unit tests on `codex-model.js` against fixture `CODEX_HOME` trees built in temporary
directories, with injected environment, ancestry and time zone:

- one test for each reason and each failure code in "Resolution";
- the forked sub-agent layout, where the parent's `turn_context` comes before the
  child's own, resolves to the child's model;
- a rollout written without a final newline skips the partial record;
- a model switch between turns resolves to the later turn;
- the day-directory pass touches one directory, and the full scan runs only after a
  miss (a thread whose date differs between two time zones);
- `scan-limit` triggers on a file whose last `turn_context` lies before the limit;
- the combined harness predicate: a `claude` process nearer than `codex` gives
  `not-under-codex`, as does no harness at all.

CLI tests through `bin/relay.js` cover both output modes, the stderr line, exit codes 0,
1 and 2, `--harness claude-code` refused, and the new row in `test/cli-surface.test.js`'s
conformance check.

Live acceptance, recorded in `docs/notes/` and run from scratch directories:

- top-level `codex exec`: verified, matching `-m`;
- `exec resume -m <other>`: verified as the new model;
- a sub-agent spawned on a model other than its parent's: verified as its own model;
- the `workspace-local` sandbox: verified;
- a `setsid` process that outlives its tool call, and a command run inside a tmux server
  started from a tool call: `not-under-codex`;
- `codex exec --ephemeral`, if the flag exists: the reason it gets;
- TUI in a detached tmux session: `/model` switch, `/new`, `/resume` of a thread on
  another model, `/fork`: verified as the active thread's model each time.

## Rollout

1. ops: add the `model` row to `cli.toml` under `[cli.relay]`, landed on ops's default
   branch first. Then `vendored adopt cli.toml` here, committed with the parser change.
2. relay: implement and document; no hook or installer change, nothing live to switch.
3. tasks (`tasks-970049`): when `TASKS_AGENT` is exactly `codex`, call
   `relay model --harness codex --json` with a 2 s limit and stamp `agent`, plus `model`
   when `verified`. Its own design decides how it finds `relay` and reports a failure.
4. lore: the `review:` note instruction tells a Codex session to take its reviewer
   identity from `relay model --harness codex`. Filed as its own task under `hq-fce47e`.
