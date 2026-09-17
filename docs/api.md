# Relay R1 API

R1 provides normalized observation and a host-local registry. It does not authorize
an operation: direct applyEvent performs no policy check. The later hook dispatcher
must run guards before optional enrichment/publication and retain their result when
observation fails. No hooks or plugins are registered by this package.

Node >=22, ES modules, Node built-ins only. No install lifecycle scripts or runtime
dependencies. Named root exports are exactly those below. Package subpath
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
  schema: 1;
  generation: string;    // fresh UUID if the store is recreated
  revision: number;      // incremented under the writer lock
  agents: Record<string, Agent>;
};
```

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
};
type Adapter = {
  events: Readonly<Record<string, { kind: Event['kind']; level: State | null }>>;
  stateForEvent(nativeEvent: string): State | null;
  reduceState(level: State | null, previous: State | null): State | null;
  resolveAgentPid(options?: {
    startPid?: number;
    ancestors?: (pid: number) => ProcessRow[];
  }): number | null;
};
type ReadOptions = ClockOptions & { paths?: Paths; processOps?: ProcessOps };
type MutationOptions = ReadOptions & {
  now?: () => number; uuid?: () => string;
  gitContext?: (cwd: string, options: ClockOptions) => Promise<{
    repoRoot: string | null; remote: string | null;
  }>;
  resolveAgentPid?: (adapter: Adapter) => number | null;
};
type MutationResult = {
  snapshot: Snapshot | null; changed: boolean; reaped: string[];
  diagnostics: Diagnostic[];
};
type Listing = {
  snapshot: Snapshot | null;
  liveness: Record<string, Liveness>;
};

// Named root exports (and no others in R1):
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
The measured comm/tty predicate skips index zero; no matching agent yields null.
A hook PID or shell session ID is never substituted for a missing harness process.

Missing agents.json returns snapshot:null and empty liveness, without directory
creation. Corrupt JSON is CORRUPT_STATE; present JSON null, invalid records and
unknown schemas are INVALID_SCHEMA. None is interpreted as an empty registry.
Internal readJson uses undefined to distinguish absence from parsed JSON null.
readSnapshot and listAgents do not lock, prune, create, chmod or rewrite files.

An upsert publishes revision 1 with a fresh generation UUID if no snapshot exists.
Every observed upsert increments revision, even repeated state. Removal and reap
publish only when keys change; an absent/no-change result remains null/unchanged.
Recreation starts a new generation. Revision overflow fails before publication.
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

Only relay --help, relay list --json and relay reap are implemented. List emits one
JSON Listing; on failure it exits 1 with one stdout envelope:

```json
{"error":{"code":"CORRUPT_STATE","message":"cannot read registry JSON"}}
```

Other command failures are concise stderr with exit 1. Reap success prints
Reaped N agent(s). Diagnostics go to stderr. hook/install report
FEATURE_UNAVAILABLE. The extracted OpenCode plugin therefore is not yet installable;
it deliberately has no direct-store bypass or fallback. Its child path is relay's
own CLI, shell:false, inherited environment, 64 KiB stderr cap and five-second
lifetime. It preserves permission output and awaits dispose last.

Errors are ordinary Errors carrying code and optional cause. Codes: INVALID_INPUT,
INPUT_TOO_LARGE, INPUT_TIMEOUT, UNSUPPORTED_EVENT, UNSUPPORTED_HARNESS,
INVALID_SCHEMA, CORRUPT_STATE, PROCESS_UNREADABLE, PROCESS_UNAVAILABLE,
DEADLINE_EXCEEDED, LOCK_TIMEOUT, LOCK_IDENTITY_UNKNOWN, LOCK_REPAIR_REQUIRED,
LOCK_CLEANUP_FAILED, LOCK_OWNERSHIP_LOST, IO_ERROR, GIT_ERROR, USAGE and
FEATURE_UNAVAILABLE. Unknown lock ownership at deadline is LOCK_IDENTITY_UNKNOWN;
a live holder exceeding caller patience is LOCK_TIMEOUT. Causes may retain OS
errors internally but are not serialized into diagnostics. See the
[operator repair procedure](runbooks/registry-lock-repair.md).

Local tarball smoke tests cover exports, portable JSON, sole plugin export and
installed CLI. Remote/tag portability, physical Darwin process behavior, live
harness capability, installation, migration and operator cutover remain later gates.
