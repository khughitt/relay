# Adapters, Process Identity and Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Execute the phases in order; checkboxes record completed work, not intentions.

**Status:** approved by the user on 2026-09-17 with the review edits below incorporated; runtime implementation has not started.

**Goal:** Complete `relay-06b1da` with a tested Node package containing normalized
harness observation, qualified process identity, safe registry transactions,
OpenCode observation modules, and the `list --json` / `reap` CLI commands.

**Architecture:** Extract familiar's small modules and relevant regression tests,
removing presentation dependencies. Native input normalization stays separate from
optional enrichment and registry publication so the subsequent dispatcher can run
guards first. Keep one atomic snapshot and the approved lock-recovery algorithm.

**Tech stack:** Node >=22, ES modules, Node built-ins, `node:test`, Git, Just and the
existing ops timing/check tools. No runtime or development npm dependency.

**Specs:** Read both the parent design in ops
`docs/specs/2026-09-16-relay-design.md` (approved after `d7e2c33`) and relay's
`docs/specs/2026-09-17-registry-lock-safety.md` (approved after `4050368`). The latter
overrides familiar's age-based lock recovery, not the parent snapshot contract.

**Source baseline:** familiar `70ae8ed`; extraction inputs remain unchanged at
`cb7aed4`. Preserve the copied MIT license. Source paths below prefixed `familiar:`
or `ops:` belong to that project; other paths belong to relay.

## Global constraints

- Work in `.worktrees/relay-06b1da/`; the branch and worktree already exist. Run
  `tasks start relay-06b1da` before changes and `tasks check` before every commit.
- No familiar source deletion here. `fam-6e8321` migrates callers and removes the
  old implementation when its replacement is usable. This is staged extraction,
  with no forwarding modules or live dual registration.
- Exact parent schema: `Snapshot.schema = 1`, generation UUID, safe integer
  revision, agents keyed by `<harness>:<sessionId>`. Split IDs at the first colon.
- States: `idle`, `working`, `needs-input`, `needs-approval`, `done`, `error`.
  No familiar-theme imports, visual pins, slot hashing, sprites or terminal output.
- `Handle.start` is canonical decimal u64 text: Linux proc field 22 ticks, Darwin
  lstart epoch seconds. Linux boot ID and hostname come from proc; Darwin boot ID
  is null and hostname comes from the OS. A missing process proof is never invented.
- Only confirmed-dead records are pruned. Unknown remains visible. Done is a turn
  state; it does not mean process death. No registry TTL or visual decay.
- State: `RELAY_STATE_DIR`, otherwise `$XDG_STATE_HOME/relay`, otherwise
  `~/.local/state/relay`. Config: `$XDG_CONFIG_HOME/relay`, otherwise
  `~/.config/relay`. Directory mode 0700; state/control files 0600.
- No raw tool inputs, prompts, transcripts, native payloads or environment values
  in persisted records. Construct records from the approved fields explicitly.
- Native input <=4 MiB; stdin wait <=5 seconds and within its caller's deadline.
  The subsequent dispatcher owns the 64 KiB subscriber-output limit.
- Use monotonic deadlines; a timeout never revokes another live owner's lock.
  Ordinary dead writers recover; corrupt tokens and abandoned reclaimers require
  explicit repair. No nested automatic reclamation of the reclamation guard.
- This intermediate package is not installable as a live hook. `relay-4c4828`
  supplies dispatch/replies/reconciliation delivery and `relay-baa816` installs it.
  No guardless `hook` command, subscriber stub, remote, tag, or live config change.
- R1 exposes observation primitives, not authorization. Calling `applyEvent`
  directly performs no policy check. The later hook dispatcher must run guards
  before it and preserve their result if observation fails.

## File and extraction map

| Relay files | Source / responsibility |
| --- | --- |
| `src/protocol.js` | New schema validators, six states, coded errors and canonical integer checks |
| `src/adapters/{index,payload,claude-code,codex,opencode}.js` | Copy corresponding familiar adapters; retain reducers/resolvers, remove cosmetic flags; add normalized kinds |
| `src/bus/{proc,identity,paths,store,lock,prune,transaction}.js` | Extract nonvisual familiar bus code; replace admitted-record shape and lock policy |
| `src/index.js` | Explicit named package exports defined below |
| `integrations/opencode/{binding,window,queue,hook,plugin}.js` | Copy familiar server observation modules, renamed to relay; no sprite/TUI modules |
| `bin/relay.js` | CLI parsing and output only; list/reap/help |
| `test/{protocol,payload,claude-code,codex,opencode,proc,identity,paths,store,lock,lock-multiprocess,prune,transaction,cli,pack}.test.js` | Port source tests where present; add contract/integration coverage |
| `test/helpers/fixture.js` | Temporary-directory cleanup and the small registry test helper below |
| `test/fixtures/{handles.json,lock-worker.js}` | Portable handle corpus and real lock-test child; worker is not packaged |
| `integrations/opencode/{binding,window,queue,hook}.test.mjs` | Existing observation regressions, preserving order and failure isolation |
| `package.json`, `package-lock.json`, `justfile`, `.githooks/{pre-commit,pre-push}`, `tools/{tt,ops-check}` | Working package and ops front door, introduced with the first real tests |
| `docs/api.md`, `docs/runbooks/registry-lock-repair.md`, `README.md`, `AGENTS.md` | Public contract, bounded repair procedure, accurate intermediate status and verification instructions |

