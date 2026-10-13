# Relay API

R1 provides normalized observation and a host-local registry. It does not authorize
an operation: direct applyEvent performs no policy check. R2's `dispatchHook` runs
guards before optional enrichment/publication and retains their result when observation
fails. No hooks or plugins are registered by this package.

Node >=22, ES modules, Node built-ins only. No install lifecycle scripts. The one
runtime dependency, `jsonc-parser` (bundled), is used only by the install path.
Named root exports are exactly those below. Package subpath
`relay/opencode` exports only the async Relay plugin function; the
`relay/fixtures/handles.json` subpath supplies portable schema fixtures.

## Persisted and transient contracts

Harness is the closed union `claude-code | codex | opencode`. IDs split at the
first colon, preserving all remaining colons in sessionId. OpenCode records have
process scope and raw sessionId opencode:PID, yielding agentId
opencode:opencode:PID. This deliberate projection preserves existing consumer keys.

```ts
type State = 'idle' | 'working' | 'needs-input' | 'needs-approval' | 'done' | 'error';
type Handle = {
  platform: 'linux' | 'darwin';
  host: string;
  bootId: string | null;
  pid: number;
  start: string; // canonical decimal integer; units are defined by platform below
};
type Agent = {
  id: string;
  harness: 'claude-code' | 'codex' | 'opencode';
  sessionId: string;
  scope: 'session' | 'process';
  process: Handle | null;
  cwd: string;
  repoRoot: string | null;
  remote: string | null; // normalized identity, never the credential-bearing URL
  projectKey: string;
  project: string;       // display label, not a unique key
  state: State;
  updatedAt: number;     // Unix milliseconds
};
type Snapshot = {
  schema: 2;
  generation: string;    // fresh UUID if the store is recreated
  revision: number;      // incremented under the writer lock
  agents: Record<string, Agent>;
};
```

Schema 2 publishes, as `Agent.process`, the handle of the process that is the
session, not of the terminal that displays it (spec
`docs/specs/2026-09-23-session-process-handle.md`). A schema-1 file is superseded,
never read: `readSnapshot`, `listAgents` and `relay list` fail with
`REGISTRY_SUPERSEDED`; the first `applyEvent` or `reapRegistry` replaces it with an
empty schema-2 snapshot under a fresh generation and reports one `REGISTRY_SUPERSEDED`
diagnostic per dropped agent. Any other unknown schema is `INVALID_SCHEMA`.

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
  cwd: string;
  stopHookActive?: boolean;
  tool: null | { name: string; input: Record<string, unknown>; command: string | null };
};
```

All parent fields are required except stopHookActive. Validators construct known
fields and ignore unknown optional fields; unknown schema versions fail. Objects
must be non-null and non-array. PID is positive u32, timestamps/revision are
nonnegative safe integers, generation is a UUID, and paths are absolute. Agent
ID/key/harness/session/scope must agree. Raw payloads, tool inputs, prompts,
transcripts, commands and environment values never enter Snapshot records.

Handle.start is canonical decimal u64 text, never a JavaScript Number: Linux proc
field 22 ticks or Darwin lstart whole Unix epoch seconds. Linux host/boot evidence
comes freshly from kernel proc files; Darwin host is the OS hostname and bootId
is null. Missing start/host yields no handle; missing Linux boot yields null bootId
and unknown liveness. Darwin retains local timezone and whole-second precision.
The corpus includes a synthetic format/precision case above Number.MAX_SAFE_INTEGER;
it is not a realistic uptime claim. Fixture revision: cae020d (first committed
schema-1 corpus); inspect that commit's test/fixtures/handles.json for the versioned
cross-language test input. UTC Darwin row 42 1 ttys000 Tue Jan 02 03:04:05 2024
/usr/bin/codex has expected start 1704164645.

Only confirmed-dead processes are pruned. Foreign host/platform, absent boot proof,
unreadable evidence and process:null remain unknown. Changed Linux boot, confirmed
missing PID, zombie/X state or changed start prove death. Done means a turn ended;
it never proves process death. There is no replay, TTL, visual decay or event log.

## Public interfaces

Type notation documents JavaScript values; no TypeScript toolchain is required.

```ts
type Diagnostic = { code: string; message: string; agentId?: string };
type Liveness = { status: 'alive' | 'dead' | 'unknown'; reason: string };
type ClockOptions = { deadline?: number; clock?: () => number };
// deadline is absolute performance.now() time, never Unix milliseconds.
type Paths = {
  stateDir: string; agentsPath: string; lockPath: string; reclaimPath: string;
  configDir: string; subscribersPath: string;
};
type ProcessRow = {
  pid: number; ppid: number; comm: string;
  tty: true | string | null; starttime: string | null; state: string | null;
};
type ProcessOps = {
  recordOf(pid: number, options?: ClockOptions): ProcessRow | null;
  ancestors(pid: number, options?: ClockOptions): ProcessRow[];
  handleOf(pid: number, options?: ClockOptions): Handle | null;
  probe(handle: Handle | null, options?: ClockOptions): Liveness;
  executableOf(pid: number, options?: ClockOptions): string;
  argvOf(pid: number, options?: ClockOptions): string[];
};
type Adapter = {
  events: Readonly<Record<string, { kind: Event['kind']; level: State | null }>>;
  stateForEvent(nativeEvent: string): State | null;
  reduceState(level: State | null, previous: State | null): State | null;
  resolveSessionPid(options?: { startPid?: number; ancestors?: (pid: number) => ProcessRow[];
    executableOf?: (pid: number) => string; argvOf?: (pid: number) => string[] }): number | null;
  resolveTerminalPid(options?: { startPid?: number;
    ancestors?: (pid: number) => ProcessRow[] }): number | null;
};
type ReadOptions = ClockOptions & { paths?: Paths; processOps?: ProcessOps };
type MutationOptions = ReadOptions & {
  now?: () => number; uuid?: () => string;
  gitContext?: (cwd: string, options: ClockOptions) => Promise<{
    repoRoot: string | null; remote: string | null;
  }>;
  resolveSessionPid?: (adapter: Adapter) => number | null;
};
type MutationResult = {
  snapshot: Snapshot | null; changed: boolean; reaped: string[];
  diagnostics: Diagnostic[];
};
type Listing = {
  snapshot: Snapshot | null;
  liveness: Record<string, Liveness>;
};

