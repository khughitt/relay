# relay model — live Codex acceptance

Run 2026-10-17 for `relay-2cd4b1` (plan `docs/plans/2026-10-17-codex-model-resolver.md`,
Task 8; spec `docs/specs/2026-10-17-codex-model-resolver.md`, "Testing"). Codex
`codex-cli 0.163.0`; relay at `b67aebb` (branch `feat/codex-model-resolver`), run by
explicit path through `tools/codex-model-acceptance/run`. Every Codex ran in a
`mktemp -d` scratch directory (the first run's resume tool call excepted, finding 2);
the TUI ran in the output directory's own detached tmux server and was stopped with
`run tui <outdir> stop`.

`<RELAY>` below is `node <worktree>/bin/relay.js model --harness codex --json`. In the
observed JSON the home directory is written `~`; nothing else is edited.

**Result: every expectation holds.** The first exec run failed one case (`setsid`)
because of the script's timing, not the resolver; the script was corrected and the exec
set rerun once (finding 1). The exec table below is the rerun's; the TUI cases ran once
and their results stand.

## Exec cases (`run exec <outdir>`, rerun)

| Case | Expected | Observed |
| --- | --- | --- |
| `top` (`exec -m gpt-6-luna`) | verified `codex/gpt-6-luna` | verified `codex/gpt-6-luna` — PASS |
| `resumed` (`exec resume <thread> -m gpt-6-astra`, from the scratch directory) | verified `codex/gpt-6-astra`, thread of `top` | verified `codex/gpt-6-astra`, same thread `01a14a77-46a5-…` — PASS |
| `child` (sub-agent on `gpt-6-astra`) | verified `codex/gpt-6-astra`, thread other than `parent` | verified `codex/gpt-6-astra`, thread `01a14a78-7a34-…` — PASS |
| `parent` (`exec -m gpt-6-luna`) | verified `codex/gpt-6-luna` | verified `codex/gpt-6-luna`, thread `01a14a78-3c60-…` — PASS |
| `sandbox` (no bypass flag) | verified; profile is the sandboxed one | verified `codex/gpt-6-luna`; `CODEX_PERMISSION_PROFILE` = `workspace-local` — PASS |
| `setsid` (`setsid nohup sh -c 'sleep 9; <RELAY> …' &`, then a second call `sleep 8`) | `not-under-codex` | `not-under-codex` — PASS |
| `tmux` (command in a tmux server started by the call) | `not-under-codex` | `not-under-codex` — PASS |
| `ephemeral` (`exec --ephemeral`) | record the reason | `no-rollout` (the spec's prediction) |

Observed JSON:

```text
top.json       {"verified":true,"agent":"codex/gpt-6-luna","harness":"codex","model":"gpt-6-luna","effort":"high","thread":"01a14a77-46a5-7891-9898-65899f162334","rollout":"~/.codex/sessions/2026/10/17/rollout-2026-10-17T11-24-53-01a14a77-46a5-7891-9898-65899f162334.jsonl","reason":null}
resumed.json   {"verified":true,"agent":"codex/gpt-6-astra","harness":"codex","model":"gpt-6-astra","effort":"high","thread":"01a14a77-46a5-7891-9898-65899f162334","rollout":"~/.codex/sessions/2026/10/17/rollout-2026-10-17T11-24-53-01a14a77-46a5-7891-9898-65899f162334.jsonl","reason":null}
child.json     {"verified":true,"agent":"codex/gpt-6-astra","harness":"codex","model":"gpt-6-astra","effort":"medium","thread":"01a14a78-7a34-7451-9b0e-cd29ebe9049e","rollout":"~/.codex/sessions/2026/10/17/rollout-2026-10-17T11-26-12-01a14a78-7a34-7451-9b0e-cd29ebe9049e.jsonl","reason":null}
parent.json    {"verified":true,"agent":"codex/gpt-6-luna","harness":"codex","model":"gpt-6-luna","effort":"high","thread":"01a14a78-3c60-7313-aee6-87e4cc5200f3","rollout":"~/.codex/sessions/2026/10/17/rollout-2026-10-17T11-25-56-01a14a78-3c60-7313-aee6-87e4cc5200f3.jsonl","reason":null}
sandbox.json   {"verified":true,"agent":"codex/gpt-6-luna","harness":"codex","model":"gpt-6-luna","effort":"high","thread":"01a14a79-16fa-7813-ac64-77baf0f4139b","rollout":"~/.codex/sessions/2026/10/17/rollout-2026-10-17T11-26-52-01a14a79-16fa-7813-ac64-77baf0f4139b.jsonl","reason":null}
setsid.json    {"verified":false,"agent":"codex","harness":"codex","model":null,"effort":null,"thread":"01a14a79-94cc-7f50-9524-1e5aba5df2f9","rollout":null,"reason":"not-under-codex"}
tmux.json      {"verified":false,"agent":"codex","harness":"codex","model":null,"effort":null,"thread":"01a14a7a-2a7a-7661-b60f-81ac2261a91a","rollout":null,"reason":"not-under-codex"}
ephemeral.json {"verified":false,"agent":"codex","harness":"codex","model":null,"effort":null,"thread":"01a14a7a-c310-7cd3-858c-a6da0ea7fb5f","rollout":null,"reason":"no-rollout"}
```

In the rerun's `setsid` session the first tool call (the `setsid … &` line) returned at
`15:27:36.963Z`, the second (`sleep 8`) ran from `15:27:39.564Z` to `15:27:47.803Z`, and
`setsid.json` was written at `15:27:46.03Z`: after its own call had ended, while Codex
was still running the turn.

## TUI cases (`run tui <outdir> start|say|keys|pane|stop`)

One TUI process, started on `gpt-6-luna`. `/model` switches used the picker's
"s session" choice (session only; the config file was not changed), which sets
`gpt-6-astra` at effort `medium`.

| Step | Action | Expected | Observed |
| --- | --- | --- | --- |
| 1 | `<RELAY> > tui-1.json` | luna | verified `codex/gpt-6-luna`, thread `01a14a6c-bfdb-…` — PASS |
| 2 | `/model` → GPT-6-Astra, then step 1 → `tui-2.json` | astra | verified `codex/gpt-6-astra`, same thread — PASS |
| 3 | `/new` (footer back to GPT-6-Luna), step 1 → `tui-new.json` | verified, new thread, its model | verified `codex/gpt-6-luna`, new thread `01a14a6e-2e5f-…` — PASS |
| 4 | `/resume`, picked the first thread (`01a14a6c-bfdb-…`, last turn on astra), step 1 → `tui-resume.json` | verified, that thread, active model | verified `codex/gpt-6-luna`, thread `01a14a6c-bfdb-…` — PASS |
| 5 | `/fork`, step 1 → `tui-fork.json` | verified, the fork's thread | verified `codex/gpt-6-luna`, new thread `01a14a6f-d981-…` — PASS |

On step 4 the TUI resumed on the session's model, luna, and warned "This session was
recorded with model `gpt-6-astra` but is resuming with `gpt-6-luna`". The resumed thread
therefore already ran on a model other than its rollout's latest turn, so no further
`/model` switch was made: the answer had to be luna (the active model), not astra (the
stale latest record), and it was. Question 5 of the spec holds: the thread id followed
`/new`, `/resume` and `/fork`, and the model followed `/model`.

```text
tui-1.json      {"verified":true,"agent":"codex/gpt-6-luna","harness":"codex","model":"gpt-6-luna","effort":"high","thread":"01a14a6c-bfdb-7f02-96ec-d3904d8b42a4","rollout":"~/.codex/sessions/2026/10/17/rollout-2026-10-17T11-13-23-01a14a6c-bfdb-7f02-96ec-d3904d8b42a4.jsonl","reason":null}
tui-2.json      {"verified":true,"agent":"codex/gpt-6-astra","harness":"codex","model":"gpt-6-astra","effort":"medium","thread":"01a14a6c-bfdb-7f02-96ec-d3904d8b42a4","rollout":"~/.codex/sessions/2026/10/17/rollout-2026-10-17T11-13-23-01a14a6c-bfdb-7f02-96ec-d3904d8b42a4.jsonl","reason":null}
tui-new.json    {"verified":true,"agent":"codex/gpt-6-luna","harness":"codex","model":"gpt-6-luna","effort":"high","thread":"01a14a6e-2e5f-71a3-aef1-bd9ed4feba85","rollout":"~/.codex/sessions/2026/10/17/rollout-2026-10-17T11-14-57-01a14a6e-2e5f-71a3-aef1-bd9ed4feba85.jsonl","reason":null}
tui-resume.json {"verified":true,"agent":"codex/gpt-6-luna","harness":"codex","model":"gpt-6-luna","effort":"high","thread":"01a14a6c-bfdb-7f02-96ec-d3904d8b42a4","rollout":"~/.codex/sessions/2026/10/17/rollout-2026-10-17T11-13-23-01a14a6c-bfdb-7f02-96ec-d3904d8b42a4.jsonl","reason":null}
tui-fork.json   {"verified":true,"agent":"codex/gpt-6-luna","harness":"codex","model":"gpt-6-luna","effort":"high","thread":"01a14a6f-d981-7700-b4b6-fda1038fe517","rollout":"~/.codex/sessions/2026/10/17/rollout-2026-10-17T11-16-46-01a14a6f-d981-7700-b4b6-fda1038fe517.jsonl","reason":null}
```

### Step 6: background terminal (fact 13)

Turn A (on the fork thread, luna) started
`sh -c 'for i in 1 … 10; do <RELAY> > bg-$i.json; sleep 3; done'` with `exec_command`
and a one-second yield and replied at once; then `/model` → astra (11:18:08–11:18:13
local) and `Reply OK.` (turn B). Rollout `turn_context` records (UTC; local is UTC−4):
turn A `15:17:46.645Z` luna, turn B `15:18:14.872Z` astra.

| File | Written (local) | Observed |
| --- | --- | --- |
| `bg-1` … `bg-5` | 11:17:53.0 – 11:18:05.5 | verified `codex/gpt-6-luna` (turn A running) |
| `bg-6`, `bg-7` | 11:18:08.6, 11:18:11.7 | verified `codex/gpt-6-luna` (after the `/model` switch, before turn B's record; turn A is still the latest turn, and its model is luna) |
| `bg-8` | 11:18:14.858 | verified `codex/gpt-6-luna` (14 ms before turn B's record) |
| `bg-9`, `bg-10` | 11:18:17.98, 11:18:21.1 | `earlier-turn` |

Expected: verified while turn A runs, then `earlier-turn` or `turn-boundary` after turn
B's record, never verified with turn B's model. PASS: no `bg-*` answered astra.

### Step 7: a message sent while a tool call runs

Prompt `sleep 20; <RELAY> > mid.json`, then `Also note this.` 5 s later. The message was
injected into the running turn (it appears as a user `message` response item at
`15:19:10.400Z`, and the model answered "Noted. The command is still running") and did
**not** write a second `turn_context`: the rollout holds four `turn_context` records
(the fork's first turn, turn A, turn B and this turn, `15:19:04.355Z`), one per turn.
The running call, which ran `relay model` at 11:19:32 local, 22 s after the message,
answered:

```text
mid.json {"verified":true,"agent":"codex/gpt-6-astra","harness":"codex","model":"gpt-6-astra","effort":"medium","thread":"01a14a6f-d981-7700-b4b6-fda1038fe517","rollout":"~/.codex/sessions/2026/10/17/rollout-2026-10-17T11-16-46-01a14a6f-d981-7700-b4b6-fda1038fe517.jsonl","reason":null}
```

So a steering message neither starts a turn nor disturbs the turn binding.

## `turn-boundary` on current calls

None, 0 of 20. Every current call of the first run (6 exec, counting that run's
`setsid`, 5 TUI, `mid`, and `bg-1`…`bg-8` as current-turn callers) was verified, as were
the 5 current calls of the exec rerun; the only refusals were the two expected
`earlier-turn` answers, `no-rollout`, and `not-under-codex`. In the TUI the first
command of a turn starts several seconds after its `turn_context` (fact 15), well past
the 1000 ms allowance.

## Findings

1. **The first run's `setsid` case failed on its timing; `setsid` does not detach a job
   from the tool shell under `zsh -lc`.** The plan's case ran
   `setsid nohup sh -c 'sleep 2; <RELAY> …' & sleep 6`, so `relay model` ran 2 s into a
   6 s tool call and answered verified `codex/gpt-6-astra` (expected `not-under-codex`):

   ```text
   setsid.json (first run) {"verified":true,"agent":"codex/gpt-6-astra","harness":"codex","model":"gpt-6-astra","effort":"high","thread":"01a14a6e-29b6-76b2-9991-3007ad308a7a","rollout":"~/.codex/sessions/2026/10/17/rollout-2026-10-17T11-14-56-01a14a6e-29b6-76b2-9991-3007ad308a7a.jsonl","reason":null}
   ```

   That session ran on the configured default, `gpt-6-astra`, and its rollout's only
   `turn_context` names it, so the answer was the right model for its turn. One
   diagnostic exec (same shape, ancestry recorded when `relay model` ran) showed why:
   under `zsh -lc` a background job is not a process-group leader, so `setsid` calls
   `setsid()` in place without forking, and the job stays a child of the tool shell
   (which zsh had `exec`ed into `sleep 6`), itself a child of `codex`, for as long as the
   call lasts:

   ```text
   early (2 s, during the call):  sh(sid=self) <- sleep [was zsh -lc] <- codex <- …   → verified codex/gpt-6-astra
   late  (9 s, after the call's shell exited, while codex ran a second `sleep 8` call):
                                  sh(sid=self) <- systemd --user                     → not-under-codex
   ```

   This qualifies the spec's fact 14: a job started with `setsid … &` is reparented to
   the user's systemd manager only once its tool shell exits; until then it is still a
   descendant of `codex` and, being in the current turn, correctly verified. The
   resolution rules and the spec's Testing bullet ("a `setsid` process that outlives
   its tool call") stand; the case was a defect in the plan's script.
2. **Two changes to the plan's script.** (a) The `setsid` case now starts the job with
   `sleep 9` before `<RELAY>`, returns from that tool call at once, and has Codex make a
   second call, `sleep 8`, so `relay model` runs after its own call's shell has exited
   while the exec is still alive; the rerun answered `not-under-codex`. (b)
   `codex exec resume` has no `-C`, so in the first run the resume step's tool call ran
   in the directory the script was started from (the main relay checkout; it wrote only
   to the absolute scratch path and left the checkout clean). The step now runs as
   `(cd "$W" && codex exec resume …)`, and in the rerun its tool call ran in the
   scratch directory.
3. A sub-agent spawned on `gpt-6-astra` ran at effort `medium` where its parent ran at
   `high`; `relay model` reported each turn's own effort.
4. In the TUI, `/new` reset the model to the configured one, discarding a
   session-only `/model` switch, and `/resume` resumed on the session's current model
   with a warning rather than the thread's recorded one. In both cases `relay model`
   followed the active thread and its new turn's record.
