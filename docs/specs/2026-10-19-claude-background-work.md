# Claude Code background work

Status: approved by the user 2026-10-19 for implementation planning, after review rounds 1 (builder check: Stop refusal on a malformed list, observers read state from the row, measured type labels), 2 (optional reducer argument, exit-1 contract, idle-notice exceptions) and 3 (accept). Implemented 2026-10-19 by docs/plans/2026-10-19-claude-background-work.md.
Task: `relay-fe38b1`. Consumer: familiar `fam-6e8321`, spec
`docs/specs/2026-10-19-relay-consumer-design.md` §8 (accepted 2026-10-19), whose last
step pins the release this spec produces. Parent design: ops
`docs/specs/2026-09-16-relay-design.md` §4 (additive optional fields keep the schema).
Reference implementation: familiar `0a9e0d7` (2026-10-07), superseded by `82c5cc6` and
`82afe93` (2026-10-19, `fam-721108`).

## Problem

Claude Code's `Notification:idle_prompt` fires 60 s after a turn ends, whether or not the
turn left a shell or monitor running in the background (measured on Claude Code 2.1.292
and 2.1.302). An agent waiting on its own command is not waiting on the user, but relay's
Claude reducer is the identity, so the registry shows `needs-input` and every registry
consumer inherits it: familiar's cat, and any future notification.

A second error has the same cause. A turn that ends with a background subagent,
workflow, teammate or cloud session in flight has handed its work off, not finished it:
Claude Code re-invokes the session when that work completes, and the later `Stop` (with
nothing in flight) is the real end. Relay maps the first `Stop` to `done`, so a consumer
sees `done` at every background-agent launch and again at its end. Familiar fixed this
on 2026-10-19 (`fam-721108`): it played its done popup and pulse twice per delegation.

Familiar computes both rules itself today. Its consumer design (§8) moves the
reduction to relay, which owns state reduction under the parent design, and drops
familiar's copy. Familiar's observer cannot recompute it: the observer envelope carries
no raw payload, and the parent design forbids broadcasting one.

## Facts

Facts 1–3 and 5 were read from the Claude Code 2.1.302 bundle on 2026-10-19: the hook
input schema for `Stop` and `SubagentStop`, the function that builds the list, and its
type-label map. Fact 4 comes from familiar's live measurements (`0a9e0d7` on 2.1.292,
`fam-721108` and hq-d121c3 on 2.1.302).

1. `Stop` and `SubagentStop` payloads carry an optional `background_tasks`, described
   as "in-flight background work (running/pending + backgrounded) registered in this
   session… Empty array when nothing is in flight". No other hook input schema has it.
2. Each entry is `{ id, type, status, description }`, all strings, plus per-kind extras:
   `command` for a shell, `agent_type` for a subagent, `server` and `tool` for a monitor
   or MCP task, `name` for a workflow. `description` and `command` are free text capped at
   1000 characters, so they are payload content.
3. `type` is a label mapped from Claude Code's internal kind: `local_agent` → `subagent`,
   `local_workflow` → `workflow`, `in_process_teammate` → `teammate`,
   `remote_agent` → `cloud session`, `local_bash` → `shell`, `monitor_mcp` and
   `monitor_ws` → `monitor`, `mcp_task` → `MCP task`, and three housekeeping kinds
   (`dream`, `auto-mode scan`, `memory import`). An unmapped kind passes through under
   its raw name. The first four are the agent-type kinds Claude Code's own idle notice
   waits on.
4. Claude Code's idle notice waits on agent-type work: it does not send `idle_prompt`
   while a subagent, workflow, teammate or cloud session is in flight, except an idle
   teammate, a long-running cloud session or a paused task, which it skips. It does send
   the prompt while a shell or monitor runs. The payload carries none of the flags behind
   those exceptions.
5. Scheduled wakeups arrive in a separate field, `session_crons`.

## Design

### Parsing (Claude Code adapter)

The Claude Code adapter reads `background_tasks` from its `Stop` payload, the only
Claude Code event relay hooks that can carry it (fact 1). It reduces the list to counts
of in-flight work, and nothing else from the list leaves the adapter:

```ts
type Background = { agents: number; other: number };
```

- **Absent field:** no `background` on the event, meaning *not reported*, never *none in
  flight*.