// R1 named root exports:
STATES: readonly State[];
paths(env?: Record<string, string | undefined>): Paths;
adapterFor(harness: Harness): Adapter;
normalizeEvent(harness: Harness, nativeEvent: string, raw: string | Buffer): Event;
readNativeInput(stream: NodeJS.ReadableStream, options?: ClockOptions): Promise<Buffer>;
createProcessOps(options?: {
  platform?: 'linux' | 'darwin';
  readText?: (path: string) => string;
  runPs?: (args: string[], options: ClockOptions) => string;
  kill?: (pid: number, signal: number) => void;
  hostname?: () => string;
}): ProcessOps;
readSnapshot(options?: ReadOptions): Promise<Snapshot | null>;
listAgents(options?: ReadOptions): Promise<Listing>;
applyEvent(event: Event, options?: MutationOptions): Promise<MutationResult>;
reapRegistry(options?: ReadOptions): Promise<MutationResult>;
```


Defaults resolve once at operation entry: paths from environment, fresh process
provider, clock = performance.now, now = Date.now, uuid = randomUUID. Registry
operations use deadline = clock() + 12000. Deadline is monotonic absolute time,
not Unix milliseconds. Nested work shares it. Process/Git subprocesses use at most
two seconds and remaining deadline, bounded output and SIGKILL on timeout. The
input reader accepts at most 4 MiB and requires EOF within min(caller deadline,
clock() + 5000), with fatal UTF-8 decoding. It rejects partial input on errors or
expiry. OS stalls can exceed userspace bounds; no timeout releases another live
writer's lock or interrupts an active transaction callback.

recordOf returns null only for confirmed absence and throws coded errors for
unreadable/malformed evidence. ancestors reads a fresh nearest-first chain including
the caller, stopping before PID 1, on absence or with a loop error. Darwin takes
one fresh table per walk; target probes read only the requested PID. Terminal
normalization is required for ancestor resolution, independently of process proof.
`resolveSessionPid` takes the nearest ancestor after index zero that is a process of
the harness (Claude Code: `comm` `claude`, or a version-shaped `comm` whose executable
ends in `/claude/versions/<comm>`), with no terminal requirement, and yields null when
there is none or when the nearest Claude Code process has `argv[1]` `daemon` or
`bg-pty-host`. `resolveTerminalPid` keeps the measured predicate: the nearest ancestor
after index zero whose `comm` is the harness name and which owns a terminal.
`executableOf` is read only for a version-shaped `comm` and `argvOf` only for the
nearest Claude Code process; an unreadable one is `PROCESS_UNREADABLE`. The shared
chains are `relay/fixtures/ancestry.json`.
A hook PID or shell session ID is never substituted for a missing harness process.

Missing agents.json returns snapshot:null and empty liveness, without directory
creation. Corrupt JSON is CORRUPT_STATE; present JSON null, invalid records and
unknown schemas are INVALID_SCHEMA. None is interpreted as an empty registry,
except a schema-1 file: a read of one fails with REGISTRY_SUPERSEDED instead of
being treated as absent (see the schema-2 paragraph above). Internal readJson uses
undefined to distinguish absence from parsed JSON null. readSnapshot and
listAgents do not lock, prune, create, chmod or rewrite files.

An upsert publishes revision 1 with a fresh generation UUID if no snapshot exists.
Every observed upsert increments revision, even repeated state. Removal and reap
publish only when keys change, except a mutation that finds a schema-1 file: it
replaces the file with an empty schema-2 snapshot under a fresh generation and
always publishes (see the schema-2 paragraph above); otherwise an absent/no-change
result remains null/unchanged. Recreation starts a new generation. Revision
overflow fails before publication.
Git and agent resolution occur before locking; latest-state reduction and one
canonical atomic snapshot publication occur under the lock. SessionEnd skips
Git/process enrichment and removes its exact ID. Confirmed-dead pruning still
occurs under the same lock. OpenCode idle preserves error, turns active into done,
and otherwise becomes idle. Reap always returns MutationResult, emits no Event,
and invokes no guard/subscriber. R2 must notify reconciliation observers even on
unchanged reap, with null generation/revision when absent.

Repository identity prefers normalized remote, then repoRoot, then cwd; display
basename is not a unique key. Remote credentials, query and fragment are stripped.
Recognized not-a-repository and missing-origin results are ordinary absence;
permissions, dubious ownership, spawn failures and timeouts are GIT_ERROR. Git
failure never silently rekeys to cwd. Resolver failures PROCESS_UNREADABLE or
PROCESS_UNAVAILABLE permit a process:null record and diagnostic; unrelated errors
abort. Timestamps are sampled at write time, never derived from process start.

## Event mappings

| Harness | Native event | Kind | Level |
| --- | --- | --- | --- |
| Claude, Codex | SessionStart | session-start | idle |
| Claude, Codex | UserPromptSubmit | prompt | working |
| Claude, Codex | PreToolUse | before-tool | working |
| Claude | Notification:idle_prompt | needs-input | needs-input |
| Claude | Notification:permission_prompt | needs-approval | needs-approval |
| Claude | StopFailure | turn-error | error |
| Codex | PermissionRequest | needs-approval | needs-approval |
| Claude, Codex | Stop | turn-end | done |
| Claude, Codex | SessionEnd | session-end | remove |
| OpenCode | init | session-start | idle |
| OpenCode | session.busy | activity | working |
| OpenCode | permission.pending | needs-approval | needs-approval |
| OpenCode | session.error | turn-error | error |
| OpenCode | session.idle | idle | reduce against prior |
| OpenCode | dispose | session-end | remove |

Unlisted events fail; kind and level derive from one immutable table. Native input
must supply a nonempty session_id, absolute cwd and optional boolean
stop_hook_active. Supplied hook_event_name must match argv (Notification subtypes
match the base Notification). PreToolUse requires nonempty tool_name and object
tool_input. Other events carry tool:null. Only canonical Bash plus string
command extracts shell source for Claude/Codex. apply_patch.command is patch text
and yields command:null. No cmd guessing, arbitrary argument stringification, or
code-mode interpretation. These fixture forms follow the approved plan's
[Codex hook reference](https://developers.openai.com/codex/hooks) and
[Claude hook reference](https://code.claude.com/docs/en/hooks), checked during design
on 2026-09-17. They do not prove live guard capability; ops-c8e4d1 owns that gate.

## Hook dispatch (R2)

### Verified native facts

| Fact | Claude Code | Codex |
| --- | --- | --- |
| PreToolUse deny | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}` | identical |
| PreToolUse context | `hookSpecificOutput.additionalContext` | identical |
| UserPromptSubmit block | top-level `{"decision":"block","reason":"…"}`; context via `hookSpecificOutput.additionalContext` | identical |
| Stop continuation | top-level `{"decision":"block","reason":"…"}`, reason required | identical; the reason becomes the continuation prompt |
| Exit 2 + stderr | blocks PreToolUse, UserPromptSubmit and Stop even alongside JSON; JSON reason wins over stderr | documented for the same three events |
| Notification, SessionStart, SessionEnd, StopFailure | no decision control | SessionEnd advisory; PermissionRequest uses a different `decision.behavior` object, unexposed in v1 |
| Output size | hook strings capped at 10,000 characters, spilled to a file | ~2,500 tokens spilled to a file; `additionalContextLimit` per handler |
| Outer timeout defaults | 600 s; 30 s for UserPromptSubmit; SessionEnd shares 1.5 s, raised to the per-hook `timeout` up to 60 s | 600 s; SessionEnd and Interrupt 1 s default, 3 s maximum |
| Timeout effect | output discarded; PreToolUse proceeds through normal permission flow | reported as hook failure; tool call continues |
| Startup failure | exit 127 style, non-blocking notice, action proceeds | hook failure, action proceeds |

