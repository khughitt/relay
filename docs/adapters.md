# Harness Adapters, Hook Dispatch, and Model Resolution

Type: data model, protocol; document types 1.

`relay` normalizes native hook payloads from Claude Code, Codex, OpenCode, and `agy` into a schema-1 transient `Event`, resolves the owning session process handle from the OS process tree, dispatches guards and observers within a bounded budget (`relay hook`), and resolves verified Codex turn models from rollout logs (`relay model --harness codex`). See [api.md](api.md) for package exports and [registry.md](registry.md) for `$STATE/agents.json` publication rules.

## Transient event contract

```ts
type EventKind = 'session-start' | 'prompt' | 'before-tool' | 'activity' | 'idle'
  | 'needs-input' | 'needs-approval' | 'turn-end' | 'turn-error' | 'session-end';
type Event = {
  schema: 1;
  kind: EventKind;
  harness: Agent['harness'];
  nativeEvent: string;
  agentId: string;
  sessionId: string;
  root?: string;         // Codex worker events only
  cwd: string;
  stopHookActive?: boolean;
  background?: { agents: number; other: number } | null; // Claude Code Stop only; null: reported but unreadable
  tool: null | { name: string; input: Record<string, unknown>; command: string | null };
};
```

All fields on `Event` are required except `stopHookActive`, `root` (present only on Codex worker events), and `background` (present only on Claude Code `Stop` events when `background_tasks` is present; `null` when present but unreadable). Native input (`normalizeEvent` in `src/protocol.js`) must supply a nonempty `session_id`, an absolute `cwd`, and an optional boolean `stop_hook_active`. A supplied `hook_event_name` must match the `nativeEvent` argument (`Notification` subtypes match base `Notification`). `PreToolUse` requires a nonempty `tool_name` and object `tool_input`; other events carry `tool: null`. Only canonical `Bash` with a string `command` extracts shell source into `tool.command` for Claude Code and Codex (`apply_patch.command` is patch text and yields `command: null`; `agy` translates `run_command` as described below).

## Session process handle and ancestry

Process inspection (`src/bus/proc.js` and `src/adapters/ancestry.js`) separates the session process from the terminal that displays it:

- `recordOf(pid)` returns `null` only for confirmed process absence and throws coded errors (`PROCESS_UNREADABLE`, `PROCESS_UNAVAILABLE`) for unreadable or malformed evidence.
- `ancestors(pid)` reads a fresh nearest-first chain including `pid` at index `0`, stopping before PID `1`, on process absence, or with a cycle error. Darwin takes one fresh `ps` table per walk; target probes read only the requested PID.
- `resolveSessionPid` takes the nearest ancestor after index `0` that is a process of the harness (`codex`, `opencode`, `agy`, or for Claude Code `comm === 'claude'` or a version-shaped `comm` whose executable ends in `/claude/versions/<comm>`), with no terminal requirement. It returns `null` when there is none or when the nearest Claude Code process has `argv[1]` equal to `'daemon'` or `'bg-pty-host'`.
- `resolveTerminalPid` takes the nearest ancestor after index `0` that owns a terminal (`tty !== null`) and whose `comm` is the harness name; for Claude Code, a version-binary process that owns a terminal also qualifies unless its parent has `argv[1]` equal to `'daemon'` or `'bg-pty-host'` (a background session whose terminal belongs to its host).
- `executableOf` is read only for a version-shaped `comm`, and `argvOf` only for the nearest Claude Code process and, in the terminal walk, the parent of a version-binary process that owns a terminal; an unreadable one throws `PROCESS_UNREADABLE`.
- A hook PID or shell session ID is never substituted for a missing harness process. The shared cross-harness ancestry test corpus is exported at `relay/fixtures/ancestry.json`.

## Event mappings

