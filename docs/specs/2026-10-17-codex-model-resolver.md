# Codex model resolver

Status: approved 2026-10-17 for implementation planning, after review rounds 1 (turn
binding, pid 1, explicit `--pretty`), 2 (conservative boundary, clock requirement), 3
(bracketed sampling) and 4 (accept); amended at plan review (the rollout reader's own
module, and a `null` effort).
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
   its ancestry ends at pid 1, whose `comm` is `codex`. relay's ancestry walk
   (`walk` in `src/bus/proc.js`, documented at `docs/api.md` "stopping before PID 1")
   never returns pid 1, so it cannot see that process.
9. Every one of 16,392 rollouts lives in `sessions/YYYY/MM/DD/`, where the date is the
   local date of its thread id's UUIDv7 timestamp. This is an observed layout, not a
   documented contract. Archived rollouts sit flat in `archived_sessions/`.
10. Rollout sizes: median 0.4 MB, p95 5.6 MB, largest 1.2 GB. In the five largest under
    400 MB the last `turn_context` is within 400 KB of the end. In the 1.2 GB one it is
    1.2 GB from the end, after a single runaway turn.
11. relay's CLI starts in about 80 ms. Listing one day directory and matching the name
    takes under 1 ms.

Probed on 0.163.0 in the TUI (2026-10-17, `--dangerously-bypass-approvals-and-sandbox`,
driven in a detached tmux session through two turns):

12. Tool commands are direct children of the `codex` process.
13. A command Codex keeps running as a background terminal (`exec_command` with a
    one-second yield) stayed a direct child of `codex` into the next turn, carrying
    turn 1's `CODEX_THREAD_ID` and `CODEX_TOOL_CALL_ID`. Its call id never appeared in
    the rollout, before or after the next turn's `turn_context`. Without a further
    rule, a command run from it in turn 2 would read turn 2's model, and a model
    switch between the turns would make that answer wrong.
14. A `setsid nohup … &` process was reparented at once to the user's systemd manager,
    so it has no `codex` ancestor.
15. The turn's `turn_context` was stamped 7.5 s before the turn's first command started
    (11:22:26.4 against 11:22:33.6), and the next turn's 32 s after it.

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
shell can use `$(relay model --harness codex --pretty)` directly. A caller that captures
the output always names its mode: `RELAY_FORMAT=json` changes the default. An unverified answer adds one
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
   is reparented (fact 14), and another harness started from a Codex shell, whose own
   commands would otherwise borrow the Codex thread. An unreadable process table is a
   failure, `PROCESS_UNREADABLE`.
   The chain includes pid 1. relay's shared walk stops before pid 1 and keeps doing so,
   since the registry's handles depend on it. When the walk's last row has parent 1,
   the resolver reads pid 1's record through the same process helper and appends it.
   In the host namespace that row is init, which no predicate matches. In the sandbox
   it is the `codex` the command runs under (fact 8).
   The chain row just below the Codex process is the **call process**: the process
   Codex started for this tool call (fact 12), or an ancestor of the caller that
   Codex started. Step 9 uses its start time.
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
   is also a failure, `INVALID_ROLLOUT`. A `payload.effort` that is absent or `null`
   means the record carries none (`effort: null`); any other value that is not a string
   is `INVALID_ROLLOUT`.
8. If no `turn_context` appears in the last 64 MiB: unverified, `scan-limit`. If none
   appears in a smaller file: unverified, `no-turn-context`. The limit bounds a runaway
   turn (fact 10) at well under a second of reading; ordinary rollouts never reach it.
9. Turn binding. The model is verified only when the call process provably started in
   the latest turn. Let `t` be the `timestamp` of the `turn_context` found in step 7.
   The process helper gives the call process's start as an interval `[lo, hi]` in
   wall-clock milliseconds (below). With the clock allowance `m` = 1000 ms:
   - `lo − m ≥ t`: the process started after the turn's record. Go to step 10.
   - `hi + m < t`: the process started before the turn's record, so it belongs to an
     earlier turn, such as a background terminal (fact 13) or a server a tool call left
     running. The command cannot tell which turn that was or what that turn ran, so the
     answer is unverified, `earlier-turn`.
   - Otherwise the interval meets the boundary and the order is unknown: unverified,
     `turn-boundary`.

   A `timestamp` that is not an ISO 8601 UTC instant is a failure, `INVALID_ROLLOUT`.
