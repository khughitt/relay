# Codex model resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `relay model --harness codex` tells a process running inside a Codex tool call which model its turn runs (`codex/<model>`), or answers bare `codex` with a reason.

**Architecture:** A read-only resolver in relay's Codex adapter layer. Codex's private rollout layout (locating a thread's rollout, reading its first record and its last `turn_context`) lives in `src/adapters/codex-rollout.js`. The decision steps (environment, ancestry including pid 1, turn binding) live in `src/adapters/codex-model.js`. The spec records this split ("Where it lives"). The process helper gains a start-time interval accessor, the adapters export their harness predicates, and `bin/relay.js` gains one command branch. The CLI row lands in ops's `cli.toml` first and is adopted here together with the parser change.

**Tech Stack:** Node >=22 ES modules with built-ins only, JSDoc types checked by `tsc --checkJs`, `node:test`. Python unittest in ops for the table.

**Spec:** `docs/specs/2026-10-17-codex-model-resolver.md` (approved 2026-10-17). Executors read the spec and this plan.

## Global Constraints

- Runtime: Node >=22, ES modules, Node built-ins only; no new dependency.
- Every `src/` and `bin/` file starts with `// @ts-check` and passes `just check` (`tsc --checkJs --noEmit`).
- Tests: `just test-one <file or --test-name-pattern args>` while working (it runs `node --test` on its arguments); `just test-fast` before every commit; never call `node --test` or `npm test` directly.
- The command: `relay model --harness codex`; `--harness` accepts only `codex`; pretty is the default output.
- JSON answer keys, in this order: `verified`, `agent`, `harness`, `model`, `effort`, `thread`, `rollout`, `reason`.
- Reasons (unverified, exit 0): `no-thread`, `not-under-codex`, `no-rollout`, `ambiguous-rollout`, `no-turn-context`, `scan-limit`, `earlier-turn`, `turn-boundary`.
- Failures (exit 1, kind `model_failed`): `INVALID_INPUT`, `INVALID_CONFIG`, `IO_ERROR`, `PROCESS_UNREADABLE`, `INVALID_ROLLOUT` (new). Usage errors exit 2.
- Pretty unverified stderr line: `relay: model unverified (<reason>): <detail>`.
- Scan limit 64 MiB; read block 64 KiB; clock allowance `m` = 1000 ms; Linux start interval `lo = w0 − age − 11`, `hi = w1 − age + 11` (ms); Darwin `lo = lstart × 1000`, `hi = lo + 999`.
- Store: `$CODEX_HOME` when set (must be absolute), else `$HOME/.codex`.
- A `turn_context` whose `payload.effort` is absent or `null` carries no effort (answer `effort: null`); any other non-string value is `INVALID_ROLLOUT` (spec step 7).
- Conventional commits, no AI attribution. Paths in docs are repository-relative.
- ops's `cli.toml` is never edited in relay; `tools/cli.toml` changes only through `vendored adopt`.

## Review Focus

1. The suite itself running inside a Codex tool call or a Claude Code session: inherited `CODEX_THREAD_ID`, `RELAY_FORMAT` or harness ancestry must not change any test's outcome. Covered in Task 6 (CLI tests scrub `CODEX_*` and `RELAY_FORMAT` and run relay under a `codex`-named parent).
2. Records longer than one 64 KiB read block (a large `session_meta` first line; a `turn_context` carrying long instructions) must parse across block boundaries. Covered in Task 4 (200 KiB first line; 16-byte blocks for the backward scan).
3. A rollout whose last line is a write in progress, a file that is one unterminated line, and an empty file: skip the partial line, and fail `INVALID_ROLLOUT` when there is no complete first record. Covered in Task 4.
4. Neither `CODEX_HOME` nor `HOME` usable (unset, empty or relative): a typed `INVALID_CONFIG` failure, never a crash or a guessed path. Covered in Task 4.
5. A store directory that exists but cannot be read (EACCES): `IO_ERROR`, never a silent `no-rollout`. Covered in Task 4.

---

### Task 1: Land the `model` row in ops's `cli.toml`

relay's parser surface test compares `src/commands.js` with `tools/cli.toml`, which is adopted from ops's default branch. The row must land in ops first.

**Files (in the ops repository, not relay):**
- Modify: `cli.toml`, the `[cli.relay]` rows, directly after the `path = ["presence"]` row.

**Interfaces:**
- Produces: a landed ops commit whose `[cli.relay]` rows include `model`, for Task 6's `vendored adopt`.

- [ ] **Step 1: File and start the ops task, then create its worktree**

Run from the ops main checkout (`OPS="$(tasks --pretty root ops-88a0fa)"`):

```bash
cd "$OPS"
tasks add "Add relay's model command row to cli.toml" --process direct --size xs --complexity low -p 2 \
  --source "relay:docs/specs/2026-10-17-codex-model-resolver.md" \
  -b "relay-2cd4b1 adds relay model --harness codex; its row lands here before relay adopts the table."
work-link --ensure .worktrees
git worktree add .worktrees/relay-model-row -b feat/relay-model-row
git worktree lock --reason "on WORK_ROOT storage (host: $(uname -n))" .worktrees/relay-model-row
cd .worktrees/relay-model-row && just setup
tasks start <the new ops id>
```

Follow ops's own AGENTS.md for anything it adds to this sequence.

- [ ] **Step 2: Add the row**

Insert after the `presence` row (whose last line is `args = [{ name = "mode", value = "enum", values = ["here", "away"], required = false }]`):

```toml

[[cli.relay.commands]]
path = ["model"]
summary = "The model a Codex tool call's turn runs, read from its rollout"
options = [
  { shared = "harness", role = "select", value = "enum", values = ["codex"], required = true, repeatable = false },
]
```

- [ ] **Step 3: Run ops's table tests**

Run: `just test-one tests.test_cli`
Expected: PASS (a subset of the shared `harness` values is allowed: `tests/test_cli.py` rejects only values outside the vocabulary set).

- [ ] **Step 4: Run the fast suite and commit**

```bash
just test-fast
git add cli.toml
git commit -m "feat(cli): declare relay's model command"
```

- [ ] **Step 5: Close the task and land it on ops's default branch**

```bash
tasks done <ops id> "relay's model row landed in cli.toml"
cd "$OPS" && git merge --ff-only feat/relay-model-row
```

ops is a personal checkout, and the table is adopted, not live, so a local fast-forward merge is in scope. Do not push. Then remove the ops worktree by the global removal rules: `tt-report`, check ignored files, `git worktree unlock`, `git worktree remove`.

---

### Task 2: Start-time interval in the process helper

**Files:**
- Modify: `src/bus/proc.js` (`createProcessOps` options and return value)
- Test: `test/proc.test.js` (append)

**Interfaces:**
- Produces: `ops.startedAtMs(row: ProcessRow) → {lo: number, hi: number}` (wall-clock ms), and the `createProcessOps` option `now?: () => number` (default `Date.now`).

- [ ] **Step 1: Write the failing tests**

Append to `test/proc.test.js` (its imports already include `test`, `assert` and `createProcessOps`):

```js
// Spec docs/specs/2026-10-17-codex-model-resolver.md, "Start-time interval".
const BOOT = 1_800_000_000_000;
const linuxClock = ({ uptimeMs, wall }) => {
  const reads = [...wall];
  return createProcessOps({ platform: 'linux', now: () => /** @type {number} */ (reads.shift()),
    readText: (p) => { if (p === '/proc/uptime') return `${(uptimeMs / 1000).toFixed(2)} 0.00\n`; throw Object.assign(new Error('absent'), { code: 'ENOENT' }); } });
};
const startRow = (starttime) => ({ pid: 7, ppid: 1, comm: 'sh', tty: null, starttime, state: 'S' });
test('Linux start interval: no pause between the reads gives the tick uncertainty alone', () => {
  const ops = linuxClock({ uptimeMs: 130_000, wall: [BOOT + 130_000, BOOT + 130_000] });
  assert.deepEqual(ops.startedAtMs(startRow('10000')), { lo: BOOT + 99_989, hi: BOOT + 100_011 });
});
test('Linux start interval: a pause between the reads widens the interval instead of shifting it', () => {
  const ops = linuxClock({ uptimeMs: 130_000, wall: [BOOT + 130_000, BOOT + 131_200] });
  assert.deepEqual(ops.startedAtMs(startRow('10000')), { lo: BOOT + 99_989, hi: BOOT + 101_211 });
});
test('Darwin start interval is the recorded second', () => {
  assert.deepEqual(createProcessOps({ platform: 'darwin' }).startedAtMs(startRow('1800000100')), { lo: 1_800_000_100_000, hi: 1_800_000_100_999 });
});
test('an unreadable or malformed uptime, or an unsafe start, is PROCESS_UNREADABLE', () => {
  const withText = (readText) => createProcessOps({ platform: 'linux', now: () => BOOT, readText });
  assert.throws(() => withText(() => 'garbage\n').startedAtMs(startRow('1')), { code: 'PROCESS_UNREADABLE' });
  assert.throws(() => withText(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }).startedAtMs(startRow('1')), { code: 'PROCESS_UNREADABLE' });
  assert.throws(() => withText(() => '1.00 0.00\n').startedAtMs(startRow('9007199254740993')), { code: 'PROCESS_UNREADABLE' });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `just test-one test/proc.test.js`
Expected: FAIL with `ops.startedAtMs is not a function`.

- [ ] **Step 3: Implement**

In `src/bus/proc.js`, extend the `createProcessOps` JSDoc `@param` object type with `now?: () => number` and its destructuring with `now = Date.now`:

```js
/** @param {{platform?: string, readText?: (path: string) => string, readLink?: (path: string) => string, runPs?: typeof runDarwinPs, runLsof?: typeof runDarwinLsof, kill?: (pid: number, signal: number) => unknown, hostname?: () => string, now?: () => number}} [options] */
export function createProcessOps({ platform = process.platform, readText = (p) => readFileSync(p, 'utf8'),
  readLink = (p) => readlinkSync(p), runPs = runDarwinPs, runLsof = runDarwinLsof, kill = (pid, signal) => process.kill(pid, signal), hostname = osHostname, now = Date.now } = {}) {
```

Add before the `return`, and add `startedAtMs` to the returned object:

```js
  // A start as a wall-clock interval (spec docs/specs/2026-10-17-codex-model-resolver.md,
  // "Start-time interval"). Linux keeps a start only on the boot clock, in USER_HZ (100) ticks;
  // one uptime sample bracketed by two wall-clock reads places it however long a pause lasts.
  // Darwin's lstart is the recorded wall-clock start, truncated to the second.
  /** @param {import("../types.js").ProcessRow} row @returns {{lo: number, hi: number}} */
  const startedAtMs = (row) => {
    const start = Number(row.starttime);
    if (!Number.isSafeInteger(start)) throw relayError('PROCESS_UNREADABLE', 'process start out of range');
    if (platform === 'darwin') return { lo: start * 1000, hi: start * 1000 + 999 };
    const w0 = now();
    let text;
    try { text = readText('/proc/uptime'); }
    catch (cause) { throw relayError('PROCESS_UNREADABLE', 'cannot read uptime', cause); }
    const w1 = now();
    const match = typeof text === 'string' ? /^([0-9]+)\.([0-9]{2}) /.exec(text) : null;
    if (!match) throw relayError('PROCESS_UNREADABLE', 'invalid uptime');
    const ageMs = Number(match[1]) * 1000 + Number(match[2]) * 10 - start * 10;
    return { lo: w0 - ageMs - 11, hi: w1 - ageMs + 11 };
  };
  return { recordOf, ancestors, handleOf, probe, executableOf, argvOf, startedAtMs };
```

- [ ] **Step 4: Run the tests and the checks**

Run: `just test-one test/proc.test.js`, then `just check`
Expected: PASS; `tsc` clean.

- [ ] **Step 5: Commit**

```bash
just test-fast
git add src/bus/proc.js test/proc.test.js
git commit -m "feat(proc): give a process start as a wall-clock interval"
```

---

### Task 3: Adapters export their harness predicates; `nearestHarness`

**Files:**
- Modify: `src/adapters/claude-code.js` (`resolveSessionPid`), `src/adapters/codex.js` (`resolveSessionPid`), `src/adapters/opencode.js` (`resolveSessionPid`), `src/adapters/index.js`, `src/types.js` (`Adapter` typedef)
- Test: `test/ancestry.test.js` (append)

**Interfaces:**
- Produces: each adapter's `isHarness(row: ProcessRow, ops: {executableOf: (pid: number) => string}) → boolean`; `nearestHarness(chain: ProcessRow[], ops: {executableOf}) → {harness: string, index: number} | null` exported from `src/adapters/index.js`. It skips index 0 (the caller itself).

- [ ] **Step 1: Write the failing tests**

In `test/ancestry.test.js`, change the import to `import { adapterFor, nearestHarness } from '../src/adapters/index.js';` and append:

```js
// Spec docs/specs/2026-10-17-codex-model-resolver.md, "Resolution" step 3.
const hrow = (pid, comm) => ({ pid, ppid: pid - 1, comm, tty: null, starttime: '1', state: 'S' });
const noExecutable = { executableOf: () => { throw new Error('executable must not be read'); } };
test('nearestHarness finds the nearest harness of any kind and never the caller itself', () => {
  assert.deepEqual(nearestHarness([hrow(9, 'codex'), hrow(8, 'bash'), hrow(7, 'codex')], noExecutable), { harness: 'codex', index: 2 });
  assert.deepEqual(nearestHarness([hrow(9, 'node'), hrow(8, 'claude'), hrow(7, 'codex')], noExecutable), { harness: 'claude-code', index: 1 });
  assert.deepEqual(nearestHarness([hrow(9, 'node'), hrow(8, 'opencode')], noExecutable), { harness: 'opencode', index: 1 });
  assert.equal(nearestHarness([hrow(9, 'node'), hrow(8, 'bash'), hrow(2, 'systemd')], noExecutable), null);
});
test('nearestHarness counts a versioned Claude binary only under claude/versions/', () => {
  const chain = [hrow(9, 'node'), hrow(8, '2.1.280'), hrow(7, 'codex')];
  assert.deepEqual(nearestHarness(chain, { executableOf: () => '/home/u/.local/share/claude/versions/2.1.280' }), { harness: 'claude-code', index: 1 });
  assert.deepEqual(nearestHarness(chain, { executableOf: () => '/usr/bin/other' }), { harness: 'codex', index: 2 });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `just test-one test/ancestry.test.js`
Expected: FAIL with `nearestHarness is not a function` (an import error).

- [ ] **Step 3: Implement**

`src/types.js`: in the `Adapter` typedef, add a member after `resolveSessionPid: …,`:

```
isHarness: (row: ProcessRow, ops: {executableOf: (pid: number) => string}) => boolean,
```

`src/adapters/claude-code.js`: replace the inline predicate.

```js
/** A Claude Code process: `claude`, or a versioned binary under claude/versions/. */
/** @type {import("../types.js").Adapter["isHarness"]} */
export const isHarness = (row, { executableOf }) => row.comm === 'claude'
  || (VERSION_COMM.test(row.comm) && executableOf(row.pid).endsWith(`/claude/versions/${row.comm}`));
/** @param {import("../types.js").AncestryOptions} [options] */
export function resolveSessionPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid),
  executableOf = (pid) => ops().executableOf(pid), argvOf = (pid) => ops().argvOf(pid) } = {}) {
  return nearestSessionPid(ancestors(startPid), { isHarness: (row) => isHarness(row, { executableOf }), roles: ROLES, argvOf });
}
```

`src/adapters/codex.js`:

```js
/** @type {import("../types.js").Adapter["isHarness"]} */
export const isHarness = (row) => row.comm === 'codex';
/** @param {import("../types.js").AncestryOptions} [options] */
export function resolveSessionPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid) } = {}) {
  return nearestSessionPid(ancestors(startPid), { isHarness: (row) => isHarness(row, { executableOf: () => '' }) });
}
```

`src/adapters/opencode.js`: the same shape with `'opencode'`.

`src/adapters/index.js`, after `adapterFor`:

```js
// The nearest process any adapter recognises, skipping index zero (the caller itself).
// Spec docs/specs/2026-10-17-codex-model-resolver.md, "Resolution" step 3.
/** @param {import("../types.js").ProcessRow[]} chain @param {{executableOf: (pid: number) => string}} ops @returns {{harness: string, index: number}|null} */
export function nearestHarness(chain, ops) {
  for (let index = 1; index < chain.length; index++) {
    for (const [harness, adapter] of Object.entries(adapters)) if (adapter.isHarness(chain[index], ops)) return { harness, index };
  }
  return null;
}
```

- [ ] **Step 4: Run the tests and the checks**

Run: `just test-one test/ancestry.test.js test/claude-code.test.js test/codex.test.js test/opencode.test.js`, then `just check`
Expected: PASS (the existing corpus tests pin that `resolveSessionPid` behaves as before); `tsc` clean.

- [ ] **Step 5: Commit**

```bash
just test-fast
git add src/adapters src/types.js test/ancestry.test.js
git commit -m "refactor(adapters): export each harness predicate and find the nearest harness"
```

---

### Task 4: Read Codex's rollout layout

**Files:**
- Create: `src/adapters/codex-rollout.js`
- Create: `test/helpers/codex-store.js`
- Test: `test/codex-rollout.test.js`

**Interfaces:**
- Produces (from `src/adapters/codex-rollout.js`):
  - `UUID_V7: RegExp`, `SCAN_LIMIT = 67108864`
  - `storeRoot(env: NodeJS.ProcessEnv) → string`
  - `dayOf(thread: string, timeZone?: string) → [string, string, string]`
  - `listDir(dir: string) → string[] | null`
  - `locateRollout(root: string, thread: string, {timeZone?, list?}) → string[]`
  - `firstRecord(path: string, {limit?, block?}) → any`
  - `lastTurnContext(path: string, {limit?, block?}) → {record: Record<string, any>|null, limited: boolean}`
  - `turnFields(record) → {model: string, effort: string|null, at: number}`
- Produces (from `test/helpers/codex-store.js`): `threadAt(ms) → string`, `record(type, payload, timestamp?) → string`, `sessionMeta(id) → string`, `turnContext(model, timestamp, effort?) → string`, `tempStore(t) → {root, day(parts, thread, lines, opts?), archived(thread, lines, opts?)}`.

- [ ] **Step 1: Write the test helper**

`test/helpers/codex-store.js`:

```js
// Fixture Codex stores for the model resolver's tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A UUIDv7 whose timestamp is `ms`. @param {number} ms */
export const threadAt = (ms) => { const hex = ms.toString(16).padStart(12, '0'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7abc-8def-0123456789ab`; };
/** One rollout line. @param {string} type @param {Record<string, unknown>} payload @param {string} [timestamp] */
export const record = (type, payload, timestamp = '2026-10-17T10:00:00.000Z') => JSON.stringify({ timestamp, type, payload });
/** @param {string} id */
export const sessionMeta = (id) => record('session_meta', { id, cwd: '/w', base_instructions: { text: 'x'.repeat(100) } });
/** A turn_context with an effort; build one without the field through `record` directly. @param {string} model @param {string} timestamp @param {string|null} [effort] */
export const turnContext = (model, timestamp, effort = 'high') => record('turn_context', { turn_id: 't', model, effort }, timestamp);

/** A temporary store; files are named rollout-<stamp>-<thread>.jsonl. @param {import('node:test').TestContext} t */
export function tempStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-codex-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  /** @param {string} dir @param {string} thread @param {string[]} lines @param {{trailingNewline?: boolean, stamp?: string}} [options] */
  const write = (dir, thread, lines, { trailingNewline = true, stamp = '2026-10-17T06-00-00' } = {}) => {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-${stamp}-${thread}.jsonl`);
    fs.writeFileSync(file, lines.join('\n') + (trailingNewline ? '\n' : ''));
    return file;
  };
  return { root,
    /** @param {string[]} parts @param {string} thread @param {string[]} lines @param {{trailingNewline?: boolean, stamp?: string}} [options] */
    day: (parts, thread, lines, options) => write(path.join(root, 'sessions', ...parts), thread, lines, options),
    /** @param {string} thread @param {string[]} lines @param {{trailingNewline?: boolean, stamp?: string}} [options] */
    archived: (thread, lines, options) => write(path.join(root, 'archived_sessions'), thread, lines, options) };
}
```

- [ ] **Step 2: Write the failing tests**

`test/codex-rollout.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { storeRoot, dayOf, listDir, locateRollout, firstRecord, lastTurnContext, turnFields, UUID_V7 } from '../src/adapters/codex-rollout.js';
import { tempStore, threadAt, record, sessionMeta, turnContext } from './helpers/codex-store.js';

const AT = Date.parse('2026-10-17T02:30:00.000Z');
const thread = threadAt(AT);

test('a fixture thread id is a UUIDv7 and names its own day', () => {
  assert.match(thread, UUID_V7);
  assert.deepEqual(dayOf(thread, 'UTC'), ['2026', '10', '17']);
  assert.deepEqual(dayOf(thread, 'America/New_York'), ['2026', '10', '16']);
});
test('storeRoot: CODEX_HOME when set and absolute, else HOME/.codex; anything else is INVALID_CONFIG', () => {
  assert.equal(storeRoot({ CODEX_HOME: '/x/codex', HOME: '/h' }), '/x/codex');
  assert.equal(storeRoot({ HOME: '/h' }), path.join('/h', '.codex'));
  for (const env of [{ CODEX_HOME: 'rel' }, { CODEX_HOME: '' }, {}, { HOME: '' }, { HOME: 'rel' }])
    assert.throws(() => storeRoot(env), { code: 'INVALID_CONFIG' }, JSON.stringify(env));
});
test('locateRollout lists only the day directory when it holds the rollout', (t) => {
  const store = tempStore(t), file = store.day(['2026', '10', '17'], thread, [sessionMeta(thread)]);
  const listed = [];
  assert.deepEqual(locateRollout(store.root, thread, { timeZone: 'UTC', list: (dir) => { listed.push(dir); return listDir(dir); } }), [file]);
  assert.deepEqual(listed, [path.join(store.root, 'sessions', '2026', '10', '17')]);
});
test('locateRollout scans the store after a miss: another day, or archived', (t) => {
  const store = tempStore(t), elsewhere = store.day(['2026', '10', '16'], thread, [sessionMeta(thread)]);
  assert.deepEqual(locateRollout(store.root, thread, { timeZone: 'UTC' }), [elsewhere]);
  const other = threadAt(AT + 1), archived = store.archived(other, [sessionMeta(other)]);
  assert.deepEqual(locateRollout(store.root, other, { timeZone: 'UTC' }), [archived]);
});
test('locateRollout returns every match of the pass that found any, and none for an absent store', (t) => {
  const store = tempStore(t);
  assert.deepEqual(locateRollout(store.root, thread, { timeZone: 'UTC' }), []);
  store.day(['2026', '10', '17'], thread, [sessionMeta(thread)]);
  store.day(['2026', '10', '17'], thread, [sessionMeta(thread)], { stamp: '2026-10-17T07-00-00' });
  assert.equal(locateRollout(store.root, thread, { timeZone: 'UTC' }).length, 2);
});
test('an unreadable store directory is IO_ERROR, never an absent rollout', { skip: process.getuid?.() === 0 && 'root reads any directory' }, (t) => {
  const store = tempStore(t), sessions = path.join(store.root, 'sessions');
  fs.mkdirSync(sessions); fs.chmodSync(sessions, 0o000);
  try { assert.throws(() => locateRollout(store.root, thread, { timeZone: 'UTC' }), { code: 'IO_ERROR' }); }
  finally { fs.chmodSync(sessions, 0o700); }
});
test('firstRecord reads a first line longer than one block; no complete first line is INVALID_ROLLOUT', (t) => {
  const store = tempStore(t);
  const long = record('session_meta', { id: thread, pad: 'y'.repeat(200 * 1024) });
  assert.equal(firstRecord(store.day(['a', 'b', 'c'], thread, [long, turnContext('m', '2026-10-17T10:00:00.000Z')])).payload.id, thread);
  assert.throws(() => firstRecord(store.day(['d', 'e', 'f'], thread, [], { trailingNewline: false })), { code: 'INVALID_ROLLOUT' });
  assert.throws(() => firstRecord(store.day(['g', 'h', 'i'], thread, [long], { trailingNewline: false })), { code: 'INVALID_ROLLOUT' });
});
test('lastTurnContext returns the last turn_context, which in a forked child is its own', (t) => {
  const store = tempStore(t);
  const file = store.day(['a', 'b', 'c'], thread, [sessionMeta(thread), sessionMeta('parent'), turnContext('gpt-6-luna', '2026-10-17T09:00:00.000Z'),
    turnContext('gpt-6-astra', '2026-10-17T10:00:00.000Z'), record('event_msg', { type: 'task_started' })]);
  assert.equal(lastTurnContext(file).record?.payload.model, 'gpt-6-astra');
});
test('lastTurnContext skips a final line still being written, and handles records longer than a block', (t) => {
  const store = tempStore(t);
  const partial = turnContext('gpt-6-sol', '2026-10-17T11:00:00.000Z').slice(0, 40);
  const file = store.day(['a', 'b', 'c'], thread, [sessionMeta(thread), turnContext('gpt-6-astra', '2026-10-17T10:00:00.000Z'), partial], { trailingNewline: false });
  assert.equal(lastTurnContext(file).record?.payload.model, 'gpt-6-astra');
  assert.equal(lastTurnContext(file, { block: 16 }).record?.payload.model, 'gpt-6-astra');
  const one = store.day(['d', 'e', 'f'], thread, [turnContext('m', '2026-10-17T10:00:00.000Z')], { trailingNewline: false });
  assert.deepEqual(lastTurnContext(one), { record: null, limited: false });
});
test('lastTurnContext: an invalid line in range fails; none at all, or none within the limit, are told apart', (t) => {
  const store = tempStore(t);
  const broken = store.day(['a', 'b', 'c'], thread, [sessionMeta(thread), '{oops', record('event_msg', {})]);
  assert.throws(() => lastTurnContext(broken), { code: 'INVALID_ROLLOUT' });
  const none = store.day(['d', 'e', 'f'], thread, [sessionMeta(thread), record('event_msg', {})]);
  assert.deepEqual(lastTurnContext(none), { record: null, limited: false });
  const pad = record('event_msg', { pad: 'z'.repeat(600) });
  const far = store.day(['g', 'h', 'i'], thread, [sessionMeta(thread), turnContext('m', '2026-10-17T10:00:00.000Z'), pad, pad]);
  assert.deepEqual(lastTurnContext(far, { limit: 1024 }), { record: null, limited: true });
  assert.equal(lastTurnContext(far).record?.payload.model, 'm');
});
// Review regression: both readers once re-copied the growing record on every block, which is
// quadratic (a 64 MiB record copied 32 GiB). With 4 KiB blocks a 16 MiB record would copy
// 32 GiB that way; read linearly it takes well under a second. The reads are synchronous,
// which would block node:test's own timeout, so they run in a child killed after 5 s.
test('records of many blocks are assembled once', (t) => {
  const store = tempStore(t), big = 'w'.repeat(16 * 1024 * 1024);
  const tc = record('turn_context', { model: 'big', effort: 'high', pad: big }, '2026-10-17T10:00:00.000Z');
  const file = store.day(['a', 'b', 'c'], thread, [record('session_meta', { id: thread, pad: big }), tc, record('event_msg', {})]);
  const reader = new URL('../src/adapters/codex-rollout.js', import.meta.url).href;
  const script = `import { firstRecord, lastTurnContext } from ${JSON.stringify(reader)};
const [file] = process.argv.slice(1);
process.stdout.write(JSON.stringify([firstRecord(file, { block: 4096 }).payload.id, lastTurnContext(file, { block: 4096 }).record?.payload.model]));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, file], { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' });
  assert.equal(r.signal, null, 'the reads must finish within 5 s');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [thread, 'big']);
});
test('turnFields validates the model, effort and timestamp', () => {
  const parse = (line) => turnFields(JSON.parse(line));
  assert.deepEqual(parse(turnContext('gpt-6-astra', '2026-10-17T10:00:00.000Z')), { model: 'gpt-6-astra', effort: 'high', at: Date.parse('2026-10-17T10:00:00.000Z') });
  assert.equal(parse(record('turn_context', { model: 'm' }, '2026-10-17T10:00:00Z')).effort, null);
  assert.equal(parse(turnContext('m', '2026-10-17T10:00:00Z', null)).effort, null);
  assert.throws(() => parse(turnContext('', '2026-10-17T10:00:00Z')), { code: 'INVALID_ROLLOUT' });
  assert.throws(() => parse(record('turn_context', { model: 'm', effort: 3 })), { code: 'INVALID_ROLLOUT' });
  assert.throws(() => parse(turnContext('m', '2026-10-17T10:00:00+02:00')), { code: 'INVALID_ROLLOUT' });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `just test-one test/codex-rollout.test.js`
Expected: FAIL with `Cannot find module '…/src/adapters/codex-rollout.js'`.

- [ ] **Step 4: Implement**

`src/adapters/codex-rollout.js`:

```js
// @ts-check
// Codex's private rollout layout, read only. Observed on Codex 0.162.1 and 0.163.0; not a
// documented contract. Spec: docs/specs/2026-10-17-codex-model-resolver.md, "Resolution" steps 4-8.
import { readdirSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { relayError } from '../protocol.js';

export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const SCAN_LIMIT = 64 * 1024 * 1024;
const BLOCK = 64 * 1024;
const NEWLINE = 0x0a;
const ISO_UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;

/** The store: CODEX_HOME when set, else HOME/.codex. Each must be absolute. @param {NodeJS.ProcessEnv} env */
export function storeRoot(env) {
  if (env.CODEX_HOME !== undefined) {
    if (!isAbsolute(env.CODEX_HOME)) throw relayError('INVALID_CONFIG', 'CODEX_HOME must be an absolute path');
    return env.CODEX_HOME;
  }
  if (!env.HOME || !isAbsolute(env.HOME)) throw relayError('INVALID_CONFIG', 'CODEX_HOME is unset and HOME is not an absolute path');
  return join(env.HOME, '.codex');
}

/** The local date of a UUIDv7's timestamp: the rollout's day directory. @param {string} thread @param {string} [timeZone] @returns {[string, string, string]} */
export function dayOf(thread, timeZone) {
  const ms = Number.parseInt(thread.slice(0, 8) + thread.slice(9, 13), 16);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  /** @param {string} type */
  const part = (type) => /** @type {Intl.DateTimeFormatPart} */ (parts.find((p) => p.type === type)).value;
  return [part('year'), part('month'), part('day')];
}

/** A directory's entries, or null when it is absent. @param {string} dir @returns {string[]|null} */
export function listDir(dir) {
  try { return readdirSync(dir); }
  catch (caught) {
    const error = /** @type {import("../types.js").Failure} */ (caught);
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw relayError('IO_ERROR', `cannot list ${dir}`, error);
  }
}

/** Every rollout of `thread`: the UUIDv7 day directory first, the whole store only after a miss.
 * @param {string} root @param {string} thread @param {{timeZone?: string, list?: (dir: string) => string[]|null}} [options] */
export function locateRollout(root, thread, { timeZone, list = listDir } = {}) {
  const suffix = `-${thread}.jsonl`;
  /** @param {string} dir */
  const matches = (dir) => (list(dir) ?? []).filter((name) => name.startsWith('rollout-') && name.endsWith(suffix)).map((name) => join(dir, name));
  const sessions = join(root, 'sessions');
  const first = matches(join(sessions, ...dayOf(thread, timeZone)));
  if (first.length > 0) return first;
  /** @type {string[]} */
  const found = [];
  for (const year of list(sessions) ?? []) for (const month of list(join(sessions, year)) ?? [])
    for (const day of list(join(sessions, year, month)) ?? []) found.push(...matches(join(sessions, year, month, day)));
  found.push(...matches(join(root, 'archived_sessions')));
  return found;
}

/** @param {number} fd @param {Buffer} buffer @param {number} position */
function readExactly(fd, buffer, position) {
  for (let done = 0; done < buffer.length;) {
    const n = readSync(fd, buffer, done, buffer.length - done, position + done);
    if (n === 0) throw relayError('IO_ERROR', 'the rollout shrank while it was read');
    done += n;
  }
}
/** @template T @param {string} path @param {(fd: number, size: number) => T} body @returns {T} */
function withFile(path, body) {
  let fd;
  try { fd = openSync(path, 'r'); }
  catch (cause) { throw relayError('IO_ERROR', `cannot open ${path}`, cause); }
  try { return body(fd, fstatSync(fd).size); } finally { closeSync(fd); }
}
/** @param {Buffer} bytes */
function parseLine(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch (cause) { throw relayError('INVALID_ROLLOUT', 'a rollout line is not valid JSON', cause); }
}

/** The first record, which must end within `limit` bytes. Each block is read and searched
 * once; the record is assembled once, when its newline is found.
 * @param {string} path @param {{limit?: number, block?: number}} [options] */
export function firstRecord(path, { limit = SCAN_LIMIT, block = BLOCK } = {}) {
  return withFile(path, (fd, size) => {
    /** @type {Buffer[]} */
    const parts = [];
    for (let pos = 0; pos < Math.min(size, limit); pos += block) {
      const chunk = Buffer.alloc(Math.min(block, size - pos));
      readExactly(fd, chunk, pos);
      const end = chunk.indexOf(NEWLINE);
      if (end >= 0) return parseLine(Buffer.concat([...parts, chunk.subarray(0, end)]));
      parts.push(chunk);
    }
    throw relayError('INVALID_ROLLOUT', 'the rollout has no complete first record');
  });
}

/** The last turn_context within `limit` bytes of the end, read backward. The part after the
 * file's last newline is empty or a write in progress and is skipped; any other line that is
 * not JSON fails. Each block is read and searched once; a record spanning blocks is kept as
 * its fragments and assembled once, when the newline before it is found.
 * @param {string} path @param {{limit?: number, block?: number}} [options]
 * @returns {{record: Record<string, any>|null, limited: boolean}} */
export function lastTurnContext(path, { limit = SCAN_LIMIT, block = BLOCK } = {}) {
  return withFile(path, (fd, size) => {
    let pos = size, final = true;
    /** Fragments of the record being read backward, oldest first. @type {Buffer[]} */
    let tail = [];
    /** @param {Buffer[]} parts */
    const consider = (parts) => {
      if (final) { final = false; return null; }
      const parsed = parseLine(parts.length === 1 ? parts[0] : Buffer.concat(parts));
      return parsed?.type === 'turn_context' ? parsed : null;
    };
    while (pos > 0) {
      if (size - pos >= limit) return { record: null, limited: true };
      const length = Math.min(block, pos, limit - (size - pos));
      pos -= length;
      const chunk = Buffer.alloc(length);
      readExactly(fd, chunk, pos);
      let end = length;
      while (end > 0) {
        const at = chunk.lastIndexOf(NEWLINE, end - 1);
        if (at < 0) break;
        const found = consider([chunk.subarray(at + 1, end), ...tail]);
        tail = [];
        if (found) return { record: found, limited: false };
        end = at;
      }
      if (end > 0) tail.unshift(chunk.subarray(0, end));
    }
    return { record: consider(tail.length > 0 ? tail : [Buffer.alloc(0)]), limited: false };
  });
}

/** The model, effort and instant of a turn_context record. @param {Record<string, any>} record */
export function turnFields(record) {
  const { model, effort } = record.payload ?? {};
  if (typeof model !== 'string' || model === '') throw relayError('INVALID_ROLLOUT', 'turn_context has no model');
  if (effort !== undefined && effort !== null && typeof effort !== 'string') throw relayError('INVALID_ROLLOUT', 'turn_context effort is not a string');
  const at = typeof record.timestamp === 'string' && ISO_UTC.test(record.timestamp) ? Date.parse(record.timestamp) : NaN;
  if (!Number.isFinite(at)) throw relayError('INVALID_ROLLOUT', 'turn_context timestamp is not an ISO 8601 UTC instant');
  return { model, effort: /** @type {string|null} */ (effort ?? null), at };
}
```

- [ ] **Step 5: Run the tests and the checks**

Run: `just test-one test/codex-rollout.test.js`, then `just check`
Expected: PASS; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
just test-fast
git add src/adapters/codex-rollout.js test/helpers/codex-store.js test/codex-rollout.test.js
git commit -m "feat(codex): read a thread's rollout and its last turn record"
```

---

### Task 5: Resolve the model: ancestry, pid 1 and turn binding

**Files:**
- Create: `src/adapters/codex-model.js`
- Test: `test/codex-model.test.js`

**Interfaces:**
- Consumes: `startedAtMs` (Task 2); `nearestHarness` (Task 3); everything Task 4 produces.
- Produces:
  - `CLOCK_ALLOWANCE_MS = 1000`
  - `bindTurn(start: {lo, hi}, at: number) → 'verified' | 'earlier-turn' | 'turn-boundary'`
  - `chainWithInit(ops: {ancestors, recordOf}, startPid: number) → ProcessRow[]`
  - `resolveCodexModel({env?, ops?, startPid?, timeZone?, list?, scanLimit?}) → {answer: ModelAnswer, detail: string|null}`, where `ModelAnswer = {verified, agent, harness: 'codex', model, effort, thread, rollout, reason}`.

- [ ] **Step 1: Write the failing tests**

`test/codex-model.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessOps } from '../src/bus/proc.js';
import { bindTurn, chainWithInit, resolveCodexModel, CLOCK_ALLOWANCE_MS } from '../src/adapters/codex-model.js';
import { dayOf } from '../src/adapters/codex-rollout.js';
import { tempStore, threadAt, record, sessionMeta, turnContext } from './helpers/codex-store.js';

const B = Date.parse('2026-10-17T10:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const row = (pid, ppid, comm) => ({ pid, ppid, comm, tty: null, starttime: '1', state: 'S' });
const UNDER_CODEX = [row(30, 20, 'node'), row(20, 10, 'bash'), row(10, 5, 'codex')];
const fakeOps = ({ chain = UNDER_CODEX, init = null, start = { lo: B + 5000, hi: B + 5000 } } = {}) => ({
  ancestors: () => chain.map((r) => ({ ...r })), recordOf: (pid) => (pid === 1 ? init : null),
  executableOf: () => { throw new Error('executable must not be read'); }, startedAtMs: () => start });
/** A store holding one rollout whose last turn ran gpt-6-astra and was recorded at `turnAt`. */
const storeWith = (t, { turnAt = B, lines } = {}) => {
  const store = tempStore(t), thread = threadAt(B - 60_000);
  const rollout = store.day(dayOf(thread, 'UTC'), thread, lines?.(thread) ?? [sessionMeta(thread), turnContext('gpt-6-luna', iso(turnAt - 30_000)), turnContext('gpt-6-astra', iso(turnAt))]);
  return { store, thread, rollout, env: { CODEX_THREAD_ID: thread, CODEX_HOME: store.root } };
};
const resolve = (env, ops, extra = {}) => resolveCodexModel({ env, ops, startPid: 30, timeZone: 'UTC', ...extra });

test('bindTurn verifies only an interval wholly more than m after the record', () => {
  assert.equal(CLOCK_ALLOWANCE_MS, 1000);
  assert.equal(bindTurn({ lo: B + 1000, hi: B + 1000 }, B), 'verified');
  assert.equal(bindTurn({ lo: B + 999, hi: B + 1200 }, B), 'turn-boundary');
  assert.equal(bindTurn({ lo: B - 2200, hi: B - 1001 }, B), 'earlier-turn');
  assert.equal(bindTurn({ lo: B - 2000, hi: B - 1000 }, B), 'turn-boundary');
});
test('bindTurn on Darwin second intervals: same second, steps, and the pinned limit', () => {
  const S = 1_800_000_100_000, darwin = { lo: S, hi: S + 999 };
  assert.equal(bindTurn(darwin, S + 500), 'turn-boundary');            // started in the record's second
  assert.equal(bindTurn(darwin, S + 1500 - 900), 'turn-boundary');     // leftover, 900 ms backward step before t
  assert.equal(bindTurn(darwin, S + 6500), 'earlier-turn');            // leftover, harmless forward step
  assert.equal(bindTurn(darwin, S + 1500 - 2600), 'verified');         // stated limit: backward step > m + lead
});
test('chainWithInit appends pid 1 only when the walk ends under it', () => {
  const init = row(1, 0, 'codex');
  assert.deepEqual(chainWithInit(fakeOps({ chain: [row(2, 1, 'bash')], init }), 2).map((r) => r.pid), [2, 1]);
  assert.deepEqual(chainWithInit(fakeOps({ chain: [row(3, 2, 'bash')], init }), 3).map((r) => r.pid), [3]);
});
test('verified: the last turn_context of the thread, for a call process started in that turn', (t) => {
  const { env, thread, rollout } = storeWith(t);
  assert.deepEqual(resolve(env, fakeOps()), { answer: { verified: true, agent: 'codex/gpt-6-astra', harness: 'codex', model: 'gpt-6-astra', effort: 'high', thread, rollout, reason: null }, detail: null });
});
test('the sandbox: a codex at pid 1 is the harness and the process below it is the call', (t) => {
  const { env } = storeWith(t);
  const ops = fakeOps({ chain: [row(3, 2, 'node'), row(2, 1, 'bash')], init: row(1, 0, 'codex') });
  assert.equal(resolve(env, ops, { startPid: 3 }).answer.agent, 'codex/gpt-6-astra');
  const host = fakeOps({ chain: [row(3, 2, 'node'), row(2, 1, 'bash')], init: row(1, 0, 'systemd') });
  assert.equal(resolve(env, host, { startPid: 3 }).answer.reason, 'not-under-codex');
});
test('unverified reasons, each with its detail', (t) => {
  const { env, thread, rollout } = storeWith(t);
  const reason = (e, ops = fakeOps(), extra) => resolve(e, ops, extra);
  assert.equal(reason({ CODEX_HOME: env.CODEX_HOME }).answer.reason, 'no-thread');
  assert.equal(reason({ ...env, CODEX_THREAD_ID: '' }).answer.reason, 'no-thread');
  const claude = reason(env, fakeOps({ chain: [row(30, 20, 'node'), row(20, 10, 'claude'), row(10, 5, 'codex')] }));
  assert.equal(claude.answer.reason, 'not-under-codex'); assert.match(claude.detail ?? '', /claude-code/);
  assert.equal(reason(env, fakeOps({ chain: [row(30, 20, 'node'), row(20, 2, 'bash')] })).answer.reason, 'not-under-codex');
  assert.deepEqual(reason({ ...env, CODEX_THREAD_ID: threadAt(B - 1) }).answer, { verified: false, agent: 'codex', harness: 'codex', model: null, effort: null, thread: threadAt(B - 1), rollout: null, reason: 'no-rollout' });
  const early = reason(env, fakeOps({ start: { lo: B - 3000, hi: B - 2000 } }));
  assert.deepEqual([early.answer.reason, early.answer.rollout, early.answer.thread], ['earlier-turn', rollout, thread]);
  assert.equal(reason(env, fakeOps({ start: { lo: B - 500, hi: B - 400 } })).answer.reason, 'turn-boundary');
});
test('ambiguous, absent and out-of-range turn records', (t) => {
  const two = storeWith(t);
  two.store.day(dayOf(two.thread, 'UTC'), two.thread, [sessionMeta(two.thread)], { stamp: '2026-10-17T07-00-00' });
  assert.equal(resolve(two.env, fakeOps()).answer.reason, 'ambiguous-rollout');
  const none = storeWith(t, { lines: (id) => [sessionMeta(id), record('event_msg', {})] });
  assert.equal(resolve(none.env, fakeOps()).answer.reason, 'no-turn-context');
  const pad = record('event_msg', { pad: 'z'.repeat(600) });
  const far = storeWith(t, { lines: (id) => [sessionMeta(id), turnContext('m', iso(B)), pad, pad] });
  assert.equal(resolve(far.env, fakeOps(), { scanLimit: 1024 }).answer.reason, 'scan-limit');
});
test('failures: a malformed thread id, a relative store, a rollout that is not the thread\'s', (t) => {
  const { env } = storeWith(t);
  for (const id of ['bogus', '01A14985-3A99-7E12-9643-455088B7D4EC', '01a14985-3a99-4e12-9643-455088b7d4ec'])
    assert.throws(() => resolve({ ...env, CODEX_THREAD_ID: id }, fakeOps()), { code: 'INVALID_INPUT' }, id);
  assert.throws(() => resolve({ ...env, CODEX_HOME: 'relative' }, fakeOps()), { code: 'INVALID_CONFIG' });
  const foreign = storeWith(t, { lines: () => [sessionMeta('someone-else'), turnContext('m', iso(B))] });
  assert.throws(() => resolve(foreign.env, fakeOps()), { code: 'INVALID_ROLLOUT' });
});

// The real process helper with injected Linux clocks: sampling pauses and clock steps.
// The call process (pid 20) started at uptime 100 s; the command runs at uptime 130 s; the
// host booted at wall time BOOT, so with no step the wall clock reads BOOT + uptime.
const BOOT = B - 200_000;
const stat = (pid, comm, ppid, ticks) => `${pid} (${comm}) ${['S', ppid, ...Array(13).fill(0), 20, 0, 1, 0, ticks, 0].join(' ')}\n`;
const linuxHost = ({ uptimeMs = 130_000, wall }) => {
  const procs = { 30: stat(30, 'node', 20, 12_900), 20: stat(20, 'bash', 10, 10_000), 10: stat(10, 'codex', 1, 100), 1: stat(1, 'systemd', 0, 1) };
  const reads = [...wall];
  return createProcessOps({ platform: 'linux', now: () => /** @type {number} */ (reads.shift()),
    readLink: () => '/usr/bin/x',
    readText: (p) => {
      if (p === '/proc/uptime') return `${(uptimeMs / 1000).toFixed(2)} 0.00\n`;
      const pid = /^\/proc\/([0-9]+)\/stat$/.exec(p)?.[1];
      if (pid && procs[pid]) return procs[pid];
      throw Object.assign(new Error('absent'), { code: 'ENOENT' });
    } });
};
const cases = [
  // name, turn record (ms after BOOT), uptime at the sample, wall clock at [w0, w1] (ms after BOOT), expected
  ['current call', 98_000, 130_000, [130_000, 130_000], 'verified'],
  ['leftover from the previous turn', 101_500, 130_000, [130_000, 130_000], 'earlier-turn'],
  ['started 500 ms before the record', 100_500, 130_000, [130_000, 130_000], 'turn-boundary'],
  ['1.2 s pause after the uptime read, started 100 ms before', 100_100, 130_000, [130_000, 131_200], 'turn-boundary'],
  ['1.2 s pause before the uptime read, started 100 ms before', 100_100, 131_200, [130_000, 131_200], 'turn-boundary'],
  ['forward step of 900 ms, leftover', 101_500, 130_000, [130_900, 130_900], 'turn-boundary'],
  ['backward step of 900 ms, current call 1.2 s after the record', 98_800, 130_000, [129_100, 129_100], 'turn-boundary'],
  ['backward step of 900 ms, current call 3 s after the record', 97_000, 130_000, [129_100, 129_100], 'verified'],
  ['backward step of 50 s, leftover', 101_500, 130_000, [80_000, 80_000], 'earlier-turn'],
  ['stated limit: forward step of 2.6 s verifies a leftover with a 1.5 s lead', 101_500, 130_000, [132_600, 132_600], 'verified'],
];
for (const [name, turn, uptimeMs, wall, expected] of cases) {
  test(`Linux clocks: ${name}`, (t) => {
    const { env } = storeWith(t, { turnAt: BOOT + turn });
    const ops = linuxHost({ uptimeMs, wall: wall.map((w) => BOOT + w) });
    const { answer } = resolve(env, ops);
    assert.equal(answer.verified ? 'verified' : answer.reason, expected);
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `just test-one test/codex-model.test.js`
Expected: FAIL with `Cannot find module '…/src/adapters/codex-model.js'`.

- [ ] **Step 3: Implement**

`src/adapters/codex-model.js`:

```js
// @ts-check
// Which model a Codex tool call's turn runs, read from the thread's own rollout.
// Spec: docs/specs/2026-10-17-codex-model-resolver.md ("Resolution" steps 1-10).
import { relayError } from '../protocol.js';
import { createProcessOps } from '../bus/proc.js';
import { nearestHarness } from './index.js';
import { UUID_V7, SCAN_LIMIT, storeRoot, listDir, locateRollout, firstRecord, lastTurnContext, turnFields } from './codex-rollout.js';

/** The wall clock may move this much against the boot clock (spec "Clock requirement"). */
export const CLOCK_ALLOWANCE_MS = 1000;

/** @typedef {{verified: boolean, agent: string, harness: 'codex', model: string|null, effort: string|null, thread: string|null, rollout: string|null, reason: string|null}} ModelAnswer */
/** @typedef {Pick<import("../types.js").ProcessOps, 'ancestors'|'recordOf'|'executableOf'|'startedAtMs'>} ModelOps */

/** Step 9: where a call process's start interval falls against the turn's record.
 * @param {{lo: number, hi: number}} start @param {number} at @returns {'verified'|'earlier-turn'|'turn-boundary'} */
export function bindTurn({ lo, hi }, at) {
  if (lo - CLOCK_ALLOWANCE_MS >= at) return 'verified';
  if (hi + CLOCK_ALLOWANCE_MS < at) return 'earlier-turn';
  return 'turn-boundary';
}

/** The ancestor chain including pid 1. relay's walk stops before pid 1 (the registry depends on
 * that); in Codex's sandbox the `codex` the command runs under is pid 1.
 * @param {Pick<ModelOps, 'ancestors'|'recordOf'>} ops @param {number} startPid */
export function chainWithInit(ops, startPid) {
  const chain = ops.ancestors(startPid);
  if (chain.at(-1)?.ppid === 1) { const init = ops.recordOf(1); if (init) chain.push(init); }
  return chain;
}

/** @param {string} reason @param {string} detail @param {string|null} [thread] @param {string|null} [rollout] @returns {{answer: ModelAnswer, detail: string}} */
const unverified = (reason, detail, thread = null, rollout = null) =>
  ({ answer: { verified: false, agent: 'codex', harness: 'codex', model: null, effort: null, thread, rollout, reason }, detail });

/** @param {{env?: NodeJS.ProcessEnv, ops?: ModelOps, startPid?: number, timeZone?: string, list?: (dir: string) => string[]|null, scanLimit?: number}} [options]
 * @returns {{answer: ModelAnswer, detail: string|null}} */
export function resolveCodexModel({ env = process.env, ops = createProcessOps(), startPid = process.pid, timeZone, list = listDir, scanLimit = SCAN_LIMIT } = {}) {
  const thread = env.CODEX_THREAD_ID;
  if (!thread) return unverified('no-thread', 'CODEX_THREAD_ID is not set; only a Codex tool call carries it');
  if (!UUID_V7.test(thread)) throw relayError('INVALID_INPUT', 'CODEX_THREAD_ID is not a lowercase UUIDv7');
  const chain = chainWithInit(ops, startPid);
  const nearest = nearestHarness(chain, { executableOf: (pid) => ops.executableOf(pid) });
  if (nearest === null || nearest.harness !== 'codex') {
    return unverified('not-under-codex', nearest
      ? `the nearest harness process is ${nearest.harness} (pid ${chain[nearest.index].pid}), not codex`
      : 'no codex process among this process\'s ancestors', thread);
  }
  const call = chain[nearest.index - 1];
  const root = storeRoot(env);
  const found = locateRollout(root, thread, { timeZone, list });
  if (found.length === 0) return unverified('no-rollout', `no rollout of thread ${thread} under ${root}`, thread);
  if (found.length > 1) return unverified('ambiguous-rollout', `${found.length} rollouts match thread ${thread}: ${found.join(', ')}`, thread);
  const rollout = found[0];
  const head = firstRecord(rollout, { limit: scanLimit });
  if (head?.type !== 'session_meta' || head.payload?.id !== thread) throw relayError('INVALID_ROLLOUT', `${rollout} does not open with the session_meta of thread ${thread}`);
  const { record, limited } = lastTurnContext(rollout, { limit: scanLimit });
  if (!record) {
    return limited
      ? unverified('scan-limit', `no turn_context in the last ${scanLimit} bytes of ${rollout}`, thread, rollout)
      : unverified('no-turn-context', `${rollout} has no turn_context`, thread, rollout);
  }
  const { model, effort, at } = turnFields(record);
  const binding = bindTurn(ops.startedAtMs(call), at);
  if (binding === 'earlier-turn') return unverified('earlier-turn', `the call process (pid ${call.pid}) started before the latest turn's record at ${record.timestamp}`, thread, rollout);
  if (binding === 'turn-boundary') return unverified('turn-boundary', `the call process (pid ${call.pid}) started too close to the latest turn's record at ${record.timestamp} to order them`, thread, rollout);
  return { answer: { verified: true, agent: `codex/${model}`, harness: 'codex', model, effort, thread, rollout, reason: null }, detail: null };
}
```

- [ ] **Step 4: Run the tests and the checks**

Run: `just test-one test/codex-model.test.js`, then `just check`
Expected: PASS, including all ten Linux clock cases; `tsc` clean.

- [ ] **Step 5: Commit**

```bash
just test-fast
git add src/adapters/codex-model.js test/codex-model.test.js
git commit -m "feat(codex): resolve a tool call's model, bound to its turn"
```

---

### Task 6: `relay model` on the CLI, with the adopted table

**Files:**
- Modify: `tools/cli.toml` (only through `vendored adopt`)
- Modify: `src/commands.js` (`COMMANDS`), `bin/relay.js` (`main`, before `throw usage(\`unknown command …\`)`)
- Modify: `test/cli-surface.test.js` (the enum baselines and the `--json` command arguments)
- Test: `test/codex-model-cli.test.js`

**Interfaces:**
- Consumes: `resolveCodexModel` (Task 5); the landed ops row (Task 1); the test helpers (Task 4).
- Produces: the `relay model --harness codex [--json|--pretty]` command contract in the Global Constraints.

- [ ] **Step 1: Adopt the landed table**

```bash
python3 "$(tasks --pretty root ops-88a0fa)/bin/vendored" adopt cli.toml
git diff --stat tools/cli.toml
```
Expected: `tools/cli.toml` gains the `model` row. If `vendored` refuses because the helper changed too, run it with `cli.toml cli_surface.py` as it instructs, and commit both copies with this task. Now `just test-one test/cli-surface.test.js` FAILS with `tableOnly` naming the `model` rows. That is the RED for the parser change.

- [ ] **Step 2: Write the failing CLI tests**

`test/codex-model-cli.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayOf } from '../src/adapters/codex-rollout.js';
import { tempStore, threadAt, sessionMeta, turnContext } from './helpers/codex-store.js';

const BIN = fileURLToPath(new URL('../bin/relay.js', import.meta.url));
const LINUX = process.platform === 'linux' ? false : 'a codex-named parent and PID namespaces are checked on Linux';
// The suite may itself run inside a Codex tool call or with RELAY_FORMAT set: start clean.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CODEX_') && k !== 'RELAY_FORMAT'));
/** An executable named `codex` that runs relay as its child, so relay's nearest harness is Codex. */
function codexParent(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-codex-parent-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parent = path.join(dir, 'codex');
  fs.writeFileSync(parent, '#!/bin/sh\n"$RELAY_NODE" "$RELAY_BIN" "$@"\nexit $?\n', { mode: 0o700 });
  return parent;
}
/** A store whose thread's last turn ran gpt-6-astra and was recorded 30 s ago. */
function liveStore(t) {
  const store = tempStore(t), thread = threadAt(Date.now() - 60_000);
  store.day(dayOf(thread, 'UTC'), thread, [sessionMeta(thread), turnContext('gpt-6-astra', new Date(Date.now() - 30_000).toISOString())]);
  return { thread, env: { ...cleanEnv(), TZ: 'UTC', CODEX_HOME: store.root, CODEX_THREAD_ID: thread, RELAY_NODE: process.execPath, RELAY_BIN: BIN } };
}
const direct = (args, env) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env });

test('verified, as JSON and as the pretty agent line', { skip: LINUX }, (t) => {
  const { env, thread } = liveStore(t), parent = codexParent(t);
  const json = spawnSync(parent, ['model', '--harness', 'codex', '--json'], { encoding: 'utf8', env });
  assert.equal(json.status, 0, json.stderr); assert.equal(json.stderr, '');
  const answer = JSON.parse(json.stdout);
  assert.deepEqual(Object.keys(answer), ['verified', 'agent', 'harness', 'model', 'effort', 'thread', 'rollout', 'reason']);
  assert.deepEqual([answer.verified, answer.agent, answer.model, answer.effort, answer.thread, answer.reason], [true, 'codex/gpt-6-astra', 'gpt-6-astra', 'high', thread, null]);
  const pretty = spawnSync(parent, ['model', '--harness', 'codex', '--pretty'], { encoding: 'utf8', env: { ...env, RELAY_FORMAT: 'json' } });
  assert.deepEqual([pretty.status, pretty.stdout, pretty.stderr], [0, 'codex/gpt-6-astra\n', '']);
  const plain = spawnSync(parent, ['model', '--harness', 'codex'], { encoding: 'utf8', env });
  assert.equal(plain.stdout, 'codex/gpt-6-astra\n');
});
test('unverified: bare codex on stdout, the reason on stderr, exit 0', () => {
  const pretty = direct(['model', '--harness', 'codex'], cleanEnv());
  assert.equal(pretty.status, 0); assert.equal(pretty.stdout, 'codex\n');
  assert.equal(pretty.stderr, 'relay: model unverified (no-thread): CODEX_THREAD_ID is not set; only a Codex tool call carries it\n');
  const json = direct(['model', '--harness', 'codex', '--json'], cleanEnv());
  assert.deepEqual([json.status, json.stderr], [0, '']);
  assert.deepEqual(JSON.parse(json.stdout), { verified: false, agent: 'codex', harness: 'codex', model: null, effort: null, thread: null, rollout: null, reason: 'no-thread' });
});
test('a failure is exit 1 with the model_failed envelope', () => {
  const r = direct(['model', '--harness', 'codex', '--json'], { ...cleanEnv(), CODEX_THREAD_ID: 'bogus' });
  assert.deepEqual([r.status, r.stdout], [1, '']);
  assert.equal(r.stderr, '{"error":{"kind":"model_failed","detail":"INVALID_INPUT: CODEX_THREAD_ID is not a lowercase UUIDv7"}}\n');
});
test('usage errors exit 2; help exits 0', () => {
  for (const args of [['model'], ['model', '--harness', 'claude-code'], ['model', '--harness', 'codex', 'extra'], ['model', '--harness']])
    assert.equal(direct(args, cleanEnv()).status, 2, args.join(' '));
  const help = direct(['model', '--help'], cleanEnv());
  assert.equal(help.status, 0); assert.match(help.stdout, /^Usage: relay model --harness codex/);
});
test('in a PID namespace whose pid 1 is codex, the real process helper verifies', { skip: LINUX }, (t) => {
  const { env } = liveStore(t), parent = codexParent(t);
  const r = spawnSync('unshare', ['--user', '--map-root-user', '--pid', '--fork', '--mount-proc', parent, 'model', '--harness', 'codex', '--json'], { encoding: 'utf8', env });
  assert.equal(r.error, undefined, `unshare must be runnable: ${r.error}`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).agent, 'codex/gpt-6-astra');
});
```

- [ ] **Step 3: Add `model` to the surface test's fixtures**

`test/cli-surface.test.js` checks two things for every command, and `model` needs an entry in each. In `enum baselines cover every enum row`, every enum option needs a baseline. Pin `CODEX_THREAD_ID` empty for these runs, so a suite running inside a Codex tool call still gets the deterministic `no-thread` answer. Change `const env = { PATH: `${bin}:${process.env.PATH}` };` to:

```js
  const env = { PATH: `${bin}:${process.env.PATH}`, CODEX_THREAD_ID: '' };
```

and add to `baselines`:

```js
    [['model'], '--harness', ['model', '--harness', 'codex']],
```

In `every command without a declared output row emits one JSON value under --json`, every such command runs with its required arguments. Add `model` to `args`, and run every candidate with the thread pinned empty:

```js
  const args = { 'inbox show': [id], 'inbox answer': [id, 'q1=o1'], 'inbox defer': [id], model: ['--harness', 'codex'] };
```

```js
    const r = runCli(p, ['--json', ...cmd.path, ...(args[cmd.path.join(' ')] ?? [])], undefined, { CODEX_THREAD_ID: '' });
```

- [ ] **Step 4: Run them to verify they fail**

Run: `just test-one test/codex-model-cli.test.js test/cli-surface.test.js`
Expected: FAIL: `unknown command "model"` (exit 2 where 0 is expected), the surface test's `tableOnly` rows, and the two fixture tests' `model` runs.

- [ ] **Step 5: Implement**

`src/commands.js`, append to `COMMANDS` after the `presence` row:

```js
  { path: ['model'], summary: "The model a Codex tool call's turn runs, read from its rollout",
    options: [{ names: ['--harness'], value: 'enum', values: ['codex'], required: true }] },
```

`bin/relay.js`, in `main`, directly before `throw usage(\`unknown command "${cmd.path[0]}"\`);`:

```js
    if (cmd.path[0] === 'model') {
      const f = flags(rest, cmd);
      if (f['--harness'] !== 'codex' || Object.keys(f).length !== 1) throw usage('model requires --harness codex');
      const { answer, detail } = (await import('../src/adapters/codex-model.js')).resolveCodexModel();
      if (mode === 'json') { await emit(stdout, `${JSON.stringify(answer)}\n`); return 0; }
      await emit(stdout, `${answer.agent}\n`);
      if (!answer.verified) await emit(stderr, `relay: model unverified (${answer.reason}): ${detail}\n`);
      return 0;
    }
```

- [ ] **Step 6: Run the tests and the checks**

Run: `just test-one test/codex-model-cli.test.js test/cli-surface.test.js test/cli.test.js`, then `just check`
Expected: PASS. On Linux the PID-namespace test runs and passes; if `unshare` cannot create the namespace it fails with the reason, by design.

- [ ] **Step 7: Run on the Node 22 floor**

Run `just test-fast`. Then put the floor runtime first on `PATH` for one front-door run only; README's verification lines name Node 22.23.2, installed here through nvm:

```bash
NODE22_BIN=$(dirname "$(ls -d ~/.nvm/versions/node/v22.*/bin/node | sort -V | tail -1)")
PATH="$NODE22_BIN:$PATH" node --version   # must print v22.x
PATH="$NODE22_BIN:$PATH" just test-one --test-concurrency=1 test/codex-rollout.test.js test/codex-model.test.js test/codex-model-cli.test.js test/proc.test.js test/ancestry.test.js test/cli-surface.test.js
```

Expected: PASS on both runtimes.

- [ ] **Step 8: Commit**

```bash
git add tools/cli.toml src/commands.js bin/relay.js test/cli-surface.test.js test/codex-model-cli.test.js
git commit -m "feat(cli): relay model names a Codex tool call's model"
```

---

### Task 7: Document the command in `docs/api.md`

**Files:**
- Modify: `docs/api.md`: the command list in "Storage, CLI and failures", the error-code list, and a new section `## Codex model resolution` placed directly before `## Interaction messages and relay serve`.

- [ ] **Step 1: Add the command to the CLI list**

In the sentence beginning `The CLI's commands are`, add `` `relay model --harness codex` `` after `` `relay rollback --artifact FILE` ``.

- [ ] **Step 2: Add `INVALID_ROLLOUT` to the code list**

Change `GUARD_FAILED and REGISTRY_SUPERSEDED.` to `GUARD_FAILED, REGISTRY_SUPERSEDED and INVALID_ROLLOUT.`

- [ ] **Step 3: Write the section**

```markdown
## Codex model resolution

`relay model --harness codex` tells a process running inside a Codex tool call which model
its turn runs. It reads the thread's own rollout (`CODEX_THREAD_ID` →
`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*-<thread>.jsonl`, `$HOME/.codex` when
`CODEX_HOME` is unset) and takes the last `turn_context`. Codex's layout is private and
observed, not documented; design and evidence in
`docs/specs/2026-10-17-codex-model-resolver.md`.

Pretty output (the default) is the agent alone: `codex/<model>` when verified, else `codex`,
plus `relay: model unverified (<reason>): <detail>` on stderr. Capture it with
`$(relay model --harness codex --pretty)`, naming the mode, since `RELAY_FORMAT` changes the
default. `--json` prints one object:

    {"verified":true,"agent":"codex/gpt-6.1-sol","harness":"codex","model":"gpt-6.1-sol","effort":"high","thread":"<id>","rollout":"<path>","reason":null}

| reason | when |
|---|---|
| `no-thread` | `CODEX_THREAD_ID` unset or empty: hooks, and every process outside Codex |
| `not-under-codex` | the nearest harness ancestor is not `codex`, or there is none (a reparented daemon or tmux server, another harness started from a Codex shell) |
| `no-rollout` | no rollout of the thread (an ephemeral session) |
| `ambiguous-rollout` | more than one rollout matches |
| `no-turn-context` | the rollout holds no `turn_context` |
| `scan-limit` | none within the last 64 MiB |
| `earlier-turn` | the call process (the one Codex started for the tool call) started before the latest turn's record |
| `turn-boundary` | its start is too close to that record to order them |

Every answer exits 0. A failure exits 1 with kind `model_failed`: `INVALID_INPUT` (a thread id
that is not a lowercase UUIDv7), `INVALID_CONFIG` (a relative `CODEX_HOME`, or no usable
`HOME`), `IO_ERROR`, `PROCESS_UNREADABLE`, or `INVALID_ROLLOUT` (a rollout that does not open
with its own `session_meta`, an invalid line in the scanned range, or a malformed
`turn_context`). A caller that needs a stamp treats a failure, or no answer within 2 s,
like an unverified answer and reports it.

A caller is verified only while its call process provably started in the latest turn:
the start interval less one second must lie after the turn's record. A background
terminal or server left from an earlier turn is refused once the next turn begins.
**Clock requirement:** between the call process's start and the command, the wall clock
must move by less than one second against the boot clock. A larger step forward on Linux,
or backward on Darwin, can verify a leftover process with the latest turn's model. No
interface records past steps, so the command cannot detect one.
```

- [ ] **Step 4: Check and commit**

Run: `just check`
Expected: PASS (`ops-check` resolves the spec reference).

```bash
just test-fast
git add docs/api.md
git commit -m "docs(api): document relay model"
```

---

### Task 8: Live acceptance

Runs real Codex sessions (a small number of turns of OpenAI usage) from scratch directories. The TUI cases run in a detached tmux server, never on the live desktop. Results go to `docs/notes/2026-10-17-codex-model-acceptance.md`. A failure of the spec's question 5 (thread ids following `/new`, `/resume`, `/fork`, `/model`) returns the design for revision; do not patch it here.

**Files:**
- Create: `tools/codex-model-acceptance/run`
- Create: `docs/notes/2026-10-17-codex-model-acceptance.md`

- [ ] **Step 1: Write the acceptance tool**

`tools/codex-model-acceptance/run` (mode 0755):

```bash
#!/usr/bin/env bash
# Live acceptance for `relay model` (spec docs/specs/2026-10-17-codex-model-resolver.md, "Testing").
# Usage: run exec <outdir>  |  run tui start|say|keys|pane|stop <outdir> [text]
# Every Codex here runs in a scratch work directory; the TUI runs in a private, detached tmux server.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RELAY="node $ROOT/bin/relay.js model --harness codex --json"
mode=${1:?exec or tui}; OUT=$(realpath -m "${2:?outdir}"); mkdir -p "$OUT/work"; W=$OUT/work
# Each output directory owns its tmux servers, named from its path, and touches no other.
ID=relay-model-acc-$(printf %s "$OUT" | sha1sum | cut -c1-12)
SOCK=$ID-exec; T=$ID-tui
cleanup() { tmux -L "$SOCK" kill-server 2>/dev/null || true; }
cx() { codex exec --skip-git-repo-check -C "$W" "$@" </dev/null >>"$OUT/exec.log" 2>&1; }

if [ "$mode" = exec ]; then
  trap cleanup EXIT TERM INT
  B=--dangerously-bypass-approvals-and-sandbox
  cx $B -m gpt-6-luna "Run exactly this shell command once: $RELAY > $W/top.json. Then reply DONE."
  thread=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["thread"])' "$W/top.json")
  codex exec resume "$thread" --skip-git-repo-check $B -m gpt-6-astra "Run exactly this shell command once: $RELAY > $W/resumed.json. Then reply DONE." </dev/null >>"$OUT/exec.log" 2>&1
  cx $B -m gpt-6-luna "Spawn one sub-agent on model gpt-6-astra whose only task is to run this shell command once: $RELAY > $W/child.json. Wait for it. Then run this shell command yourself once: $RELAY > $W/parent.json. Then reply DONE."
  cx -m gpt-6-luna "Run exactly this shell command once: $RELAY > $W/sandbox.json; echo \$CODEX_PERMISSION_PROFILE > $W/sandbox.profile. Then reply DONE."
  cx $B "Run exactly this shell command once: setsid nohup sh -c 'sleep 2; $RELAY > $W/setsid.json 2>&1' >/dev/null 2>&1 & sleep 6. Then reply DONE."
  cx $B "Run exactly this shell command once: tmux -L $SOCK new-session -d 'sleep 1; $RELAY > $W/tmux.json 2>&1; sleep 2'; sleep 6. Then reply DONE."
  cx $B --ephemeral "Run exactly this shell command once: $RELAY > $W/ephemeral.json 2>&1. Then reply DONE."
  for f in "$W"/*.json; do printf '%s ' "$(basename "$f")"; cat "$f"; done
  exit 0
fi

# TUI: the outdir's own tmux server ($T); the operator drives it step by step.
case ${3:-} in
  start) if tmux -L $T has-session 2>/dev/null; then echo "$T already runs; stop it first" >&2; exit 2; fi
         tmux -L $T new-session -d -s acc -x 200 -y 50 -c "$W" "codex --no-daemon --dangerously-bypass-approvals-and-sandbox -m gpt-6-luna -C $W"; sleep 8 ;;
  say)   tmux -L $T send-keys -t acc -l "${4:?text}"; sleep 1; tmux -L $T send-keys -t acc Enter ;;
  keys)  tmux -L $T send-keys -t acc "${@:4}" ;;
  pane)  tmux -L $T capture-pane -p -t acc | grep -v '^\s*$' | tail -${4:-15} | tee -a "$OUT/panes.log" ;;
  stop)  tmux -L $T kill-server ;;
  *) echo "tui start|say|keys|pane|stop" >&2; exit 2 ;;
esac
```

The `tui` subcommand intentionally leaves its server running between calls. The server's name comes from the output directory, so `exec` cleanup and another output directory's `stop` never touch it. The operator ends every TUI session with `run tui <outdir> stop`, and the end-of-turn `host-load --section session` check must show nothing left.

- [ ] **Step 2: Run the exec cases**

Run: `tools/codex-model-acceptance/run exec "$(mktemp -d)"` (timeout 20 min)
Expected:
- `top.json`: verified, `codex/gpt-6-luna`.
- `resumed.json`: verified, `codex/gpt-6-astra`, with the same thread as `top.json`.
- `child.json`: verified, `codex/gpt-6-astra`, with a thread other than `parent.json`'s.
- `parent.json`: verified, `codex/gpt-6-luna`.
- `sandbox.json`: verified (`sandbox.profile` names the sandboxed profile).
- `setsid.json` and `tmux.json`: `not-under-codex`.
- `ephemeral.json`: record whichever reason it gets.

A `turn-boundary` on a current call is a measurement to record, not a failure.

- [ ] **Step 3: Run the TUI cases**

With `R=tools/codex-model-acceptance/run` and `O=$(mktemp -d)`, run `$R tui "$O" start`, then:
1. `say "Run exactly this shell command once: <RELAY> > tui-1.json. Then reply DONE."`, wait about 20 s, then `pane`.
2. Switch model with `/model`, driving the picker with `keys` and checking with `pane` until the footer names `gpt-6-astra`; repeat 1 writing `tui-2.json`.
3. `/new`, then 1 writing `tui-new.json`.
4. `/resume`, pick the first thread (luna in the rollout), switch it to another model if the picker allows, then 1 writing `tui-resume.json`.
5. `/fork`, then 1 writing `tui-fork.json`.
6. Background terminal: `say` a prompt that starts `sh -c 'for i in 1 2 3 4 5 6 7 8 9 10; do <RELAY> > bg-$i.json; sleep 3; done'` with `exec_command` and `yield_time_ms` 1000, then replies at once. Switch `/model`, `say "Reply OK."`, then wait 30 s.
7. Mid-turn message: `say` a prompt running `sleep 20; <RELAY> > mid.json`. After 5 s, `say "Also note this."`. Afterward, count `turn_context` records in the rollout.

Then run `$R tui "$O" stop`.

`<RELAY>` stands for the `RELAY` command line the script defines; the operator writes it out in full.

Expected:
- `tui-1`: luna.
- `tui-2`: astra.
- `tui-new`, `tui-resume` and `tui-fork`: verified, each with its own active thread and model.
- `bg-*`: verified while turn A runs, then `earlier-turn` or `turn-boundary` after turn B's record, never verified with turn B's model.
- `mid`: record whether a second `turn_context` appeared and the answer.

- [ ] **Step 4: Write the acceptance note and commit**

`docs/notes/2026-10-17-codex-model-acceptance.md` records:
- the Codex version (`codex --version`) and date;
- each case: command, expected and observed JSON;
- every `turn-boundary` seen on a current call, as the measure of how often the boundary refuses a current caller;
- the mid-turn finding.

Note any deviation as a finding with its consequence for the spec.

```bash
git add tools/codex-model-acceptance/run docs/notes/2026-10-17-codex-model-acceptance.md
git commit -m "test(codex): live acceptance of relay model"
```

If any expectation in Step 2 or 3 fails, stop and report. Case 3's `/new`, `/resume` and `/fork` checks are spec question 5, which returns the design to the user.

---

## After the tasks

- Update the spec's status line to `implemented` with this plan and the acceptance note, and `tasks note relay-2cd4b1` with the landed commits.
- Wake the consumers: `tasks unshelve tasks-970049` with a note naming `docs/api.md` "Codex model resolution" as its call contract, and a note on `lore-f71994` that the command has landed.
- `tasks done relay-2cd4b1` on this branch before it merges; integration follows the finishing skill.