Do not copy familiar's `test/helpers/fixture.js`: it generates themed sprites and
imports yaml/familiar-theme. Its transaction tests must shed those fixtures.
Do not copy its suite runner: it manages familiar-specific leases and temporary
roots. Use Node's test runner directly with explicit test-file globs and per-test
cleanup. Port its relevant tests, not its unrelated suite infrastructure.

## Interfaces used by every phase

Module direction is explicit: `adapters/payload.js` owns byte decoding, native
payload validation and readNativeInput, with no adapter imports. Individual
adapters own tables/reducers/resolvers and do not import payload.js or index.js.
`adapters/index.js` imports those modules and owns adapterFor and normalizeEvent.
`bus/transaction.js` owns readSnapshot, listAgents, applyEvent and reapRegistry;
store.js contains only internal file I/O. `src/index.js` re-exports the named
public functions without adding work at import time.

The parent design defines `Harness`, `State`, `Handle`, `Agent`, `Snapshot`, and
`Event`; use those field names verbatim. `Harness` is the closed union
`claude-code | codex | opencode`. All notation below describes JavaScript values;
no TypeScript compiler or declaration generator is required.

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

Defaults are resolved once at the public operation's entry: paths from env,
processOps from the factory, `clock = performance.now`, `now = Date.now`,
`uuid = randomUUID`, deadline `clock() + 12_000` for registry operations. The
dispatcher will pass a shorter shared deadline; nested calls must forward it.
The standalone 12-second budget retains familiar's acquisition patience without
an owner-age lease. Stdin gets `min(caller deadline, clock() + 5_000)`.
Darwin subprocesses and git each get at most two seconds and the remaining
deadline; recompute remaining time before each subprocess. Refuse to start one
when no time remains. OS stalls can still defeat a userspace deadline, as the
parent spec states; do not implement a Promise race that releases a live lock
while its callback is still writing.

`recordOf` returns null only for confirmed absence; unreadable/malformed evidence
throws a coded process error. `ancestors` returns a fresh, nearest-first chain
including the caller but stopping before PID 1 (as familiar does), or at confirmed
absence; detect loops. No
cross-call Darwin process cache. `handleOf` returns null for unavailable start/host;
Linux null boot evidence remains a valid Handle value but cannot prove liveness.
`probe` always reads fresh evidence and returns unknown for unavailable proof.

Missing `agents.json` is represented by `snapshot: null`, with empty liveness;
reads do not mint a generation or create a directory. A write creates generation
and revision 1. Later actual writes increment revision once under the lock.
No-change removal/reap leaves bytes, generation and revision alone. Reject
overflow of the safe-integer revision instead of wrapping it.

Use coded ordinary Errors, constructed inside `src/protocol.js`:

```js
export const relayError = (code, message, cause) =>
  Object.assign(new Error(message, { cause }), { code });
```

Codes: `INVALID_INPUT`, `INPUT_TOO_LARGE`, `INPUT_TIMEOUT`, `UNSUPPORTED_EVENT`,
`UNSUPPORTED_HARNESS`, `INVALID_SCHEMA`, `CORRUPT_STATE`, `PROCESS_UNREADABLE`,
`PROCESS_UNAVAILABLE`, `DEADLINE_EXCEEDED`, `LOCK_TIMEOUT`,
`LOCK_IDENTITY_UNKNOWN`, `LOCK_REPAIR_REQUIRED`, `LOCK_CLEANUP_FAILED`,
`LOCK_OWNERSHIP_LOST`, `IO_ERROR`, `GIT_ERROR`, `USAGE`, `FEATURE_UNAVAILABLE`.
Messages identify the failed operation without echoing native payloads, raw Git
URLs, tool commands or environment values. Underlying errors may be retained as
causes but are not serialized verbatim into CLI output.

## Task 1: Extract harness observation and the registry

These are implementation phases of `relay-06b1da`, not newly filed tracker tasks.
Each phase includes a focused red/green cycle and a conventional commit. Read the
current source before copying it; if it differs from the stated baseline, inspect
the difference rather than silently copying an obsolete revision.