A live probe (`ops-c8e4d1`) must still confirm the installed versions honor these;
this plan only implements and tests the encoders against these fixtures.

### Subscriber configuration

**Subscriber configuration** (`$XDG_CONFIG_HOME/relay/subscribers.json`, 0700 dir,
0600 file, owned by the invoking user; an absent file means no subscribers,
anything unreadable, unsafe or invalid is `INVALID_CONFIG`). An installed hook
entry names its file with `--subscribers FILE` instead: that file is loaded
directly, the hook environment is not consulted for it, and an absent file is
`INVALID_CONFIG` (a native refusal on guard-capable events). The installer reads
the file through the same loader, so a file the hook would refuse never installs.

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

The entries are scoped by harness because each harness/event admits a different
subscriber budget (Decision 2): Codex `SessionEnd` admits 267 ms at its 1 s
default and 800 ms at its 3 s cap, Claude `SessionEnd` 400 ms, and every OpenCode
event 1334 ms under the plugin's 5 s hook lifetime. A 2 s observer on any of those
would fail validation and the event would never publish. Task 2 keeps this example
as a test fixture validated against every mapped harness/event and reconciliation.
The installer should set Codex `SessionEnd` to its 3000 ms cap and Claude's
`SessionEnd` per-hook `timeout` to match, and validate the operator's file the same way.

`name` matches `^[a-z0-9][a-z0-9-]{0,63}$` and is unique. `kinds` is a nonempty
unique subset of the ten event kinds; observers may add the pseudo-kind
`reconcile`. `harnesses` is optional for observers and required for guards; every
guard `(kind, harness)` pair must map to native events that all have a refusal
channel. `tools` is allowed only when `kinds` is exactly `["before-tool"]`.
`argv[0]` is absolute; `timeoutMs` is an integer in 1..60000. Unknown fields are
errors.

### Budget