- **Readable list:** an array whose every entry is an object with string `type` and
  string `status`. An entry counts when its `status` is `running` or `pending`. It counts
  toward `agents` when its `type` is `subagent`, `workflow`, `teammate` or
  `cloud session`, and toward `other` otherwise, including an unmapped raw kind. The
  list already holds only in-flight work, so the status filter matches familiar and
  costs nothing.
- **Unreadable field:** anything else (not an array, a non-object entry, a non-string
  `type` or `status`). The event carries `background: null`, meaning *reported but
  unreadable*.
- **`session_crons`** is not read. A cron may be a day away or recur forever; counting it
  would hold an idle session at `working`.

Codex and OpenCode events never carry `background`. The adapter contract gains an
optional `backgroundOf(data, nativeEvent)` beside `workerIdOf`. Only the Claude Code
adapter defines it, and it returns `undefined` for every event but `Stop`.

An unreadable field must neither stop the turn nor pass silently. A parse failure
inside `normalizeEvent` cannot be the route: `dispatch` answers it with a native
refusal wherever one exists, and Claude Code's `Stop` refuses. A shape change in a future
Claude Code would then block every turn end with a reason the model reads as an
instruction to continue, in a loop. So the event proceeds with `background: null`:
- guards and observers run as usual;
- the registry row drops its carried counts (below), so the state falls back to today's
  unreduced level;
- the hook adds the diagnostic
  `BACKGROUND_UNREADABLE: background_tasks is not a list of {type, status} entries` and
  exits 1, which Claude Code shows as a non-blocking hook error on every such turn
  until relay follows the new shape. A guard's refusal still wins: exit 2, and as for
  any refusal nothing is published and no observer runs.

This is a new meaning for exit 1. Today `docs/api.md` gives exit 1 on an event with a
refusal channel only when registry publication failed. After this change exit 1 also
follows a successful publication carrying `BACKGROUND_UNREADABLE`, so exit 1 no longer
implies the registry is unchanged. The exit-code table and the diagnostics list in
`docs/api.md` say so.

### Event

`Event` gains an optional `background?: Background | null`, present only on a Claude
Code `Stop` whose payload had the field. `validateEvent` accepts it only for
`harness: 'claude-code'` and `nativeEvent: 'Stop'`, and only as `null` or an object
whose `agents` and `other` are nonnegative safe integers; anything else is
`INVALID_SCHEMA`. As everywhere in relay's validators, unknown keys are ignored and the
constructed value holds only the two counts. Event stays schema 1.

Guards and observers receive it unchanged in their `event`: two counts or `null`, never
entry content.

Observers are matched on `event.kind`, which the reduction does not change: an
observer of `needs-input` still runs on every `idle_prompt`, and one of `turn-end` on
every `Stop`. The reduced state is in the registry row, which observers already read
(`registry.revision` in the envelope names the publication). `docs/api.md` says this
explicitly. Familiar's observer projects the whole snapshot (its consumer design §1), so
it needs nothing more.

### Agent and carry-forward

`Agent` gains an optional `background?: Background`, valid only on `claude-code` rows,
with the same shape check in `validateAgent`. Snapshot stays schema 2.

In `applyEvent`, for an event that sets a level:

| `event.background` | Row's `background` |
| --- | --- |
| absent | the previous row's, if any (carried forward) |
| an object | the event's |
| `null` | none: the key is dropped |

The row is written with `background` when it has one and without the key otherwise.
The event that reports the counts (`Stop`) is not the event that needs them (an
`idle_prompt` a minute later), so the last report carries forward across events that do
not report. An unreadable report clears rather than carries: a stale `other` count
carried across unreadable `Stop`s would turn every later `idle_prompt` into `idle`, and
the user would never see `needs-input`. A session's first row has no `background` until
a `Stop` reports one. `SessionEnd` removes the row, and the counts with it.

### Reduction

The adapter `reduceState` gains an optional third argument, `{ background }` (the row's
value after carry-forward). It defaults to `{}`, so the existing two-argument call
`adapterFor(harness).reduceState(level, previous)` keeps working and means *no counts*.
Claude Code's reducer becomes:

| Level | Condition | State |
| --- | --- | --- |
| `done` (`Stop`) | `background.agents > 0` | `working` |
| `needs-input` (`idle_prompt`) | `background.other > 0` | `idle` |
| any | otherwise | the level |