10. Otherwise verified: `agent` is `codex/<model>`.

The lifetime this gives a caller: it is verified once its call process starts more than
`m` plus the start-time uncertainty after its turn's record. It is refused from the
moment the thread's next `turn_context` is written. No minimum gap between turns is
assumed: a process from the previous turn, however close to the new record, is refused
as `earlier-turn` or `turn-boundary`, never verified. What it costs: a current caller
whose call process starts within about a second of its turn's record is refused as
`turn-boundary`. The probed first command started 7.5 s after its record (fact 15),
because the model has to reply before any command runs, so such refusals should be
rare. Acceptance reports how often they happen. If a turn wrote a second
`turn_context` partway through, for example when a message is sent mid-turn, its
earlier calls would be refused the same way: a refusal, never a wrong model.
Acceptance checks that case.

**Start-time interval.** The process helper gains one accessor,
`startedAtMs(row) → {lo, hi}`:

- Linux: the kernel records a process's start only on the boot clock, as a tick count
  (`starttime`, `USER_HZ` = 100 in the Linux ABI; `getconf CLK_TCK` prints 100 here).
  The accessor brackets one boot-clock sample between two wall-clock samples: `w0 =
  Date.now()`, then `u` = the first field of `/proc/uptime` in seconds, then `w1 =
  Date.now()`. The uptime sample was taken at some wall instant in `[w0, w1]`,
  however long the process was descheduled between the reads. With `T = starttime /
  100`, the process's age at that instant lies within 10 ms of `(u − T) × 1000`: both
  values are truncated to 10 ms. Allowing 1 ms for `Date.now()` resolution gives
  `lo = w0 − (u − T) × 1000 − 11` and `hi = w1 − (u − T) × 1000 + 11`. A pause between
  the reads widens the interval by its length instead of shifting it. With a stable
  clock the interval contains the true start; under the clock requirement, where the
  wall clock may have moved by up to `m`, it is `[lo − m, hi + m]` that is guaranteed
  to contain it, which is the allowance the decision rule applies. The width only
  makes refusals more likely. Until now relay only compared tick counts, so this is the
  first place it converts them.
- Darwin: `lstart` is the wall-clock start the kernel recorded, truncated to the
  second, so `lo = lstart × 1000` and `hi = lo + 999`.

**Clock requirement.** The rule compares a wall-clock record (`t`) with a start time the
kernel keeps on another footing, so a step of the wall clock can reorder them:

- Linux reconstructs the start through the boot clock at the time of the command. A
  forward step between `t` and the command moves the estimate later by the full step,
  because `now` moves and the boot clock does not. A leftover process can then look
  current. A backward step only makes processes look earlier, so it only refuses.
- Darwin records the start on the wall clock when the process starts. A backward step
  between that start and `t` makes `t` look closer to the start, or before it, so a
  leftover process can look current. A forward step there only refuses. A step after
  `t` changes neither value.

So the requirement is: **between the call process's start and the command, the wall
clock moves by less than `m` relative to the boot clock.** NTP slewing and the
resynchronisation after a suspend (the boot clock counts suspended time) stay well
within that. A larger step in the harmful direction (forward on Linux, backward on
Darwin) breaks the guarantee once it exceeds `m` plus the leftover's lead over the
latest record. Examples are setting the clock by hand, or an NTP daemon stepping a
large offset. No kernel interface records past steps, so the command cannot detect
one. This is a stated limit, documented in `docs/api.md`, and not claimed to be handled.

`INVALID_ROLLOUT` is a new error code, added to `docs/api.md`'s list.

### Time budget

On this host the verified path takes about 100 ms (startup plus one directory listing
and a tail read), and the full scan adds about 0.13 s. A caller should allow 2 s and
treat a timeout like a failure. The plan's tests assert the work, not the wall clock:
the day-directory pass lists exactly one directory, and the backward scan reads at most
the limit.

### Where it lives

- `src/adapters/codex-rollout.js`: Codex's private rollout layout, steps 4–8 (the store,
  locating the rollout, its first record, the backward scan for the last
  `turn_context`, and that record's fields). Rollout layout is Codex-private knowledge
  and belongs with the Codex adapter. Both readers assemble each record once from its
  blocks, so a record of many blocks costs one pass, not a copy per block.