**Budget source.** `relay hook --harness NAME [--outer-ms H] [--subscribers FILE] EVENT`; the installer
(`relay-baa816`) passes the `H` it writes as the harness `timeout` and the absolute
subscriber path it validated. Without
the flag relay uses the documented default for that harness/event. Relay never
plans beyond 60 s regardless of `H`, rejects `H` above a documented cap (Codex
SessionEnd 3000, Claude SessionEnd 60000) and below 500 ms, and derives one
profile from the effective `H`:

| Component | Rule | H=1000 | H=1500 | H=30000 | H>=60000 |
| --- | --- | --- | --- | --- | --- |
| margin | clamp(H/10, 100, 5000) | 100 | 150 | 3000 | 5000 |
| reserve (termination + reply) | clamp(H/10, 100, 1000) | 100 | 150 | 1000 | 1000 |
| input | min(5000, H/5) | 200 | 300 | 5000 | 5000 |
| registry | min(12000, H/3) | 333 | 500 | 10000 | 12000 |
| total (relay deadline) | H - margin | 900 | 1350 | 27000 | 55000 |
| subscribers (sum of matching timeouts) | total - input - registry - reserve | 267 | 400 | 11000 | 37000 |

Worst match = every subscriber whose `kinds` contains the event kind and whose
`harnesses` admits the harness, ignoring the tool filter. Its timeout sum must fit
`subscribers`, checked on every load and exported for the installer.

### Guard protocol

**Guard protocol.** stdin: `{"schema":1,"type":"event","subscriber":"<name>","event":<Event>}`
with the full `Event` including `tool.input`. stdout: one JSON object
`{"decision":"allow"|"deny","reason"?,"context"?}`; `deny` requires `reason`;
unknown fields are errors; exit code must be 0. When present, `reason` and `context`
must each be nonempty and at most 10,000 characters; combined context from all
allow replies must also be at most 10,000 characters. Oversize output is an error
and, on refusal-capable events, a refusal; relay never truncates or spills subscriber
reply fields. All matching guards run in
configuration order even after a denial (the spec's literal wording; the
alternative of stopping at the first denial was rejected because the extra cost
is bounded by the validated budget and later guards keep seeing the attempt).
The first denial's reason is the reply; a denial with `context` drops the context.
A guard error is a refusal with reason `relay refused: <CODE>: <message>`.

### Observer and reconciliation protocol