| Harness | Native event | Kind | Level | Refuse | Context |
| --- | --- | --- | --- | --- | --- |
| Claude, Codex, agy | `SessionStart` | `session-start` | `idle` | no | no |
| Claude, Codex | `UserPromptSubmit` | `prompt` | `working` | yes | yes |
| Claude, Codex | `PreToolUse` | `before-tool` | `working` | yes | yes |
| agy | `PreToolUse` | `before-tool` | `working` | yes | no |
| Claude | `Notification:idle_prompt` | `needs-input` | `needs-input` | no | no |
| Claude | `Notification:permission_prompt` | `needs-approval` | `needs-approval` | no | no |
| Claude | `StopFailure` | `turn-error` | `error` | no | no |
| Codex | `PermissionRequest` | `needs-approval` | `needs-approval` | no | no |
| Codex | `SubagentStart` | `session-start` | `working` | no | no |
| Claude, Codex, agy | `Stop` | `turn-end` | `done` | Claude, Codex: yes; agy: no | no |
| Codex | `SubagentStop` | `turn-end` | `done` | yes | no |
| Claude, Codex | `SessionEnd` | `session-end` | remove | no | no |
| OpenCode | `init` | `session-start` | `idle` | no | no |
| OpenCode | `session.busy` | `activity` | `working` | no | no |
| OpenCode | `permission.pending` | `needs-approval` | `needs-approval` | no | no |
| OpenCode | `session.error` | `turn-error` | `error` | no | no |
| OpenCode | `session.idle` | `idle` | reduce against prior | no | no |
| OpenCode | `dispose` | `session-end` | remove | no | no |

Unlisted events fail with `UNSUPPORTED_EVENT`; `kind` and `level` derive from each adapter's immutable table (`src/adapters/*.js`), and `Refuse` / `Context` come from each adapter's `replies` export.

### `agy` translation rules

`agy` (`src/adapters/agy.js`) refuses on `PreToolUse` only, with exit `0` and stdout `{"decision":"deny","reason":R}`; an allow reply is always empty stdout, never `{"decision":"allow"}` (which `agy` treats as auto-approval). `agy` hooks run with working directory `~/.gemini/config`, so `Event.cwd` comes from `workspacePaths[0]`. `sessionId` is `agy`'s `conversationId` (`agentId: "agy:<conversationId>"`), and `stopHookActive` is `executionNum > 0`. `agy`'s `run_command` reaches guards as tool `Bash` with `tool.input = { command: <CommandLine> }` and `tool.command` set; every other `agy` tool keeps `agy`'s own tool name and arguments (for example `view_file`), so `tools: ["Bash"]` covers shell commands only. `agy`'s default handler timeout is 30 s; raising it requires raising both the handler `timeout` and `--outer-ms`.

### Claude Code `Stop` `background_tasks` reduction

Claude Code `Stop`'s optional `background_tasks` becomes `Event.background` (`src/adapters/claude-code.js`). A readable report is an array of non-null, non-array objects with string `type` and `status`. Entries with status `'running'` or `'pending'` count toward `agents` for types `'subagent'`, `'workflow'`, `'teammate'`, or `'cloud session'`, and toward `other` for every other type. An empty list reports `{ agents: 0, other: 0 }`; an absent field omits `background`; any unreadable entry or non-array value reports `background: null` (which emits a `BACKGROUND_UNREADABLE` diagnostic). `session_crons` is unread, and entry text is never copied.

Claude Code reduces `level` using the row's carried background counts:

| Level | Condition | Reduced `State` |
| --- | --- | --- |
| `done` (`Stop`) | `background.agents > 0` | `working` |
| `needs-input` (`idle_prompt`) | `background.other > 0` | `idle` |
| any | otherwise | the level |

For each event that sets a level, the registry row carries `background` as:

| `event.background` | Row's `background` |
| --- | --- |
| absent | the previous row's `background`, if any |
| `{ agents, other }` | the event's object |
| `null` | none (the `background` key is dropped) |

Observers match on `event.kind` (which state reduction does not alter) and read the reduced `state` from the registry row at or after `registry.revision`.

### Codex worker rows and root retirement