### Phase 1: Validate the persisted contract and establish the front door

**Files:** `src/protocol.js`, `src/index.js`, `test/protocol.test.js`,
`test/fixtures/handles.json`, package files, Just/hooks/tools.

**Produces:** internal `parseStart(text)`, `validateHandle(value)`,
`validateSnapshot(value)`, `validateEvent(value)` and `relayError`; root export
`STATES`. Validators return canonical objects containing the known fields; unknown
optional fields are ignored, unknown schema versions are rejected.

- [x] Write the first failing protocol test, then run it with `node --test
  test/protocol.test.js` before the front door exists. Failure must name the missing
  protocol module; no unrelated harness or dependency is involved.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStart, validateSnapshot } from '../src/protocol.js';

test('Linux start text does not round through a Number', () => {
  assert.equal(parseStart('9007199254740993'), '9007199254740993');
  for (const bad of ['01', '+1', '1e3', '1.0', ' 1', '18446744073709551616']) {
    assert.throws(() => parseStart(bad), { code: 'INVALID_SCHEMA' });
  }
});
test('unknown snapshot schema is not an empty registry', () => {
  assert.throws(() => validateSnapshot({ schema: 2 }), { code: 'INVALID_SCHEMA' });
});
```

- [x] Implement the integer primitive and the parent field validators. Use
  non-null, non-array objects; require every parent field and validate PID as a
  positive u32, timestamps/revision as nonnegative safe integers, valid UUID
  generation, absolute cwd/repoRoot, enum values, ID/key/agent consistency, and
  platform-specific Handle fields. Reject whitespace-only session/host strings.
  Linux boot ID, when present, is a UUID; Darwin boot ID must be null. Normalize
  records by constructing approved fields, not by spreading unchecked input.

```js
export function parseStart(text) {
  if (typeof text !== 'string' || !/^(0|[1-9][0-9]*)$/.test(text)
      || text.length > 20 || BigInt(text) > 18446744073709551615n) {
    throw relayError('INVALID_SCHEMA', 'start must be canonical decimal u64 text');
  }
  return text;
}
```

  Put these exact values in the portable JSON corpus, with descriptive case names:
  valid starts `0`, `987654`, `9007199254740993`, `18446744073709551615`; rejected
  starts from the test plus numeric `987654`, empty string and `-1`. Label the
  oversized Linux case **synthetic format/precision**, not realistic uptime. Add
  Linux handles with present/null boot ID and Darwin row
  `42 1 ttys000 Tue Jan 02 03:04:05 2024 /usr/bin/codex`, timezone `UTC`, expected
  start `1704164645`. The JSON wrapper is `{schema:1, starts:[...], handles:[...],
  darwin:[...]}`; each case carries `name`, `input`, and either `expected` or
  `errorCode`. Test the file itself through validators; keep it free of host data.

- [x] Create package metadata and copy ops's Just/hooks/tt/ops-check templates.
  Use these package fields initially; add the other exports/files in Phase 6 when
  they exist. Generate `package-lock.json` with `npm install --package-lock-only
  --ignore-scripts --offline --no-audit --no-fund`.

```json
{
  "name": "relay", "version": "0.1.0", "private": true,
  "license": "MIT", "type": "module", "engines": { "node": ">=22" },
  "exports": { ".": "./src/index.js" },
  "scripts": { "test": "node --test test/*.test.js" },
  "files": ["src/", "test/fixtures/handles.json", "LICENSE"]
}
```

  Fill the copied Just template with `fast_cmd := "npm test"`,
  `test_cmd := "npm test"`, `check_cmd := "python3 tools/ops-check && tasks check"`,
  and `setup_cmd := "just work-link .worktrees"`. The identical fast/full commands
  are intentional: no affected-only selector yet. There are no dependencies to
  install or node_modules to hydrate. Retain the template work-link recipe and
  hook targets, install `core.hooksPath .githooks`, and mark hooks executable.
  Append ops `templates/gitignore` so timing logs remain untracked.

- [x] Run `just setup`, `just test-fast`, `tasks check`, `git diff --check`; commit
  `feat: define relay snapshot and handle contracts`. All subsequent test commands
  go through `just test-fast` or `just gate`.

### Phase 2: Extract process identity and bounded repository context

**Files:** `src/bus/{proc,identity,paths}.js`, `test/{proc,identity,paths}.test.js`.

**Produces:** ProcessOps and paths above; internal `parseStat`, `parseDarwinRow`,
`normalizeDarwinTty`, `gitContext`, `normalizeRemote`, `projectKeyFor`,
`displayProject`. No `autoSlot`, slot hashing, theme imports or global process cache.

- [x] Port familiar's process and repository tests, removing slot tests and
  changing numeric start expectations to strings. Add this parser regression and
  run `just test-fast` to observe the precision failure before changing parsing.

```js
test('proc parsing keeps state and exact field-22 text', () => {
  const after = Array(20).fill('0');
  after[0] = 'Z'; after[1] = '1'; after[4] = '34816';
  after[19] = '9007199254740993';
  const row = parseStat(`42 (my (weird) process) ${after.join(' ')}`);
  assert.equal(row.starttime, '9007199254740993');
  assert.equal(row.state, 'Z');
});
```

- [x] Parse Linux after the final `)` as today, retaining state and passing field
  22 through `parseStart`. Preserve read failures: ENOENT/ESRCH is absent;
  EACCES/EPERM/other read errors or malformed evidence is unknown, never absent.
  Use fresh kernel hostname/boot evidence and fresh start evidence for probes.
  Apply decisions in order: foreign host/platform or unavailable local identity →
  unknown; Linux boot mismatch → dead; same-boot confirmed missing PID → dead;
  unreadable record → unknown; zombie/X state or start mismatch → dead; otherwise
  alive. A null Handle or missing Linux boot evidence is unknown. Do not use
  cached boolean `lockHolderAlive` answers in the new lock implementation.

  Separate Darwin core process parsing from terminal validation. `handleOf` and
  `probe` must not depend on a recognized tty. `recordOf`/ancestor resolution keep
  familiar's strict tty normalization and per-row error isolation. Parse a fresh
  `ps` process table once per ancestor walk, not once for the lifetime of the
  provider. A fresh target probe reads only that PID. Configure `/bin/ps` with
  `LC_ALL=C`, remaining bounded timeout and a 4 MiB output cap. An empty successful
  target lookup is absent; a command failure is unknown unless a separate process
  existence check confirms ESRCH. Test the portable Darwin epoch case under UTC
  in a child process and retain familiar's local-timezone/DST validation tests.

- [x] Keep the normalized remote → repoRoot → cwd identity order. Strip credential,
  query and fragment material before returning normalized remote identity; do not
  log the original URL. Retain existing SSH/HTTPS/port/numeric-owner tests and add
  credential-bearing URL coverage. Recognized not-a-repository and missing-origin
  results produce null fields; spawn failure, permissions, dubious ownership and
  timeout are `GIT_ERROR`, not a fabricated no-repository result. Run Git under
  `LC_ALL=C` when classifying these diagnostics. Each subprocess uses remaining
  deadline, at most 2 seconds, bounded output and SIGKILL on timeout.

  Paths must validate explicitly supplied env values as absolute, nonempty paths.
  Unset/empty XDG base variables follow the XDG fallback; an explicitly empty or
  relative `RELAY_STATE_DIR` is invalid. `paths()` performs no filesystem writes.

- [x] Test same PID/new start, changed boot, zombie, unreadable proc, foreign host,
  absent boot, unsafe tty with otherwise usable process proof, ancestor loops,
  missing/ambiguous terminal candidates and Git timeout. Use injected readText,
  runPs and kill functions; no test reads a guessed unrelated live PID. Run
  `just test-fast`, `tasks check`; commit `feat: extract qualified process identity`.

### Phase 3: Normalize the twenty event mappings without presentation

**Files:** adapter files, `test/{payload,claude-code,codex,opencode}.test.js`.

**Produces:** adapterFor, normalizeEvent and readNativeInput. The normalizer performs
no process, Git, filesystem or subscriber work.

- [x] Port the three adapter suites and replace familiar-theme STATES imports
  with relay's vocabulary. Replace the adapter shape test's cosmetic-flag
  requirement with the events table. Use this normalized payload assertion first:

```js
test('Bash input normalizes without persisting native extras', () => {
  const e = normalizeEvent('codex', 'PreToolUse', JSON.stringify({
    session_id: 's:1', cwd: '/repo', hook_event_name: 'PreToolUse',
    tool_name: 'Bash', tool_input: { command: 'echo ok' }, prompt: 'PRIVATE'
  }));
  assert.equal(e.agentId, 'codex:s:1');
  assert.equal(e.kind, 'before-tool');
  assert.equal(e.tool.command, 'echo ok');
  assert.equal(Object.hasOwn(e, 'prompt'), false);
});
```

- [x] Fill each adapter's immutable events table from the parent mapping. Expanded
  rows: Claude eight, Codex six, OpenCode six. `stateForEvent` and normalized kind
  derive from the same table; an unlisted event fails. Retain OpenCode's idle
  reducer: error stays error, active becomes done, otherwise idle. Its kind stays
  `idle`, not `turn-end`. The resolver keeps the exact comm/tty predicate and skips
  index 0; no match returns null. Do not borrow the hook's PID or a shell SID.

```js
// The adapter tables use these exact common entries.
const common = {
  SessionStart: { kind: 'session-start', level: 'idle' },
  UserPromptSubmit: { kind: 'prompt', level: 'working' },
  PreToolUse: { kind: 'before-tool', level: 'working' },
  Stop: { kind: 'turn-end', level: 'done' },
  SessionEnd: { kind: 'session-end', level: null }
};
// Keep these few literal entries in each adapter; index.js imports the adapters.
```

  Parse bytes once with fatal UTF-8 decoding and JSON.parse. Validate root object,
  nonempty session ID, absolute cwd and optional boolean stop_hook_active. No cwd
  fallback to the hook process. If hook_event_name is supplied, require it to agree
  with argv (Claude Notification subtypes agree with base `Notification`). Tool
  events require a nonempty tool_name and an object tool_input; reject scalar or
  array input under the approved Event contract. Other events carry `tool: null`.

  Extract a shell command only from canonical `Bash` plus string
  `tool_input.command`, for Claude and Codex. `apply_patch.command` is patch text
  and must yield `command: null`. Other tools also yield null; do not guess from
  `cmd`, stringify arbitrary arguments, or interpret code-mode source as shell.
  Unknown command-bearing forms remain a coverage obligation in `ops-c8e4d1`.
  The field distinction is documented by the
  [Codex hook reference](https://developers.openai.com/codex/hooks) and
  [Claude hook reference](https://code.claude.com/docs/en/hooks), checked 2026-09-17.
  These fixture shapes do not claim live guard capability.

- [x] Extract the stdin lifecycle from familiar's CLI, but reject on timeout or
  stream error rather than parsing a partial body as success. Count bytes before
  buffering past 4 MiB, require EOF, remove listeners and clear the timer on every
  completion path. Test byte-boundary/multibyte input, invalid UTF-8/JSON, an open
  pipe, stream error, absent cwd, mismatched event, unsupported Interrupt,
  non-command tools and stopHookActive preservation. Iterate every table row and
  assert its literal expected kind/level, not a value computed by the same table.

- [x] Run `just test-fast`, `tasks check`; commit `feat: normalize harness lifecycle events`.

### Phase 4: Implement safe locking and atomic registry transactions

**Files:** `src/bus/{store,lock,prune,transaction}.js`, corresponding tests,
`test/helpers/fixture.js`, `test/fixtures/lock-worker.js`.

**Internal interfaces:** `withLock(path, fn, options)` returns
`Promise<{value, cleanupError: Error | null}>`; options contain ClockOptions,
processOps, `sleep(ms): Promise<void>` (default timer sleep), and a test-only `io`
override for the used fs/promises methods.
`writeJsonAtomic(path, value, options)` and `readJson(path, options)` retain their
source responsibilities; `pruneDead(agents, {probe})` returns
`{agents, reaped, liveness}` without mutating its input. Public read/list/mutation
interfaces are those defined above.

- [x] Port ordinary source store/lock/contention tests before changing behavior.
  Add deterministic tests for the approved lock policy, using a fake clock for
  waiting and an explicit holder-release promise rather than ten-second sleeps.
  This pins the no-live-owner-expiry contract. The addendum contains the separate
  executable reproduction against the old source API:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { utimes } from 'node:fs/promises';
import { withLock } from '../src/bus/lock.js';
import { tempState } from './helpers/fixture.js';

test('an old live owner keeps its critical section', async (t) => {
  const { lockPath } = await tempState(t);
  let signalEntered, release;
  const entered = new Promise((resolve) => { signalEntered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  const holder = withLock(lockPath, async () => {
    signalEntered();
    await held;
  });
  try {
    // An acquisition failure propagates instead of hanging on the entry signal.
    await Promise.race([entered, holder]);
    await utimes(lockPath, new Date(0), new Date(0));
    let fakeNow = 0;
    let enteredSecond = false;
    await assert.rejects(withLock(lockPath, async () => {
      enteredSecond = true;
    }, {
      clock: () => fakeNow, deadline: 50,
      sleep: async (ms) => { fakeNow += ms; }
    }), { code: 'LOCK_TIMEOUT' });
    assert.equal(enteredSecond, false);
  } finally {
    release();
    assert.equal((await holder).cleanupError, null);
  }
  assert.equal((await withLock(lockPath, async () => {})).cleanupError, null);
});
```

  This uses the actual test process's qualified Handle, never a guessed PID.
  Add injected unknown-proof coverage and cover an equally old live guard while
  reclaiming a dead main owner. The fake wait advances elapsed time only; it must
  never change owner liveness. Also require tests for boot-mismatch main-owner
  reclamation, expiry after acquisition releasing without callback entry, and
  cleanup failure both after successful publication and after a callback error.
  Verify the committed result survives the first failure and both errors survive
  the second; inject failures through io.