**Observer envelope** (stdin; observers' stdout is discarded):
`{"schema":1,"type":"event"|"reconcile","subscriber":"<name>","event":<Event with tool reduced to {name}>|null,"registry":{"generation":string|null,"revision":number|null},"changed":boolean,"reaped":string[]}`.
Observers run only after a successful registry publication (changed or not) or a
reap; after a registry failure they are skipped with a diagnostic and healed by
reconciliation. `type: "reconcile"` carries `event: null`.

### Hook exit codes

| Code | Meaning |
| --- | --- |
| 0 | An allow reply (with or without context). |
| 2 | The JSON refusal on stdout and the reason on stderr for any refusal. |
| 1 | An error on an event without a refusal channel, or an allow reply whose registry publication failed (the harness shows a non-blocking notice; the guard result stands). |

Observer failures never change the exit code; they are stderr diagnostics.

### Child termination

**Child termination.** SIGKILL at the child's bound (`min(timeoutMs, remaining)`),
destroy the pipes, then wait at most 200 ms for `close` before giving up on the
handle. A child ignoring SIGKILL is an OS stall covered by the survival limitation.

### R2 named root exports

```ts
CONTEXT_LIMIT: 10000;
parseReply(output: string, options?: { limit?: number }): Reply;
validateSubscribers(value: unknown): SubscriberConfig;
loadSubscribers(paths: Paths): Promise<SubscriberConfig>;
matchSubscribers(config: SubscriberConfig, event: Event): Subscriber[];
budgetFor(options: { harness?: Harness; nativeEvent?: string; outerMs?: number }): Budget;
checkBudget(config: SubscriberConfig, budget: Budget, scope: { harness?: Harness; kind: string }): Subscriber[];
dispatchHook(request: { harness: Harness; nativeEvent: string; input: NodeJS.ReadableStream; outerMs?: number }, deps?): Promise<HookResult>;
reconcile(request?: { outerMs?: number }, deps?): Promise<{ result: MutationResult; diagnostics: string[] }>;
```

## Storage, CLI and failures

State is RELAY_STATE_DIR, else XDG_STATE_HOME/relay, else HOME/.local/state/relay.
Config is XDG_CONFIG_HOME/relay, else HOME/.config/relay. Empty XDG bases fall back;
explicit empty/relative RELAY_STATE_DIR is invalid. Explicit bases must be absolute.
Paths computes names only. State directory must be owned by the current user with
mode 0700; new state/control files are 0600. Existing 0755 RELAY_STATE_DIR is
rejected with IO_ERROR; supply a private 0700 directory. Relay does not silently
chmod it or unrelated parents. Symlink, wrong-owner/type and unsafe-mode leaves
are rejected. Atomic rename promises complete visibility, not fsync/power-loss
durability. Temporary file failures preserve the original snapshot.

Main and reclaim locks carry schema-1 JSON with fresh nonce and qualified writer
Handle, published atomically by complete private file plus hard link. Live/unknown
owners are never expired by age. Dead main owners recover under the guard; a dead
or malformed guard and malformed main token require explicit operator repair.
Release compares the whole token. Successful publication followed by cleanup
failure returns the committed snapshot and a cleanup diagnostic; CLI exits nonzero
and says publication completed. Do not blindly retry as if publication rolled back.
Callback and cleanup failures are preserved together in AggregateError.

The CLI's commands are `relay list`, `relay reap [--outer-ms N]`,
`relay hook --harness NAME [--outer-ms N] [--subscribers FILE] EVENT`,
`relay install --harness NAME --subscribers FILE (--target FILE | --config-dir DIR) [--evidence FILE]
[--retire familiar] [--apply --artifact FILE]`, and `relay rollback --artifact FILE`; `relay --help`,
`relay help [<command>]`, `relay <command> --help`, and `relay --version` round it out. `--json` and
`--pretty` are global and mutually exclusive, `RELAY_FORMAT` sets the default (the protocol rows
`hook` and `ask` ignore it, since they print only the harness reply), and `install` is JSON
by default (its value is the installation artifact). Each hook command it writes runs
relay.js through the installer's own node (`process.execPath`, absolute and quoted), because a
harness launched from the macOS GUI inherits launchd's `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`),
where `#!/usr/bin/env node` finds no nvm or Homebrew node. That path can be version-specific (an
nvm path always is): removing that node breaks installed hooks until relay is reinstalled. List emits one JSON Listing under `--json`.
On failure any command exits 1 with one stderr envelope whose `kind` is `<command>_failed`:

```json
{"error":{"kind":"list_failed","detail":"CORRUPT_STATE: cannot read registry JSON"}}
```

or, outside `--json`, `relay: <detail>` on stderr. A CLI usage error (an unknown command, a
missing or invalid argument) exits 2 instead, with one line on stderr naming the problem.
Reap success prints `{"reaped":N}` under `--json` and `Reaped N agent(s).` otherwise.
Diagnostics go to stderr. `rollback` prints nothing on success in either mode. The extracted
OpenCode plugin is installed by `relay install --harness opencode --config-dir DIR`; it has no
direct-store bypass or fallback. Its child path is relay's own CLI, shell:false, inherited
environment, 64 KiB stderr cap and five-second lifetime. It preserves permission output and
awaits dispose last.

The CLI exits explicitly once its reply is flushed so a filesystem operation past
the deadline is abandoned. A publication abandoned while holding the main lock
leaves a dead-owner token that the next writer reclaims. One abandoned while holding
the reclaim guard leaves `LOCK_REPAIR_REQUIRED` for the operator.

A refusal exists only for failures relay survives long enough to encode. A missing
Node executable, a crash before encoding, or the harness's outer timeout leave the
action to the harness's own policy: Claude proceeds through its permission flow;
Codex reports a hook failure and continues.

Errors are ordinary Errors carrying code and optional cause. Codes: INVALID_INPUT,
INPUT_TOO_LARGE, INPUT_TIMEOUT, UNSUPPORTED_EVENT, UNSUPPORTED_HARNESS,
INVALID_SCHEMA, CORRUPT_STATE, PROCESS_UNREADABLE, PROCESS_UNAVAILABLE,
DEADLINE_EXCEEDED, LOCK_TIMEOUT, LOCK_IDENTITY_UNKNOWN, LOCK_REPAIR_REQUIRED,
LOCK_CLEANUP_FAILED, LOCK_OWNERSHIP_LOST, IO_ERROR, GIT_ERROR, USAGE,
INVALID_REPLY, UNSUPPORTED_REPLY, INVALID_CONFIG, INVALID_EVIDENCE, UNSUPPORTED_BINDING,
GUARD_FAILED and REGISTRY_SUPERSEDED.
Unknown lock ownership at deadline is LOCK_IDENTITY_UNKNOWN;
a live holder exceeding caller patience is LOCK_TIMEOUT, even when the deadline cut
short the last check of that holder. Causes may retain OS
errors internally but are not serialized into diagnostics. See the
[operator repair procedure](runbooks/registry-lock-repair.md).

Local tarball smoke tests cover exports, portable JSON, sole plugin export and
installed CLI. The interaction packaging checks also read the installed schema and
service runbook. The Claude terminal route has version-specific local capability
evidence; user-present tailnet acceptance, remote/tag portability, physical Darwin
process behavior, consumer migration and operator cutover remain separate gates.


## Interaction messages and relay serve

v1 adds a durable interaction inbox, reached through the CLI, private socket and
optional HTTP surface. No root package export is added: the interaction modules
are internal, not a library API. The packaged JSON Schema is
`schemas/interaction/message.schema.json`; the [service runbook](runbooks/inbox-service.md)
covers operation. Node >=22 remains the runtime floor.

### Messages and entries

Times are Unix milliseconds; message ids and `answerId` are sender-generated UUIDs,
written in lowercase. Uppercase UUID text is refused with `INVALID_MESSAGE`, because ids
are compared exactly and name entry files.
`Harness` is `claude-code | codex | opencode`. These message types follow
[spec §4](specs/2026-10-11-typed-interaction-messages.md#4-envelope-and-kinds):

```ts
type Party = { kind: 'agent'; agentId: string } | { kind: 'user' };
type Surface = 'phone' | 'desktop' | 'cli' | 'terminal';
type Kind = 'question' | 'answer' | 'defer' | 'withdrawal' | 'notice';
type Message = {
  schema: 1;
  id: string;            // this message
  kind: Kind;
  correlationId: string; // the question's id; a question's own id; a notice's own id
  from: Party;
  to: Party;
  createdAt: number;
  context: { project: string | null; taskId: string | null; cwd: string | null };
  body: QuestionBody | AnswerBody | DeferBody | WithdrawalBody | NoticeBody;
};

type QuestionBody = {
  class: 'clarification' | 'artifact-review' | 'authorization';
  expiresAt: number;                       // required; §5.4
  native: { harness: Harness; sessionId: string; callId: string } | null;
  artifact: { ref: string; revision: string } | null;
  supersedes: string | null;               // id of a question this one replaces
  items: Item[];                           // 1 to 4
};
type Item = {
  id: string;                              // stable within the question
  header: string;                          // at most 16 characters
  prompt: string;                          // at most 1000 characters
  type: 'boolean' | 'single' | 'multi' | 'text';
  options: Option[];                       // 2 to 4 for single and multi; empty otherwise
  recommended: string | null;              // an option id, or null
  allowOther: boolean;                     // free text beside the options; single and multi only
  maxLength: number | null;                // text only, at most 2000
};
type Option = { id: string; label: string; description: string | null };

type Value =
  | { type: 'boolean'; value: boolean }
  | { type: 'choice'; optionIds: string[] }        // exactly 1 for single
  | { type: 'other'; text: string }                // only when allowOther
  | { type: 'text'; text: string };
type AnswerBody = {
  answerId: string;                    // client-generated UUID; the idempotency key
  surface: Surface;
  outcome: 'answered' | 'declined';
  artifactRevision: string | null;     // the revision the responder saw
  values: Record<string, Value>;       // every item id when answered; empty when declined
};
type DeferBody = { surface: Surface };
type WithdrawalBody = {
  reason: 'asker' | 'user' | 'asker-gone' | 'superseded' | 'answered-elsewhere';
};
type NoticeBody = { expiresAt: number; title: string; text: string; level: 'info' | 'warn' };
```

Questions contain 1–4 items; single/multi items have 2–4 options. Item ids and option
ids are unique within their respective containers. Answers use option ids, not
labels or positions. Unknown optional message fields are ignored; unknown schema
versions or kinds fail. Questions are immutable: replace one with `supersedes`.
An answered outcome supplies every item; a declined outcome supplies no values.
An authorization answer is local-only, but even a saved answer grants no authority.
A remote client may decline or defer. The Claude terminal adapter produces only
clarification questions, expiring after 23 hours. Notice producers are not wired in v1.

The persisted entry types describe the reviewed store (§6): all fields shown are
required, including null fields and empty histories. Invalid or unknown durable
entry fields are rejected rather than normalized away.

```ts
type QuestionState = 'pending' | 'answered' | 'handed' | 'consumed' | 'unconfirmed'
  | 'undeliverable' | 'released' | 'withdrawn' | 'expired';
type EntryState = QuestionState | 'active';
type EntryFrame = {
  schema: 1;
  id: string;
  seq: number; // positive, durable service-wide sequence; gaps are allowed
  updatedAt: number;
  log: { seq: number; at: number; state: EntryState; cause: string }[];
};
type QuestionEntry = EntryFrame & {
  kind: 'question';
  question: Message;
  state: QuestionState;
  presentation: 'inbox' | 'desktop';
  route: { handback: boolean; waiter: Handle | null };
  answer: Message | null;
  handedAt: number | null;
  observed: Record<string, string> | null;
  withdrawal: WithdrawalBody | null;
  supersededBy: string | null;
  messages: { at: number; message: Message }[];
  observations: { at: number; surface: 'terminal'; answers: Record<string, string> }[];
};
type NoticeEntry = EntryFrame & {
  kind: 'notice';
  notice: Message;
  state: 'active' | 'expired';
  seen: boolean;
};
type Entry = QuestionEntry | NoticeEntry;
type Presence = { mode: 'here' | 'away'; updatedAt: number };
```

`question`/`notice` retains the original normalized message; `messages` retains
accepted answer, defer and withdrawal messages. `observations` retains native answer
observations, including answers from the terminal after release or expiry. `observed`
is the latest such map. The full saved entry and its histories are returned to clients.
Raw harness payloads, transcripts and environment values are never persisted.

### Lifecycle

| State | Meaning / human label |
| --- | --- |
| `pending` | Waiting, presented in the inbox or on the desktop. |
| `answered` | answer saved |
| `handed` | handed to the agent |
| `consumed` | the agent received it |
| `unconfirmed` | handed, receipt not confirmed |
| `undeliverable` | Saved answer shown with its recorded reason. |
| `released` | Returned to the harness's native question UI. |
| `withdrawn` | Voided by withdrawal, asker loss or supersession. |
| `expired` | Deadline passed while pending. |

Only `consumed` means receipt. JSON retains the machine state; human CLI output uses
the fixed labels above. A valid first answer moves pending → answered; the recorded
waiter moves answered → handed before writing the harness reply. A matching native
confirmation moves handed or unconfirmed → consumed. A mismatching confirmation,
or 60 seconds without confirmation after handoff, yields unconfirmed. Late matching
confirmation still consumes it. Released/expired native receipts are recorded without
changing that terminal state.

Defer releases a handback route; otherwise it leaves pending with desktop presentation.
Withdrawal, expiry, asker loss or supersession closes a pending question. Asker loss
with an answer saved yields undeliverable, and so does reaching `expiresAt` while the
answer is still `answered` (logged `expiry`). Sender withdrawals log `withdrawal:<reason>`;
service-generated loss and supersession log distinct `asker-gone` and `superseded` causes.
Consumed, unconfirmed, undeliverable, released, withdrawn and expired are terminal,
except that unconfirmed can still receive confirmation. Notices are active until expiry
and separately carry a seen mark.

A retry with the saved `answerId` returns the entry in every answer-holding state;
another answer or defer gets `ALREADY_ANSWERED` with the winner, and withdrawal gets
`ANSWERED`. Clock expiry is applied before mutations, including after host sleep.
See [spec §5.1–5.2](specs/2026-10-11-typed-interaction-messages.md#51-states)
for the full transition table and validation/revision ordering.

`relay serve` is the only inbox writer. Startup fsyncs the full directory ancestor
chain through the inbox, including existing links after interrupted initialization.
A failure refuses startup before accepting clients. It fsyncs files and directories and allocates
`inbox/seq` before publishing entries, preserving monotonic sequence numbers across
crashes and pruning. Point reads, snapshots and watch registration queue behind writes.
Terminal entries older than 30 days are pruned at startup and daily; a predecessor
referenced by a nonterminal replacement is retained. Invalid/reconciliation-failed
entries go to `inbox/rejected/`, never automatically cleaned. A failed write stops
service operations with `STORE_FAILED`; restart reconciles disk before serving.

### Local socket protocol

`$STATE/serve.sock` is privately owned, mode 0600; same-user processes are trusted.
Each newline-delimited JSON request is `{reqId, op, ...fields}`; a success is
`{reqId, ok:true, ...result}`, and an error is
`{reqId, ok:false, error:{code,message}, entry?, ...detail}`. Requests are limited to
1 MiB in UTF-8 bytes per line; oversize lines close the connection. Private service
replies have no line cap so full retained histories can be read.

| Op | Fields | Result / pushes |
| --- | --- | --- |
| `ask` | `message` (question), `waiter` (Handle), `handback` (boolean) | `entry`, or `passthrough:true` while here; `{type:"state",entry}` on later transitions for the attached waiter. |
| `handed` | `id`, `waiter` (Handle) | `entry`; only the recorded waiter may take the answer; replay is idempotent. |
| `confirm` | `harness`, `callId`, `observed` (native answers map) | `entry`. |
| `answer` / `defer` / `withdraw` | `message` of the matching kind | `entry`; socket withdrawal permits only user/asker reasons. |
| `notify` | `message` (notice) | `entry`; resending the identical notice returns it unchanged, and any other entry under that id is `ID_CONFLICT` with the existing entry, as for `ask`. No v1 producer is wired. |
| `list` | optional `since` and `states` | `{seq,entries}`: nonterminal entries plus terminal entries changed after `since`, filtered by states. |
| `get` | `id` | `entry`, including terminal entries. |
| `presence.get` / `presence.set` | none / `mode` | `presence`. |
| `watch` | optional `since` | Replay `{type:"entry",entry}` changes then subscribe atomically; response contains `seq`; live entry/presence pushes follow. |

`since` is a durable integer sequence, never a date. Restart grants recorded waiters
10 seconds to reattach; confirmed-dead waiters withdraw pending questions or make
saved answers undeliverable. Unknown liveness is not death; an answer that no waiter
has taken by the question's `expiresAt` becomes undeliverable. Closing an attached
waiter connection while the service runs records asker loss; service shutdown does not.

### HTTP protocol and guard

HTTP is off unless `RELAY_HTTP_PORT` is configured (1–65535), and binds only
`127.0.0.1`. `RELAY_SERVE_HOST` and `RELAY_SERVE_LOGIN` must be set together and
require HTTP; `RELAY_CLIENT_DIR`, if set, must be absolute and also requires HTTP.

Every path, static paths included, is guarded. Any header starting `X-Forwarded-`,
`Tailscale-User-Login` or `Tailscale-Funnel-Request` marks a request as proxied. It
requires an exact login and Host match with the configured values, and no Funnel
header. Otherwise it must have loopback Host (`127.0.0.1`, `localhost` or `[::1]`)
on the configured port. The server still binds IPv4 loopback only. Guard failure is
403. Every POST and PUT requires `application/json` and an exact Origin:
`https://<RELAY_SERVE_HOST>` for proxy traffic, `http://<Host>` locally. Ports and
case are significant. Mutation JSON bodies are capped at 64 KiB in bytes.

| Method and path | Request / response |
| --- | --- |
| `GET /v1/inbox?since=<seq>` | `{seq,entries}`; same snapshot selection as socket list; invalid negative/noninteger since is 400. |
| `GET /v1/inbox/<id>` | `{entry}`, including terminal entries; 404 if absent. |
| `POST /v1/inbox/<id>/answer` | `AnswerBody`; 200 `{entry}`, or 409 `{error:{code,message},entry}` plus saved `answer`/expected `revision` when applicable. |
| `POST /v1/inbox/<id>/defer` | `DeferBody`; same result shape. |
| `GET /v1/events` | SSE `entry` events carry full entries with id `seq`; `Last-Event-ID` (or `?since=`) resumes retained entries; presence events have no id. |
| `GET /v1/presence` | `{presence}`. |
| `PUT /v1/presence` | `{mode:"here"\|"away"}` → `{presence}`. |
| `GET /v1/agents` | `{agents:[{id,harness,project,state}]}` for display. |
| `GET /...` | Read-only static files from `RELAY_CLIENT_DIR`; relay ships no client. |

The service assigns surface `phone` to proxied answer/defer requests and `desktop`
to local ones, overriding client values. There is no HTTP withdrawal or seen route.
Malformed JSON/input/message is 400, oversize bodies 413, non-JSON mutations 415,
missing routes/entries 404; internal faults are reported as 500 `INTERNAL`, and
shutdown as 503 `UNAVAILABLE`. Host sleep serves nothing; retry with the same
`answerId` on reconnect, respecting expiry.

### CLI and capability gate

| Command | Contract |
| --- | --- |
| `relay serve` | Foreground service; SIGTERM/SIGINT drains active work and exits. |
| `relay ask --harness claude-code [--handback] PreToolUse\|PostToolUse` | Hook route; strict option order; always exits 0, stdout is the hook reply; errors diagnose and pass through. |
| `relay inbox list [--since SEQ]` | List current entries plus terminal entries changed after the sequence. |
| `relay inbox show ID` | Full entry and history. |
| `relay inbox answer ID ITEM=VALUE...` | Supply every item's value using the tokens below. |
| `relay inbox answer ID --decline` | Decline, with no values. |
| `relay inbox defer ID` / `relay inbox withdraw ID` | Defer to desktop/native UI, or withdraw. |
| `relay presence [here\|away]` | Read/set durable presence; here is the initial default. |
| `relay install --harness claude-code --subscribers FILE --target FILE --evidence FILE --with ask [--apply --artifact FILE]` | Plan/apply the evidence-gated route. Every Claude install reconciles the route: without `--with ask` it removes relay's own `ask` entries. |

`relay inbox` alone is usage error (exit 2); it is a parent command, not an executable
listing alias. `--json` emits raw machine states and full entries; `--pretty` emits
human labels. Answer/defer/withdraw conflicts still exit 1 and retain `error.kind`
and `error.detail`; JSON adds the saved winning entry as `error.entry`, while pretty
output shows the winning values (choice labels), surface and durable save time.
Boolean tokens are `ITEM=true`/`false`; choice tokens use option ids
(`ITEM=o1`, multi `ITEM=o1,o2`); free text uses quoted `ITEM=other:text` or
`ITEM=text:text`. Inbox/presence use the socket and fail `SERVE_UNAVAILABLE` if absent.
Away routes new questions into the inbox; here passes new questions to the native UI.
Existing pending questions remain pending; defer one explicitly to return it to the
native UI when handback is available.

The [capability record](evidence/claude-code-answer-routes.json) has five passing rows
for Claude Code 2.1.296. Installation requires terminal-answer and deny-stops rows;
receipt gates PostToolUse, release enables handback, and under-denial gates nothing.
An upgraded/unknown version needs new [probes](runbooks/answer-route-probes.md) before
installation; until then `--with ask` refuses, and an install without it removes the
route. `--evidence` names one record per harness version: a guard subscriber also needs
the dispatch `probes` in that same record, beside the route rows (see the
[service runbook](runbooks/inbox-service.md#installing-the-question-route)).
The user-present tailnet [acceptance run](runbooks/inbox-e2e-2026-10.md)
(Task 14 / spec acceptance 7) passed phone answer, phone defer and desk withdrawal
with this version. No live hook is installed by this package.

Interaction error codes (ordinary errors carry `code`, with optional internal cause):

| Codes | Meaning |
| --- | --- |
| `ALREADY_ANSWERED`, `ANSWERED` | A saved answer won; it is retained with the response. |
| `WITHDRAWN`, `EXPIRED`, `RELEASED`, `UNDELIVERABLE` | The requested lifecycle action cannot run in that state. |
| `STALE`, `INVALID_ANSWER`, `LOCAL_ONLY` | Revision mismatch, invalid item values or remote authorization answer. |
| `NOT_WAITER`, `NOT_ANSWERED`, `NOT_HANDED`, `NOT_SUPERSEDABLE` | Route ownership or transition precondition failed. |
| `ID_CONFLICT`, `NOT_FOUND`, `NOT_A_QUESTION` | Conflicting message identity, missing entry/native call, or wrong entry kind. |
| `INVALID_MESSAGE`, `INVALID_INPUT`, `INVALID_REQUEST`, `UNKNOWN_OP` | Invalid message, native input/presence/cursor, socket frame or operation. |
| `SERVE_RUNNING`, `SERVE_UNAVAILABLE`, `STORE_FAILED` | Existing live service, unavailable socket or failed durable write requiring restart. |
| `INVALID_CONFIG`, `INVALID_ENTRY`, `HARNESS_UNAVAILABLE`, `UNSUPPORTED_ROUTE`, `UNEXPECTED_STATE` | Invalid configuration/durable entry, failed harness version probe or unsupported route/state. |
| `FORBIDDEN`, `UNSUPPORTED_MEDIA`, `TOO_LARGE`, `INTERNAL`, `UNAVAILABLE` | HTTP guard, media/body limit, internal failure or shutdown. |

Existing storage, process, lock, evidence and usage errors above also apply.