- `src/adapters/codex-model.js`: the decision, steps 1–3 and 9–10, calling the rollout
  reader for 4–8. The environment, the process helper, the time zone and the filesystem
  are passed in, so tests run against fixture stores.
- `src/adapters/*.js`: each adapter exports its harness predicate (`isHarness`), which
  its own `resolveSessionPid` already builds inline. Step 3 combines them.
- `src/bus/proc.js`: `startedAtMs(row)` (step 9). `walk` and `ancestors` keep their
  contract; the pid-1 lookup lives in the resolver, through the existing `recordOf`.
- `bin/relay.js`: one branch for `model`, writing the answer in either mode.
- `docs/api.md`: the command, its JSON, its reasons, and the call contract below.

## The questions the task left open

1. **Name and home**: `relay model --harness codex`, above. A tasks stamp pays one Node
   start (about 80 ms).
2. **Inherited `CODEX_THREAD_ID`**: step 3 refuses what is no longer under Codex, and
   step 9 refuses what Codex still holds but started in an earlier turn: a background
   terminal, or a tmux server started by a tool call and still its descendant. Such a
   caller is verified during the turn that started it and refused afterward.
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
  adds no case that steps 1, 3 and 9 miss.
- **Binding a caller to its turn through its tool call's record**: the running call is
  not in the rollout yet (fact 7), and a background terminal's call never appears there
  at all (fact 13). So "the call has no completion record" cannot tell a current
  caller from one left over from an earlier turn.
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
  `not-under-codex`, as does no harness at all;
- turn binding: an interval wholly more than `m` after `t` is verified; wholly more than
  `m` before is `earlier-turn`; one meeting the boundary from either side is
  `turn-boundary`, including a Darwin start in the same second as `t` and a Linux
  start 500 ms before `t`;
- sampling delay: with injected clocks, a pause of 1.2 s between `w0` and the uptime
  read, or between it and `w1`, leaves the interval containing the true start, and a
  process started 100 ms before `t` gets `turn-boundary`, not verified;
- clock steps, injected as an offset between the wall clock and the boot clock: a step
  under `m` in either direction never verifies a leftover process; a current process
  is verified exactly when its shifted interval still satisfies `lo − m ≥ t`, and is
  otherwise refused as `turn-boundary`, which is a correct conservative result (for
  example, a Linux process started 1.2 s after `t`, then a 900 ms backward step); a
  step of any size in the harmless direction (backward on Linux, forward on Darwin)
  never verifies a leftover; one test per platform pins the stated limit, where a
  harmful step larger than `m` plus the leftover's lead verifies it, so a change to the
  limit is deliberate;
- the pid-1 append: a chain whose last row has parent 1 gains pid 1's record, and a
  chain ending elsewhere does not;
- `startedAtMs` intervals on Linux, from fixture `/proc/uptime`, stat text and clock, and
  on Darwin from `lstart`.

One test uses the real process helper: on Linux it starts, under
`unshare --user --map-root-user --pid --fork --mount-proc`, an executable named `codex`
that runs `bin/relay.js model --harness codex --json` against a fixture store. It must
answer verified, which proves the production pid-1 lookup and start-time path, not only
fixtures. The test is Linux-only; where `unshare` cannot create the namespace it fails
with that reason rather than skipping.

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
  another model, `/fork`: verified as the active thread's model each time;
- TUI, the case of fact 13: a background terminal started in one turn answers verified
  in that turn and `earlier-turn` after the next turn begins, with a `/model` switch
  between them;
- TUI, a message sent while a tool call runs: whether it writes a second
  `turn_context`, and the answer the running call then gets.

## Rollout

1. ops: add the `model` row to `cli.toml` under `[cli.relay]`, landed on ops's default
   branch first. Then `vendored adopt cli.toml` here, committed with the parser change.
2. relay: implement and document; no hook or installer change, nothing live to switch.
3. tasks (`tasks-970049`): when `TASKS_AGENT` is exactly `codex`, call
   `relay model --harness codex --json` with a 2 s limit and stamp `agent`, plus `model`
   when `verified`. Its own design decides how it finds `relay` and reports a failure.
4. lore: the `review:` note instruction tells a Codex session to take its reviewer
   identity from `relay model --harness codex --pretty`. Filed as `lore-f71994`, a
   dependency of `hq-fce47e`.