- [x] Change both lock files to complete JSON tokens
  `{schema:1, nonce:<UUID>, holder:<Handle>}`. Reject old/empty/malformed tokens;
  there is no compatibility reader. Mint a fresh nonce for each acquisition and
  require the writer Handle to have usable local proof. Linux requires boot ID.
  Create the private token file with `flag:'wx', mode:0o600`, await its complete
  write, then atomically link it into the public path. Clean the private name in
  finally. EEXIST alone means contention; other errors propagate.

  After EEXIST on main acquisition, read/validate its owner; ENOENT at this
  initial read means retry acquisition, not malformed state. Live/unknown waits;
  confirmed dead attempts the guard. The guard uses the same atomic token
  publication, but never calls withLock recursively. If occupied, inspect its
  owner: live/unknown waits, dead/malformed throws LOCK_REPAIR_REQUIRED. Once the
  guard is acquired, reread the main token: ENOENT means already free; a changed
  live/unknown owner is left alone; only the currently proven dead token is
  removed. Release the guard, then compete normally. No mtime decision remains.

  Check the deadline before retry and immediately before callback entry; sleep
  at most `min(20ms, remaining)`. After acquiring a lock with an expired deadline,
  release it without entering. Never race the callback against a timer that would
  release its lock early. On normal release, compare the entire token before
  unlinking. Failure after a successful callback returns value plus cleanupError;
  the transaction can report its committed snapshot honestly. If the callback
  throws, preserve its error and any cleanup error as an AggregateError. Guard
  cleanup failure before callback entry is a visible LOCK_CLEANUP_FAILED.