`idle` rather than `done` for the second rule: `done` would have decayed to idle by the
time the prompt fires, and no consumer should replay a turn end. The agent count is
ignored for `idle_prompt`. Claude Code withholds that prompt while agent-type work it
counts as active is in flight (fact 4), so when the prompt does come, either the carried
agent count is stale or the work is of a kind Claude Code itself judged idle. The count
cannot show active agent work either way, and the prompt wins.

Codex and OpenCode reducers ignore the argument. `StopFailure` (`error`),
`permission_prompt` (`needs-approval`) and every other level are unchanged whatever the
counts: an approval prompt waits on the user even while a shell runs.

### Compatibility

- **Readers.** Validators construct known fields and ignore unknown ones, so a v0.1.0
  reader accepts a v0.1.1 snapshot and drops `background`. tasks' Rust snapshot reader
  (`src/relay/snapshot.rs`) reads agent fields by name and ignores the rest
  (`relay-4a5559`); no tasks change is needed.
- **Mixed writers.** A v0.1.0 writer on the same host rewrites rows without
  `background`, so a carried count is lost and the next `idle_prompt` shows
  `needs-input`: today's behaviour, not a failure. Hooks installed by `relay install`
  run one relay, so this arises only while two relay versions both write.
- **Upgrade.** A session mid-wait when v0.1.1 lands has no carried counts until its next
  `Stop`, so one `idle_prompt` may still show `needs-input`. No migration.
- **Familiar.** Familiar's record names the same shape `background: { agents, other }`;
  its consumer spec §8 names an earlier `backgroundTasks` count and must follow this
  spec before familiar's pin bump.

### Release

Bump `package.json` to `0.1.1` and release `v0.1.1` by `docs/runbooks/release.md`,
recording it there. Pushing `main`, pushing the tag and the public portability check
are actions outside the repository and are confirmed with the user at that step.

## Out of scope

- **Claude Code `SubagentStop`.** Relay does not hook it for Claude Code, and neither
  does familiar. Adding it is a new event mapping with its own state semantics (it ends
  a subagent, not the session's turn).
- **A stopped background agent.** If a user stops an in-flight agent and Claude Code
  does not re-invoke the session, the row stays `working` until the next event. Familiar
  accepts the same residual; the payload carries nothing that would show it.
- **The flags Claude Code's own idle check reads** (an idle teammate, a long-running
  cloud session, a paused task). The payload does not carry them, so such work holds a
  `Stop` at `working` while Claude Code still sends its idle notice.
- **Codex background work.** Unmeasured.

## Verification

- Adapter unit tests: absent field; empty list; a running subagent; a pending workflow;
  a teammate and a cloud session; a shell only; a monitor only; a completed entry; an
  unmapped raw kind; agent plus shell; the field on an event other than `Stop` is not
  read; unreadable: a non-array, a non-object entry, an entry without string `type` or
  `status` (each yields `null`); entry text never appears in the event.
- Reducer tests: the two-argument call is the identity for every level; identity for
  every level with no counts and with zero counts;
  `done` with agents is `working`; `needs-input` with other is `idle`; `needs-input`
  with only agents is `needs-input`; every other level unchanged with counts.
- Validator tests: `background` accepted as counts or `null` on Claude Code `Stop`
  events and as counts on Claude Code rows; refused on Codex and OpenCode, on other
  Claude Code events, as `null` on a row, and when the counts are not nonnegative safe
  integers.
- Transaction tests, ported from familiar: a shell `Stop` then `idle_prompt` is `idle`;
  a later `Stop` with nothing in flight then `idle_prompt` is `needs-input`; an event
  without the field carries the counts forward; an agent `Stop` is `working`; agent and
  shell, then shell only, then `idle_prompt`: `working`, `done`, `idle`; an agent-only
  `Stop` then `idle_prompt` is `needs-input`; a shell `Stop` then an unreadable `Stop`
  then `idle_prompt` is `needs-input` with no `background` on the row.
- Dispatch tests: an observer's envelope carries `event.background`; an unreadable
  `Stop` with no subscribers publishes, prints `BACKGROUND_UNREADABLE` and exits 1 with
  no refusal; with a refusing guard it still exits 2.
- `docs/api.md` documents the fields, the parsing rule, the reduction, the new exit-1
  case and `BACKGROUND_UNREADABLE`; the `Adapter` typedef marks the third argument optional.
- `just gate` on the development runtime and the Node 22 floor; the release runbook's
  rehearsal and portability checks.
