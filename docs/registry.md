# Live-Agent Registry and Lock Protocol

Type: data model, protocol; document types 1.

The host-local registry stores active coding-agent sessions, OpenCode processes, and Codex worker threads in `$STATE/agents.json` under an atomic writer lock (`$STATE/agents.lock`) with bounded stale-lock reclamation (`$STATE/agents.lock.reclaim`). See [api.md](api.md) for the root JavaScript exports and CLI flags.

## State layout and agents.json

`Harness` is the closed union `'claude-code' | 'codex' | 'opencode' | 'agy'`. Agent IDs split at the first colon, preserving all remaining colons in `sessionId`. OpenCode records have `process` scope and raw `sessionId` `opencode:PID`, yielding `id` `opencode:opencode:PID`. This projection preserves existing consumer keys.

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
  harness: 'claude-code' | 'codex' | 'opencode' | 'agy';
  sessionId: string;
  scope: 'session' | 'process' | 'worker';
  root?: string;         // Codex workers only: the root session's agent id
  process: Handle | null;
  cwd: string;
  repoRoot: string | null;
  remote: string | null; // normalized identity, never the credential-bearing URL
  projectKey: string;
  project: string;       // display label, not a unique key
  state: State;
  updatedAt: number;     // Unix milliseconds
  background?: { agents: number; other: number }; // Claude Code rows only: in-flight background work last reported by Stop
};
type Snapshot = {
  schema: 2;
  generation: string;    // fresh UUID if the store is recreated
  revision: number;      // incremented under the writer lock
  agents: Record<string, Agent>;
};
```

All fields on `Agent` are required except `root` (present only on Codex `worker` rows) and `background` (present only on Claude Code rows after a `Stop` report with readable `background_tasks`). `scope` is `'process'` for OpenCode, `'session'` for Claude Code and `agy`, and for Codex `'session'` without `root` or `'worker'` with `root: 'codex:<session_id>'`; any other combination is `INVALID_SCHEMA`. Counts in `background` are nonnegative safe integers. Validators construct known fields and ignore unknown optional fields; unknown schema versions fail. Objects must be non-null and non-array. `pid` is a positive u32, timestamps and `revision` are nonnegative safe integers, `generation` is a UUID, and paths are absolute. Agent `id`, map key, `harness`, `sessionId`, and `scope` must agree. Raw payloads, tool inputs, prompts, transcripts, commands, and environment values never enter `Snapshot` records.

State directory resolution (`paths(env)` in `src/config/paths.js`):

- `$STATE` is `RELAY_STATE_DIR`, else `XDG_STATE_HOME/relay`, else `HOME/.local/state/relay`.
- Config is `XDG_CONFIG_HOME/relay`, else `HOME/.config/relay`.
- Empty `XDG_*` bases fall back; an explicit empty or relative `RELAY_STATE_DIR` or `XDG_*` base is invalid (`INVALID_INPUT`).
- `paths()` computes paths only. `$STATE` must be owned by the current user with mode `0700`; new state and control files are written with mode `0600`. An existing `0755` `RELAY_STATE_DIR` is rejected with `IO_ERROR` (relay never silently `chmod`s `$STATE` or unrelated parent directories). Symlinks, wrong-owner or wrong-type entries, and unsafe-mode leaves are rejected.
- Publication writes a complete private temporary file in `$STATE` and atomically renames it over `$STATE/agents.json`. Atomic rename promises complete visibility, not `fsync` or power-loss durability. Temporary file failures preserve the original snapshot.

Repository identity resolution (`src/bus/git.js`) prefers normalized `remote`, then `repoRoot`, then `cwd`; the display basename `project` is not a unique key. Remote credentials, query strings, and fragments are stripped. Recognized not-a-repository and missing-origin results are ordinary absence (`remote: null`); permissions errors, dubious ownership, spawn failures, and timeouts fail with `GIT_ERROR` and never silently rekey to `cwd`. Process resolver failures `PROCESS_UNREADABLE` or `PROCESS_UNAVAILABLE` permit a `process: null` record with a diagnostic; unrelated errors abort. Timestamps are sampled from `now()` at write time, never derived from process start.

## Publication order and snapshot consumption

Publication order is writer-lock acquisition order, not the order a harness emitted its hooks: concurrent hooks can publish in a different order from their source events. Only an actual mutation advances `revision`, and revisions compare only within one `generation`; generation ids are UUIDs and are never ordered.

Events with no registry effect (`registryEventFor` returns `null`: Claude Code `PostToolUse`, `PostToolUseFailure`, child, model and compaction events) take no lock and mutate nothing. When a matching observer declares `registry: "snapshot"`, the dispatch reads the current snapshot under the lock (`readAuthoritative`), which runs no callback under the lock and bumps nothing; `registry: "occurrence"` observers never wait for the registry and run even when publication failed, receiving `{"status":"unavailable","code":…}`. Distinct occurrences are separate deliveries: an unchanged revision is never a reason to discard one.

`readSnapshotFor({ generation }, options)` (a root export) is the consumption primitive for snapshot-derived state: under the existing lock it returns the current validated snapshot when its generation equals the given one, and `null` otherwise (a replaced or absent registry). Errors stay explicit. A consumer serializes its applications and keeps the last accepted generation and revision: it discards a revision not newer within its generation, adopts a changed generation only after `readSnapshotFor` confirms it, and resets revision tracking then. Any asynchronous apply that waits must call `readSnapshotFor` again before it commits; the primitive alone cannot make an external write atomic. `test/fixtures/snapshot-consumer.js` is a worked example. No exactly-once or durable occurrence delivery is promised.

The dispatch carries its absolute deadline through lock acquisition: no mutation is admitted once the deadline has passed, `applyEvent` refuses to commit after it, and a publication still waiting when the dispatch reports `DEADLINE_EXCEEDED` is refused its commit (`admitCommit`). A commit admitted before the deadline is awaited before the reply, so no deferred mutation runs after a reported failure.

## Schema-1 supersession

Schema 2 publishes, as `Agent.process`, the handle of the process that is the session, not of the terminal that displays it.

A schema-1 `agents.json` file is superseded, never read (`src/bus/transaction.js`):

- `readSnapshot`, `listAgents`, and `relay list` fail with `REGISTRY_SUPERSEDED` rather than treating a schema-1 file as absent or empty.
- The first mutation (`applyEvent` or `reapRegistry`) that encounters a schema-1 file replaces it with an empty schema-2 snapshot (`revision: 1`) under a fresh `generation` UUID, always publishes, and reports one `REGISTRY_SUPERSEDED` diagnostic per dropped agent row.
- Any other unknown schema version fails with `INVALID_SCHEMA`.

## Lock protocol and stale-lock reclamation

`$STATE/agents.lock` (the main writer lock) and `$STATE/agents.lock.reclaim` (the reclamation guard) carry schema-1 JSON tokens (`src/bus/lock.js`):

```ts
type LockToken = {
  schema: 1;
  nonce: string;   // fresh UUID per acquisition attempt
  holder: Handle;  // qualified writer process handle
};
```

Each lock token is published atomically by writing a complete private (`0600`) temporary file and hard-linking it to the lock path, then unlinking the temporary path.

`withLock` is a public root export (see [API](api.md#public-interfaces)); it serializes holders, not store transactions. Its implementation is `src/bus/lock.js`. Contention and reclamation rules:

1. When `agents.lock` exists, the waiter reads and validates its `LockToken` and probes `holder` through `processOps.probe(token.holder)`.
2. **Live or unknown holders are never expired by age.** If `probe` returns `status: 'alive'`, the waiter sleeps with bounded backoff until the lock is released or `deadline` expires. If `deadline` expires while the last completed probe was `'alive'` (even when the deadline cut short a subsequent probe), `withLock` fails with `LOCK_TIMEOUT`. If `deadline` expires while `probe` is `'unknown'`, `withLock` fails with `LOCK_IDENTITY_UNKNOWN`.
3. **Confirmed-dead main lock holders (`status: 'dead'`) recover under `agents.lock.reclaim`:**
   - The waiter acquires `agents.lock.reclaim` using the same private-temp-plus-hard-link protocol.
   - While holding `agents.lock.reclaim`, the waiter re-reads `agents.lock`. If the token changed since step 1, it releases `agents.lock.reclaim` and retries the outer loop.
   - If the same dead token is still present, the waiter unlinks `agents.lock`, releases `agents.lock.reclaim`, and retries acquisition.
4. A malformed main lock token, a malformed `agents.lock.reclaim` token, or a confirmed-dead `agents.lock.reclaim` holder is never automatically removed; `withLock` fails immediately with `LOCK_REPAIR_REQUIRED` for operator inspection (see [`registry-lock-repair.md`](runbooks/registry-lock-repair.md)).
5. Before publishing `agents.json` and before unlinking `agents.lock` on release, the writer re-reads `agents.lock` and compares the full token (`nonce` and `holder`). If the token no longer matches, publication aborts with `LOCK_OWNERSHIP_LOST`. If publication succeeded and the subsequent lock unlink fails, the transaction returns the committed snapshot with a `LOCK_CLEANUP_FAILED` diagnostic; the CLI exits nonzero and states that publication completed. Callback and cleanup failures are preserved together in `AggregateError`.

## Start-time interval

`Handle.start` (`src/bus/proc.js`) is canonical decimal u64 text, never a JavaScript `Number`:

- **Linux:** `/proc/<pid>/stat` field 22 (`starttime` in clock ticks since boot, parsed after the closing `)` of `comm`), paired with `bootId` from `/proc/sys/kernel/random/boot_id` and `host` from `/proc/sys/kernel/hostname`. When comparing a process start against wall-clock records (such as Codex rollout timestamps in `src/adapters/codex-model.js`), relay reads `/proc/stat` `btime` and clock ticks (`HZ = 100`) to form the start-time interval `[btime + ticks/HZ - 1, btime + (ticks + 1)/HZ + 1]`.
- **Darwin:** `ps -o pid=,ppid=,stat=,tty=,lstart=,comm=` whole Unix epoch seconds in local timezone, paired with `host` from `os.hostname()` and `bootId: null`.

Missing `start` or `host` yields no handle (`null`); missing Linux `boot_id` yields `bootId: null` and `unknown` liveness. The portable fixture `relay/fixtures/handles.json` (first committed at `cae020d`) includes a synthetic format/precision case above `Number.MAX_SAFE_INTEGER` and the UTC Darwin reference row `42 1 ttys000 Tue Jan 02 03:04:05 2024 /usr/bin/codex` with expected `start` `"1704164645"`.

## Liveness sweeps and reaping

Read operations and reaping separate liveness reporting from state mutation (`src/bus/transaction.js`):

- `readSnapshot` reads and validates `$STATE/agents.json`, returning `null` when the file is absent, without creating directories, locking, pruning, `chmod`ing, or rewriting files.
- `listAgents` reads the snapshot via `readSnapshot` and probes each `Agent.process` via `processOps.probe`, returning `Listing` (`{ snapshot: Snapshot | null, liveness: Record<string, Liveness> }`) without locking or pruning dead rows.
- `reapRegistry` (`src/bus/transaction.js`, invoked by `relay reap` and `reconcile`) acquires the writer lock, probes every row in `agents.json`, prunes only confirmed-dead processes (`status: 'dead'`), increments `revision` only when at least one key is removed (or when superseding a schema-1 file), and returns `MutationResult` (`{ snapshot, changed, reaped, diagnostics }`).

Only confirmed-dead processes are pruned:

- Changed Linux `bootId`, confirmed missing PID (`ESRCH` / absent proc row), zombie or dead process state (`Z` or `X`), or changed `start` proves `'dead'`.
- Foreign `host` or `platform`, absent Linux `bootId`, unreadable proc evidence, and `process: null` report `'unknown'` and are never pruned.
- Agent state `'done'` means a turn ended; it never proves process death. There is no replay, TTL, visual decay, or event log.

Upsert and removal publication rules (`applyEvent` in `src/bus/transaction.js`):

- Git and session process resolution occur before acquiring the writer lock; latest-state reduction, dead-process pruning across existing rows, and one atomic `agents.json` publication occur under the lock.
- An upsert publishes `revision: 1` with a fresh `generation` UUID if no snapshot exists, and increments `revision` on every observed upsert even when `state` is unchanged.
- `SessionEnd` (`kind: 'session-end'`) skips Git and process enrichment and removes its exact `agentId` and, for a Codex root, every row whose `root` is that `agentId`, in the same publication.
- On a shared proven process `Handle`, a Codex root `SessionStart` retires other Codex session rows and `done` foreign workers, and an `agy` root event retires finished (`'done'` / `'error'`) `agy` peers (plus proven `'root'` peers on `SessionStart`).
- Removal (`session-end`, a Codex worker `SubagentStop` whose root is absent on a process proven by another Codex root, or an `agy` subagent `Stop` on a process shared with another live `agy` row) and `reapRegistry` publish only when keys change (except schema-1 supersession); when `agents.json` is absent and no keys exist, the result remains `{ snapshot: null, changed: false, reaped: [], diagnostics: [] }`.

## Failure modes

| Code | Condition |
| --- | --- |
| `CORRUPT_STATE` | `agents.json` contains malformed JSON. |
| `INVALID_SCHEMA` | `agents.json` is JSON `null`, has an unknown schema version (other than superseded schema 1), or violates `Snapshot` / `Agent` invariants. |
| `REGISTRY_SUPERSEDED` | `readSnapshot` / `listAgents` encountered a schema-1 `agents.json`, or `applyEvent` / `reapRegistry` replaced one (emitted per dropped agent in `diagnostics`). |
| `LOCK_TIMEOUT` | A confirmed-live lock holder held `agents.lock` past caller `deadline`. |
| `LOCK_IDENTITY_UNKNOWN` | `agents.lock` holder liveness remained `'unknown'` at caller `deadline`. |
| `LOCK_REPAIR_REQUIRED` | `agents.lock` or `agents.lock.reclaim` contains malformed JSON/schema, or `agents.lock.reclaim` is held by a confirmed-dead process. Recover via [`registry-lock-repair.md`](runbooks/registry-lock-repair.md). |
| `LOCK_OWNERSHIP_LOST` | `agents.lock` token changed while the writer was inside the critical section; publication is aborted. |
| `LOCK_CLEANUP_FAILED` | Snapshot publication succeeded, but unlinking `agents.lock` failed afterward. |
| `PROCESS_UNREADABLE` | `/proc` or `ps` output could not be read or parsed. |
| `PROCESS_UNAVAILABLE` | Process table subprocess failed or timed out. |
| `GIT_ERROR` | `git` subprocess failed, timed out, or reported permissions/ownership errors. |
| `IO_ERROR` | `$STATE` or state files failed ownership (`uid`), permission (`0700` / `0600`), symlink, or filesystem checks. |
| `DEADLINE_EXCEEDED` | Operation exceeded `ClockOptions.deadline`. |