- [x] Make the state directory privately owned/0700 and new state/control files
  0600. Validate existing leaf directory and files with lstat: reject symlinks,
  wrong owner/type or unsafe modes with a concise IO_ERROR; never chmod unrelated
  parents. Reads do not create/chmod state. Write a unique 0600 temporary snapshot
  in the same directory, then rename. On pre-rename failure preserve the original;
  report cleanup failures too. No fsync/power-loss durability claim.

  Validate before locking, resolve Git and agent process before locking, then
  inside the lock read/validate, prune only dead records, reduce using the latest
  prior state, construct the incoming Agent and publish one canonical Snapshot.
  SessionEnd skips Git/process enrichment and removes only its exact agent ID.
  Resolver/handle work returning no proof or throwing PROCESS_UNREADABLE or
  PROCESS_UNAVAILABLE produces `process:null` and a diagnostic. GIT_ERROR throws;
  do not fabricate a cwd-keyed identity when Git fails. Every other error throws. A missing Linux boot ID is represented as
  null and its liveness stays unknown. Timestamps come from injected now at write
  time; no creation timestamp is guessed from the process start token.

  Every upsert is an observed event and increments revision, including repeated
  state. Removal/reap only publishes if its key set changes. If no snapshot exists
  and there is nothing to remove, return null/unchanged without creating a snapshot.
  `readSnapshot` and `listAgents` never prune, acquire a writer lock, or change
  bytes. `reapRegistry` returns a result even on no change, so R2 can always request
  reconciliation. It emits no Event and invokes no guard or subscriber in R1.