A Codex payload carrying `agent_id` is a worker's event (`src/adapters/codex.js`): its `agentId` is `codex:<agent_id>`, its `sessionId` is `<agent_id>`, `scope` is `'worker'`, and `root` is `codex:<session_id>` (the root session's agent ID, never an immediate parent). `agent_id` must be nonempty text other than `session_id`; `SubagentStart` and `SubagentStop` require it, and any violation is `INVALID_INPUT`. `SubagentStop` refuses as `Stop` does (`{"decision":"block","reason":...}`, exit `2`). `test/fixtures/registry-workers.json` is the shared schema-2 worker fixture.

Root retirement and worker lifecycle under shared process handles (`src/bus/transaction.js`):

- Every proven root Codex `SessionStart` retires other Codex session rows (`scope: 'session'`) on the same proven process in one publication, and removes `done` workers on that process whose `root` differs from the incoming root. Proof means equal non-null `Handle` values across all five fields (Linux requires a non-null `bootId`; Darwin's documented `null` is valid).
- Every unfinished worker (including `'working'` and `'needs-approval'`) survives a competing root `SessionStart` and keeps its original `root`, even when that root's row is gone. Worker `SubagentStart` never retires a root. Repeated starts keep workers of the same root; an explicit `SessionStart` may switch back to a previous root ID.
- A worker `SubagentStop` removes its row (or leaves it absent) when its `root` row is absent and a different Codex session row proves the same process as that event. Without that proof, `SubagentStop` stores `'done'` as usual. Other worker events still create or update the worker row without changing its `root`. A guard refusal returns before registry mutation, leaving all rows unchanged.
- `SessionEnd` removes its root and all worker rows naming that `root`, and confirmed process death prunes them together.
- Ordinary root events (`UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `Stop`) always upsert, so a missing or handle-less `SessionStart` can recover proof on a later event, and a retired live root returns on its next event.
- Retirement assumes **one active root at a time**, as in the captured TUI launches (where `/new`, `/resume`, and `/fork` keep the replaced root open in the same process). Daemon-hosted sessions sharing one process are unverified; if concurrent roots share a handle, each root `SessionStart` retires the others' rows while unfinished workers survive, a retired live root returns on its next event, and its workers' `SubagentStop` removes their rows meanwhile.

## Codex model resolution

`relay model --harness codex` (`src/adapters/codex-model.js`, `src/adapters/codex-rollout.js`) reports which model a process running inside a Codex tool call is executing. It reads `CODEX_THREAD_ID`, locates `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*-<thread>.jsonl` (`$HOME/.codex` when `CODEX_HOME` is unset), verifies the opening `session_meta` line and the caller's nearest `codex` ancestor start-time interval, and reads the last `turn_context` within the final 64 MiB.

`--pretty` (the default) prints `codex/<model>` when verified, else `codex` with `relay: model unverified (<reason>): <detail>` on stderr. Capture it with `$(relay model --harness codex --pretty)` so `RELAY_FORMAT` cannot switch the format. `--json` prints one object:

```json
{"verified":true,"agent":"codex/gpt-6.1-sol","harness":"codex","model":"gpt-6.1-sol","effort":"high","thread":"<id>","rollout":"<path>","reason":null}
```

| `reason` | When unverified |
| --- | --- |
| `no-thread` | `CODEX_THREAD_ID` is unset or empty (hooks, and every process outside Codex). |
| `not-under-codex` | The nearest harness ancestor is not `codex`, or there is none (a reparented daemon, `tmux` server, or another harness started from a Codex shell). |
| `no-rollout` | No rollout file matches the thread (an ephemeral session). |
| `ambiguous-rollout` | More than one rollout file matches the thread ID. |
| `no-turn-context` | The rollout file holds no `turn_context` entry. |
| `scan-limit` | No `turn_context` appears within the last 64 MiB of the rollout file. |
| `earlier-turn` | The call process started before the latest turn's `turn_context` timestamp. |
| `turn-boundary` | The call process start interval is within 1 s of the `turn_context` timestamp and cannot be ordered deterministically. |

Every verified or unverified answer exits `0`. Hard failures exit `1` with kind `model_failed` and code `INVALID_INPUT` (thread ID not a lowercase UUIDv7), `INVALID_CONFIG` (relative `CODEX_HOME` or missing `HOME`), `IO_ERROR`, `PROCESS_UNREADABLE`, or `INVALID_ROLLOUT` (missing opening `session_meta`, corrupt JSON line in the scanned range, or malformed `turn_context`). A caller that needs a model stamp treats exit `1` or a timeout beyond 2 s like an unverified answer.

**Clock requirement:** A caller is verified only while its call process's start interval less 1 s lies after the latest `turn_context` timestamp. Between the call process's start and the `relay model` invocation, the wall clock must move by less than 1 s against the boot clock.

## Hook dispatch

### Verified native facts

| Fact | Claude Code | Codex |
| --- | --- | --- |
| `PreToolUse` deny | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}` | identical |
| `PreToolUse` context | `hookSpecificOutput.additionalContext` | identical |
| `UserPromptSubmit` block | top-level `{"decision":"block","reason":"…"}`; context via `hookSpecificOutput.additionalContext` | identical |
| `Stop` / `SubagentStop` continuation | top-level `{"decision":"block","reason":"…"}` (`reason` required) | identical; `reason` becomes the continuation prompt |
| Exit `2` + stderr | blocks `PreToolUse`, `UserPromptSubmit`, and `Stop` even alongside JSON; JSON reason wins over stderr | documented for the same events |
| `Notification`, `SessionStart`, `SessionEnd`, `StopFailure` | no decision control | `SessionEnd` advisory; `PermissionRequest` decision object is unexposed |
| Output size | hook strings capped at 10,000 characters | ~2,500 tokens spilled to a file |
| Outer timeout defaults | 600 s; 30 s for `UserPromptSubmit`; `SessionEnd` 1.5 s default, raised to per-hook `timeout` up to 60 s | 600 s; `SessionEnd` 1 s default, 3 s maximum |

### Subscriber configuration

`$XDG_CONFIG_HOME/relay/subscribers.json` (mode `0700` dir, `0600` file, owned by the current user; an absent default file means no subscribers, while an absent `--subscribers FILE` argument is `INVALID_CONFIG`):

```json
{
  "schema": 1,
  "subscribers": [
    { "name": "ops-guard", "role": "guard", "kinds": ["before-tool"],
      "harnesses": ["claude-code", "codex"], "tools": ["Bash"],
      "argv": ["/usr/bin/python3", "/abs/path/hooks/relay-guard"], "timeoutMs": 4000 },
    { "name": "familiar", "role": "observer", "harnesses": ["claude-code", "codex"],
      "kinds": ["session-start", "prompt", "before-tool", "idle", "needs-input",
                "needs-approval", "turn-end", "turn-error", "reconcile"],
      "argv": ["/abs/path/familiar/bin/familiar", "observe"], "timeoutMs": 2000 },
    { "name": "familiar-opencode", "role": "observer", "harnesses": ["opencode"],
      "kinds": ["session-start", "activity", "idle", "needs-approval", "turn-error", "session-end"],
      "argv": ["/abs/path/familiar/bin/familiar", "observe"], "timeoutMs": 1000 },
    { "name": "familiar-teardown", "role": "observer", "harnesses": ["claude-code", "codex"],
      "kinds": ["session-end"],
      "argv": ["/abs/path/familiar/bin/familiar", "observe"], "timeoutMs": 200 }
  ]
}
```

`name` matches `^[a-z0-9][a-z0-9-]{0,63}$` and is unique. `kinds` is a nonempty unique subset of the 10 `EventKind` values; observers may add `'reconcile'`. `harnesses` is optional for observers and required for guards; every guard `(kind, harness)` pair must map to native events that all have a refusal channel. `tools` is allowed only when `kinds` is `["before-tool"]`. `argv[0]` must be absolute; `timeoutMs` is an integer in `1..60000`.

### Budget

`relay hook --harness NAME [--outer-ms H] [--subscribers FILE] EVENT` derives one budget profile from effective `H` (clamped at 60 s, rejecting `H < 500`, `H > 3000` on Codex `SessionEnd`, and `H > 60000` on Claude Code `SessionEnd`):

| Component | Rule | `H=1000` | `H=1500` | `H=30000` | `H>=60000` |
| --- | --- | --- | --- | --- | --- |
| `margin` | `clamp(H/10, 100, 5000)` | 100 | 150 | 3000 | 5000 |
| `reserve` (termination + reply) | `clamp(H/10, 100, 1000)` | 100 | 150 | 1000 | 1000 |
| `input` | `min(5000, H/5)` | 200 | 300 | 5000 | 5000 |
| `registry` | `min(12000, H/3)` | 333 | 500 | 10000 | 12000 |
| `total` (relay deadline) | `H - margin` | 900 | 1350 | 27000 | 55000 |
| `subscribers` (sum of matching timeouts) | `total - input - registry - reserve` | 267 | 400 | 11000 | 37000 |

### Guard protocol

Each matching guard receives `{"schema":1,"type":"event","subscriber":"<name>","event":<Event>}` on stdin (with full `tool.input`) and writes one JSON object `{"decision":"allow"|"deny","reason"?,"context"?}` on stdout with exit code `0`. `deny` requires `reason`. Present `reason` and `context` strings and combined `allow` context across guards are each capped at `CONTEXT_LIMIT` (`10000` characters); oversize output is `INVALID_REPLY` (a refusal on refusal-capable events). All matching guards run in configuration order even after a denial; the first denial's `reason` wins and drops any `context`. Any guard error or timeout produces a refusal with reason `relay refused: <CODE>: <message>`.

### Observer and reconciliation protocol

Each matching observer receives an `ObserverEnvelope` on stdin (stdout is discarded):

```json
{"schema":1,"type":"event","subscriber":"<name>","event":{"schema":1,"kind":"before-tool","tool":{"name":"Bash"}},"registry":{"generation":"<uuid>","revision":4},"changed":true,"reaped":[]}
```

`event.tool` is reduced to `{ name }` (or `null`), `event.background` carries counts or `null` when reported by Claude Code `Stop`, and `type: "reconcile"` carries `event: null`. Observers run only after a successful registry publication or reap; after a registry failure they are skipped with a diagnostic and healed by reconciliation.

`reaped` lists only rows pruned for dead processes. Rows an event removes (a `SessionEnd`'s root and workers, a Codex root `SessionStart`'s retired rows, or a worker `SubagentStop` removal when its root row is absent) and rows dropped by schema-1 supersession appear only as their absence from the snapshot. The envelope carries no snapshot; observers read `$STATE/agents.json` at or after `registry.revision`.

## Failure modes

| Exit code | Meaning |
| --- | --- |
| `0` | An `allow` reply (with or without `context`), or on `agy` any refusal (`{"decision":"deny","reason":R}` on stdout) or non-refusal failure (empty stdout, diagnostic on stderr). |
| `2` | A refusal on Claude Code or Codex (JSON refusal on stdout and reason on stderr), or a CLI usage error. |
| `1` | (Claude Code, Codex, OpenCode) An error on an event without a refusal channel, an `allow` reply whose registry publication failed, or a published Claude Code `Stop` event whose `background_tasks` was unreadable (`BACKGROUND_UNREADABLE`). The guard result stands; exit `1` does not imply the registry is unchanged. |

For `agy` (`Adapter.failureExitCode: 0`), every failure that would exit `1` exits `0` with empty stdout and a stderr diagnostic because exit `1` fails `agy`'s `PreToolUse` tool call, while a budget failure on `agy` `PreToolUse` still emits a native JSON denial so the tool does not run unguarded. Because `agy` ignores exit `2` usage errors (failing open), installing an `agy` `PreToolUse` hook requires verifying a live guard denial through the installed command.

`BACKGROUND_UNREADABLE: background_tasks is not a list of {type, status} entries` is a stderr diagnostic, never a thrown error: the event still publishes and observers still run.

**Child termination:** At `min(timeoutMs, remaining)`, relay sends `SIGKILL`, destroys pipes, and waits at most 200 ms for `close`. A missing Node executable, a crash before encoding, or the harness's outer timeout leaves the action to the harness's own policy. For hook installation and rollback procedures, see `docs/runbooks/hook-install-rollback.md` in the repository.