- [x] Use this complete helper and transaction test as the first cross-module
  acceptance check. The resolver override is a test seam; production never uses
  the test process as a fallback harness identity.

```js
// test/helpers/fixture.js
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../../src/bus/paths.js';
export async function tempState(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'relay-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  return paths({ RELAY_STATE_DIR: stateDir });
}
export const localObservation = (p) => ({
  paths: p, resolveAgentPid: () => process.pid,
  gitContext: async () => ({ remote: null, repoRoot: null })
});
```

```js
// In test/transaction.test.js, with node:test and strict assert imports:
import { readFile } from 'node:fs/promises';
import { normalizeEvent } from '../src/adapters/index.js';
import { applyEvent, reapRegistry } from '../src/bus/transaction.js';
import { tempState, localObservation } from './helpers/fixture.js';
test('registry stores identity/state, never the command payload', async (t) => {
  const p = await tempState(t);
  const e = normalizeEvent('claude-code', 'PreToolUse', JSON.stringify({
    session_id: 'test', cwd: '/repo', tool_name: 'Bash',
    tool_input: { command: 'echo PRIVATE_MARKER' }
  }));
  const result = await applyEvent(e, localObservation(p));
  assert.equal(result.snapshot.agents[e.agentId].state, 'working');
  const before = await readFile(p.agentsPath, 'utf8');
  assert.equal(before.includes('PRIVATE_MARKER'), false);
  const reaped = await reapRegistry({ paths: p });
  assert.equal(reaped.changed, false);
  assert.equal(await readFile(p.agentsPath, 'utf8'), before);
});
```

  Add corrupt-state/no-overwrite, arbitrary optional-field stripping, renderer-free
  import, headless process-null admission, resumed process-handle update, duplicate
  raw session IDs across harnesses, generation recreation, and OpenCode reduction
  against concurrent latest state. Port real multiprocess counter and registry
  writer tests; synchronize children over IPC. The lock worker supports increment,
  hold-main and hold-guard modes, uses actual qualified tokens, and reports entry
  before the parent kills it. Main-owner death must recover; guard-owner death
  must return repair-required without snapshot mutation. Preserve old empty-token
  and abandoned-guard cases with their newly approved error expectations.

- [x] Run `just test-fast`, `tasks check`; commit `feat: publish registry snapshots under safe locks`.

### Phase 5: Extract OpenCode server observation and its regression tests

**Files:** the five server modules and four test files in the extraction map.

**Produces:** package subpath `relay/opencode` exporting only the async `Relay`
plugin function, with the existing event/permission.ask/dispose hook object.
Internal createBinding/createWindow/createQueue/spawnHook signatures retain the
source test seams; `createBinding` gains an optional env for its diagnostic path.

- [x] Port the four source suites, preserving literal permission precedence,
  duplicate-ask, subagent-busy, error-before-idle and queue-failure expectations.
  Change the expected plugin export from Familiar to Relay. Verify source
  processing order, including this integration test:

```js
test('queued init precedes work and dispose follows it', async () => {
  const calls = [];
  const binding = createBinding({ directory: '/repo', pid: 42,
    spawn: async (event, payload) => calls.push([event, payload.session_id]),
    report: () => {}
  });
  binding.onEvent({ event: { type: 'session.status', properties: {
    sessionID: 'child', status: { type: 'busy' }
  } } });
  await binding.dispose();
  assert.deepEqual(calls.map(([event]) => event), ['init', 'session.busy', 'dispose']);
  assert.ok(calls.every(([, id]) => id === 'opencode:42'));
});
```

- [x] Copy the modules, replace presentation-specific comments and prefixes, and
  validate directory as absolute. Keep scope process and its raw opencode:PID key;
  the normalized registry key starts `opencode:opencode:`. Preserve this deliberate
  double prefix: parent spec §6 projects Agent.sessionId onto familiar's existing
  intent keys, which are `opencode:<pid>`. Do not
  change the session/window fold or mutate permission output. Ignore redundant
  session.idle exactly as the source does.

  `spawnHook` resolves relay's own `bin/relay.js`, uses shell:false and argv
  `['hook','--harness','opencode',event]`, and inherits the environment. Bound child
  stderr to 64 KiB and child lifetime to five seconds; timeout/error rejects to the
  queue and terminates the child. Sanitize diagnostics so a child cannot cause raw
  native payload/command logging. Keep reporter failure isolated from the queue,
  and add the same protection to synchronous fold-error reporting. Diagnostic
  file is relay state's `opencode-plugin.log`, privately created; messages contain
  event/error codes, not payloads. `dispose` remains last and awaited.

  Test spawning via injected executable/args using disposable children. The actual
  relay hook command remains unsupported until R2; document this plugin as
  extracted/tested but not yet installable. Do not register it, add a direct-store
  bypass, or silently fall back to familiar when the command is unavailable.

- [x] Extend npm test to `node --test test/*.test.js integrations/opencode/*.test.mjs`,
  run `just test-fast`, `tasks check`; commit `feat: extract opencode server observation`.

### Phase 6: Expose the CLI/package and document bounded repair

**Files:** `src/index.js`, `bin/relay.js`, package files, `test/{cli,pack}.test.js`,
`docs/api.md`, `docs/runbooks/registry-lock-repair.md`, README/AGENTS.

- [ ] Add CLI tests using child processes with temporary RELAY_STATE_DIR and config
  roots. Cover an absent snapshot without directory creation, populated listing,
  corrupt/unknown schema, reap with dead/unknown/live entries, and command errors.
  The missing-snapshot response is exactly:

```json
{"snapshot":null,"liveness":{}}
```

  `list --json` failure writes exactly one JSON envelope to stdout and exits 1:

```json
{"error":{"code":"CORRUPT_STATE","message":"cannot read registry JSON"}}
```

- [ ] Implement only `--help`, `list --json`, and `reap`. Reap success prints
  `Reaped N agent(s).` and diagnostics go to stderr. Invalid/extra arguments exit 1;
  hook/install explicitly report FEATURE_UNAVAILABLE. List errors use the envelope
  above; non-JSON commands use concise stderr. A post-publication lock-cleanup
  error exits nonzero while explicitly stating that publication completed; it must
  never invite a blind retry by claiming the snapshot was rolled back.

  Export exactly the root functions listed in Interfaces. Package additions:

```json
{
  "bin": { "relay": "bin/relay.js" },
  "exports": {
    ".": "./src/index.js",
    "./opencode": "./integrations/opencode/plugin.js",
    "./fixtures/handles.json": "./test/fixtures/handles.json"
  },
  "files": ["bin/", "src/", "integrations/opencode/*.js",
    "test/fixtures/handles.json", "docs/api.md",
    "docs/runbooks/registry-lock-repair.md", "LICENSE"]
}
```

  Give the CLI its Node shebang/executable bit. Verify `npm pack --dry-run --json`
  includes the documented files and excludes all worker/test executables, state,
  tasks and private config. Install the actual tarball in an isolated temporary
  project, import the named root exports, parse the exported JSON fixture, inspect
  the plugin's sole export, and run the installed CLI. This tests local packaging;
  remote/tag portability remains `relay-c19c0a`. No lifecycle/prepare install script.

- [ ] Write docs/api.md from the exact Interfaces section and record the fixture's
  Git revision after commit. Explain missing versus corrupt state, generation/
  revision, no replay/TTL, readonly listing, no raw payload persistence, and partial
  R1 CLI status. Document errors and the safe-integer case as format coverage.
  State that an existing 0755 RELAY_STATE_DIR is rejected with IO_ERROR: callers
  must supply a private 0700 directory; relay does not silently chmod it.

  Repair runbook: first prevent new hook invocations and stop all relay writers;
  perform this from an ordinary operator shell outside affected harness sessions.
  Inspect the installed configs and process ancestry; process names alone are
  insufficient evidence of quiescence. If quiescence cannot be established, stop.
  Read tokens for diagnosis, preserve agents.json, then use the package's paths
  function to remove exactly the two control files. The following command is only
  run after that operator precondition, never automatically on a hook error:

```sh
node --input-type=module <<'JS'
import { unlink } from 'node:fs/promises';
import { paths } from 'relay';
const { lockPath, reclaimPath } = paths();
for (const path of [lockPath, reclaimPath]) {
  try { await unlink(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
JS
relay list --json
relay reap
```

  Run from the installed package's module-resolution context; apply any configured
  RELAY_STATE_DIR override consistently. Restore hook configuration and begin fresh
  sessions only after verification. Listing/reaping does not prove guards or
  terminal reconciliation work. Temporary token files are not automatically swept
  by pattern; clean them only under the same quiescence condition if necessary.

- [ ] Run `just gate` and the tarball smoke test. Verify on Node 22 as well as the
  development Node version. Node 22.23.2 is available at
  `~/.nvm/versions/node/v22.23.2/bin/node`; run the front door with its bin directory
  prepended to PATH. If no physical Darwin runner is available, record that exact
  unverified platform requirement for the release/cutover gate instead of claiming it ran.
  Linux live process and IPC tests must run here. No live harness probe belongs to
  this task because no hook is enabled.

- [ ] Update README and both local doc status headers from verified results,
  record measured tests and package smoke evidence, and complete relay-06b1da in
  the same commit as its final changes. Use `feat: expose relay registry package`.
  Run `tasks check` before committing; integrate the reviewed local branch and
  harvest `tt-report` before clean worktree removal.

## Handoff and scope verification

- `relay-4c4828` receives normalized Event plus the separate optional applyEvent
  path. It must implement reply/capability tests, guard-first ordering, shared
  invocation budgets, sanitized observer envelopes and reconciliation delivery.
  Wire CLI reap to notify observers on every successful result, even unchanged;
  use null generation/revision when the snapshot is absent. Never fabricate a
  harness event or run a guard during that notification. R1 deliberately provides
  the result rather than an empty dispatch implementation.
- `relay-baa816` receives the package/plugin entry paths and repair runbook; no
  installer exists yet. `ops-c8e4d1` still owns live tool-shape/denial proof.
- `fam-6e8321` receives named process/registry exports and the six-state vocabulary.
  Its presentation locks, store helpers, renderer-key projection and migration
  remain its work. `tasks-c9199a` receives the versioned handle corpus and the
  stable schema, with native Rust liveness unchanged.
- R1 covers parent spec §§3–4 observation ownership, every §5 normalized mapping,
  §7 registry surfaces, and the approved lock addendum. Reply/observer installation,
  consumer migration, remote publication and live cutover remain in their existing
  dependent tasks; no missing R1 requirement is hidden behind ops bootstrap closure.
