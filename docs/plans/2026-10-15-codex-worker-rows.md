# Codex Worker Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one registry row per Codex worker, keyed by its `agent_id`, with `scope: "worker"` and `root` naming its root session, so worker events never touch the root row and tasks can select a worker's row by its thread.

**Architecture:** The Codex adapter reads `agent_id` from a hook payload and, when present, normalizes the event to the worker's identity with a `root` field. The registry transaction writes worker rows with `scope: "worker"` and `root`, and a root's SessionEnd removes the root and every row rooted at it. The validators accept exactly that shape. The installer binds SubagentStart and SubagentStop. Two acceptance tools prove it live: registry rows from relay's own hooks, and claim acquisition through tasks.

**Tech Stack:** Node >=22, ES modules, Node built-ins, `node:test`, bash and jq for the capture tools. No new dependencies.

**Spec:** `docs/specs/2026-10-15-codex-worker-rows.md` (approved 2026-10-15 after two review rounds).

**Status:** approved 2026-10-15 after three review rounds. Execution: Native (superpowers:executing-plans) for Tasks 1–5, then a fresh whole-branch review; Task 6 runs only once tasks-af3aac has landed and its `tasks` is installed.

## Global Constraints

- Node >=22, ES modules and built-ins only; the one runtime dependency stays `jsonc-parser`.
- `Snapshot.schema` stays `2`; `Event.schema`, subscriber config and envelope `schema` stay `1`.
- Worker row: `id: codex:<W>`, `sessionId: W`, `harness: codex`, `scope: "worker"`, `root: codex:<R>`, the shared process handle. Root rows are unchanged and never carry `root`.
- `scope` is `process` for OpenCode, `session` for Claude Code, and `session` (no `root`) or `worker` (with `root`) for Codex.
- `root` is always the root session (`codex:<session_id>`), never an immediate parent.
- `agent_id` present on a Codex payload makes it a worker event; it must be nonempty text different from `session_id`, else `INVALID_INPUT`. SubagentStart and SubagentStop without it are `INVALID_INPUT`. Claude Code and OpenCode payloads are never routed by `agent_id`.
- SubagentStart: kind `session-start`, level `working`, no reply channel. SubagentStop: kind `turn-end`, level `done`, reply `{ refuse: true, context: false }`, encoded as Stop's.
- No TTL, replay or decay: a worker row ends only with its root's SessionEnd or its process's death.
- Docs and fixtures use `/home/user/...` for home paths and synthetic ids, never a real home directory or captured ids.
- Live acceptance never changes the user's harness, relay or tasks configuration, and launches Codex under `env -i` with an explicit variable list (no `TASKS_SESSION`, `TASKS_SESSION_PID` or `CLAUDE_CODE_SESSION_ID`).
- The branch merges only after tasks-af3aac (worker scope and tie-break in tasks) has landed (spec, Rollout step 1). Task 6 runs only with that tasks installed.
- Verify with `just test-one <file>` per test, `just test-fast` before each commit, `just check` (strict `tsc`), and `just gate` (Node 22 floor) before integration.

## Review Focus

1. **A Codex payload with `agent_id: null`** (a future release serializing the absent value). It is refused as `INVALID_INPUT`, not treated as a root event; with a guard configured that is a native refusal, which is relay's fail-closed rule for malformed input. Pinned in Task 2.
2. **A Claude Code payload carrying `agent_id`** (Claude's own subagent hooks). It stays the Claude session's event, unrouted. Pinned in Task 2.
3. **A worker event arriving before its root has any row** (relay installed mid-session, or a SessionStart that failed). The worker row is created and still names its root; a later root SessionEnd removes it. Pinned in Task 3.
4. **A worker's later turn, which has no start event.** Its first tool event sets the row back to `working` after a `done`. Pinned in Task 3.
5. **A root SessionEnd for a root whose own row is already gone.** Its workers are still removed by their `root`. Pinned in Task 3.

---

## File Structure

- `src/types.js`: `Agent.scope` gains `'worker'`, `Agent.root?` and `Event.root?`; `Adapter.workerIdOf?`.
- `src/protocol.js`: agent and event validation of `scope`/`root`.
- `src/adapters/codex.js`: SubagentStart/SubagentStop mappings, the SubagentStop reply, `workerIdOf`.
- `src/adapters/index.js`: `normalizeEvent` routes worker events.
- `src/bus/transaction.js`: worker rows on upsert; cascade on a root's SessionEnd.
- `src/install/hooks.js`: Codex binding table.
- `test/fixtures/registry-workers.json` (new): the shared worker-row fixture tasks vendors.
- `test/protocol.test.js`, `test/codex.test.js`, `test/replies.test.js`, `test/subscribers.test.js`, `test/transaction.test.js`, `test/install-hooks.test.js`, `test/install-capabilities.test.js`, `test/types/contracts.js`: tests.
- `docs/api.md`, `docs/runbooks/hook-install-rollback.md`: contracts and rollout.
- `tools/codex-subagent-capture/lib.sh` (new), `run`, `judge-registry.mjs` (new): registry acceptance.
- `tools/codex-worker-claims/run`, `judge.mjs` (new): claim acceptance.
- `docs/notes/2026-10-15-codex-worker-rows-acceptance.md` (new): acceptance evidence.

---

### Task 1: Registry contract for worker rows

**Files:**
- Modify: `src/types.js:7,10`
- Modify: `src/protocol.js` (`validateAgent`, `validateEvent`)
- Create: `test/fixtures/registry-workers.json`
- Test: `test/protocol.test.js`, `test/types/contracts.js`
- Docs: `docs/api.md` ("Persisted and transient contracts")

**Interfaces:**
- Produces: `Agent = {…; scope: 'process'|'session'|'worker'; root?: string; …}`, `Event = {…; root?: string; …}`; `validateSnapshot` and `validateEvent` accept and return `root` exactly where the rules allow; `test/fixtures/registry-workers.json` with ids below, used by Tasks 3 and 5 and vendored by tasks.

Fixture ids (synthetic, used verbatim in later tasks):
`R = 0199f000-0000-7000-8000-000000000001`, `W1 = 0199f000-0000-7000-8000-000000000002`,
`W2 = 0199f000-0000-7000-8000-000000000003`, Claude `C = 0199f000-0000-7000-8000-0000000000c1`.

- [ ] **Step 1: Write the fixture**

`test/fixtures/registry-workers.json`:

```json
{
  "schema": 2,
  "generation": "3f9c1a52-6b0e-4d7a-9c21-5e8f0b7d4a10",
  "revision": 7,
  "agents": {
    "codex:0199f000-0000-7000-8000-000000000001": {
      "id": "codex:0199f000-0000-7000-8000-000000000001", "harness": "codex",
      "sessionId": "0199f000-0000-7000-8000-000000000001", "scope": "session",
      "process": { "platform": "linux", "host": "host", "bootId": "12345678-1234-4234-8234-123456789abc", "pid": 4242, "start": "123456" },
      "cwd": "/home/user/project", "repoRoot": "/home/user/project", "remote": null,
      "projectKey": "/home/user/project", "project": "project", "state": "done", "updatedAt": 1760000000000
    },
    "codex:0199f000-0000-7000-8000-000000000002": {
      "id": "codex:0199f000-0000-7000-8000-000000000002", "harness": "codex",
      "sessionId": "0199f000-0000-7000-8000-000000000002", "scope": "worker",
      "root": "codex:0199f000-0000-7000-8000-000000000001",
      "process": { "platform": "linux", "host": "host", "bootId": "12345678-1234-4234-8234-123456789abc", "pid": 4242, "start": "123456" },
      "cwd": "/home/user/project", "repoRoot": "/home/user/project", "remote": null,
      "projectKey": "/home/user/project", "project": "project", "state": "working", "updatedAt": 1760000001000
    },
    "codex:0199f000-0000-7000-8000-000000000003": {
      "id": "codex:0199f000-0000-7000-8000-000000000003", "harness": "codex",
      "sessionId": "0199f000-0000-7000-8000-000000000003", "scope": "worker",
      "root": "codex:0199f000-0000-7000-8000-000000000001",
      "process": { "platform": "linux", "host": "host", "bootId": "12345678-1234-4234-8234-123456789abc", "pid": 4242, "start": "123456" },
      "cwd": "/home/user/project", "repoRoot": "/home/user/project", "remote": null,
      "projectKey": "/home/user/project", "project": "project", "state": "done", "updatedAt": 1760000002000
    },
    "claude-code:0199f000-0000-7000-8000-0000000000c1": {
      "id": "claude-code:0199f000-0000-7000-8000-0000000000c1", "harness": "claude-code",
      "sessionId": "0199f000-0000-7000-8000-0000000000c1", "scope": "session",
      "process": { "platform": "linux", "host": "host", "bootId": "12345678-1234-4234-8234-123456789abc", "pid": 5151, "start": "654321" },
      "cwd": "/home/user/other", "repoRoot": null, "remote": null,
      "projectKey": "/home/user/other", "project": "other", "state": "idle", "updatedAt": 1760000003000
    }
  }
}
```

W2 is the nested worker: it names R, not W1, as `root`.

- [ ] **Step 2: Write the failing tests**

Append to `test/protocol.test.js` (it already imports `readFileSync`, `validateSnapshot`, `validateEvent`):

```js
const workers = JSON.parse(readFileSync(new URL('./fixtures/registry-workers.json', import.meta.url)));
const R = '0199f000-0000-7000-8000-000000000001', W1 = '0199f000-0000-7000-8000-000000000002';
test('the shared worker fixture validates unchanged', () => {
  assert.deepEqual(validateSnapshot(workers), workers);
});
test('a worker row needs Codex and a root other than itself; a session row has no root', () => {
  const worker = workers.agents[`codex:${W1}`], root = workers.agents[`codex:${R}`];
  const { root: _dropped, ...rootless } = worker;
  const alone = (agent) => ({ ...workers, agents: { [agent.id]: agent } });
  const bad = [rootless, { ...worker, root: `codex:${W1}` }, { ...worker, root: 'claude-code:x' },
    { ...worker, root: 'codex:' }, { ...worker, root: 7 }, { ...root, root: `codex:${W1}` },
    { ...worker, id: `claude-code:${W1}`, harness: 'claude-code' },
    { ...worker, id: `opencode:${W1}`, harness: 'opencode' }];
  for (const agent of bad) assert.throws(() => validateSnapshot(alone(agent)), { code: 'INVALID_SCHEMA' }, JSON.stringify([agent.id, agent.root]));
});
test('an event root is a Codex root other than the event itself', () => {
  const base = { schema: 1, kind: 'before-tool', harness: 'codex', nativeEvent: 'PreToolUse', agentId: 'codex:w',
    sessionId: 'w', cwd: '/repo', tool: { name: 'Bash', input: {}, command: null } };
  assert.equal(validateEvent({ ...base, root: 'codex:r' }).root, 'codex:r');
  assert.equal(Object.hasOwn(validateEvent(base), 'root'), false);
  for (const root of ['codex:w', 'claude-code:r', 'codex:', '', null]) {
    assert.throws(() => validateEvent({ ...base, root }), { code: 'INVALID_SCHEMA' }, String(root));
  }
  assert.throws(() => validateEvent({ ...base, harness: 'claude-code', agentId: 'claude-code:w', root: 'codex:r' }), { code: 'INVALID_SCHEMA' });
});
```

Append to `test/types/contracts.js`:

```js
/** @type {import('../../src/types.js').Agent} */
const row = { id: 'codex:w', harness: 'codex', sessionId: 'w', scope: 'worker', root: 'codex:r', process: null,
  cwd: '/repo', repoRoot: null, remote: null, projectKey: '/repo', project: 'repo', state: 'idle', updatedAt: 0 };
// @ts-expect-error Registry scopes are session, process or worker.
row.scope = 'thread';
// @ts-expect-error A root is an agent id, never a number.
row.root = 1;
```

- [ ] **Step 3: Run them to verify they fail**

Run: `just test-one test/protocol.test.js` — Expected: the fixture test fails with `INVALID_SCHEMA` (`invalid agent`, scope `worker`), and the event test fails because `root` is stripped.
Run: `just check` — Expected: errors in `test/types/contracts.js` (`'worker'` not assignable; unused `@ts-expect-error` for `root`).

- [ ] **Step 4: Implement**

`src/types.js` line 7 and line 10:

```js
 * @typedef {{id: string, harness: Harness, sessionId: string, scope: 'process'|'session'|'worker', root?: string, process: Handle|null, cwd: string, repoRoot: string|null, remote: string|null, projectKey: string, project: string, state: State, updatedAt: number}} Agent
```
```js
 * @typedef {{schema: 1, kind: Kind, harness: Harness, nativeEvent: string, agentId: string, sessionId: string, root?: string, cwd: string, stopHookActive?: boolean, tool: Tool|null}} Event
```

`src/protocol.js`, after `identity`:

```js
// A Codex worker names its root session's agent id; nothing else carries a root.
// Spec: docs/specs/2026-10-15-codex-worker-rows.md.
/** @param {unknown} root @param {string} id */
const rootOf = (root, id) => text(root) && root.startsWith('codex:') && text(root.slice('codex:'.length)) && root !== id;
```

`validateAgent` becomes:

```js
function validateAgent(v, key) {
  if (!object(v)) fail('invalid agent');
  identity(v, v.id);
  const worker = v.scope === 'worker';
  if (v.id !== key || !(worker ? v.harness === 'codex' && rootOf(v.root, v.id)
      : v.scope === (v.harness === 'opencode' ? 'process' : 'session') && !Object.hasOwn(v, 'root'))
      || !(v.repoRoot === null || absolute(v.repoRoot)) || !(v.remote === null || text(v.remote))
      || !text(v.projectKey) || !text(v.project) || !STATES.includes(v.state) || !integer(v.updatedAt)) fail('invalid agent');
  return { id: v.id, harness: v.harness, sessionId: v.sessionId, scope: v.scope, ...(worker ? { root: v.root } : {}),
    process: v.process === null ? null : validateHandle(v.process), cwd: v.cwd,
    repoRoot: v.repoRoot, remote: v.remote, projectKey: v.projectKey, project: v.project,
    state: v.state, updatedAt: v.updatedAt };
}
```

In `validateEvent`, after `identity(v, v.agentId);`:

```js
  if (Object.hasOwn(v, 'root') && !(v.harness === 'codex' && rootOf(v.root, v.agentId))) fail('invalid event root');
```

and in its return object, after `sessionId: v.sessionId,`:

```js
    ...(Object.hasOwn(v, 'root') ? { root: v.root } : {}),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `just test-one test/protocol.test.js` — Expected: PASS. Run: `just check` — Expected: clean.

- [ ] **Step 6: Document the contract**

In `docs/api.md`, in the `Agent` type block, replace the `scope` line and add `root`:

```ts
  scope: 'session' | 'process' | 'worker';
  root?: string;         // Codex workers only: the root session's agent id
```

In the `Event` type block, after `sessionId: string;`:

```ts
  root?: string;         // Codex worker events only
```

After the paragraph that ends "Any other unknown schema is `INVALID_SCHEMA`.", add:

```markdown
A Codex worker has its own row (spec `docs/specs/2026-10-15-codex-worker-rows.md`):
`id: codex:<agent_id>`, `sessionId: <agent_id>` (the worker's thread id),
`scope: "worker"` and `root: codex:<session_id>`, the root session's agent id, never an
immediate parent. It shares its root's process handle. `scope` is `process` for
OpenCode, `session` for Claude Code, and for Codex `session` without `root` or `worker`
with it; any other combination is `INVALID_SCHEMA`. A relay from before worker rows
accepts only `session` for Codex, so it refuses a snapshot holding a worker row and
writes nothing, rather than publishing the rows without their `root`.
`test/fixtures/registry-workers.json` is the shared example: a root, a worker, a nested
worker and a Claude row; tasks vendors it.
```

- [ ] **Step 7: Commit**

```bash
just test-fast
git add src/types.js src/protocol.js test/fixtures/registry-workers.json test/protocol.test.js test/types/contracts.js docs/api.md
git commit -m "feat(protocol): validate Codex worker rows with scope worker and root"
```

---

### Task 2: The Codex adapter routes worker events

**Files:**
- Modify: `src/adapters/codex.js`, `src/adapters/index.js`, `src/types.js:24` (`Adapter`)
- Test: `test/codex.test.js`, `test/replies.test.js:24`, `test/subscribers.test.js`
- Docs: `docs/api.md` ("Event mappings")

**Interfaces:**
- Consumes: `Event.root` and `validateEvent` from Task 1.
- Produces: `workerIdOf(data: Record<string, any>, nativeEvent: string): string|null` exported by `src/adapters/codex.js`; `Adapter.workerIdOf?` with that signature; `normalizeEvent('codex', native, raw)` returns `{agentId: 'codex:<agent_id>', sessionId: <agent_id>, root: 'codex:<session_id>', …}` for a worker payload; Codex `events.SubagentStart` and `events.SubagentStop`, `replies.SubagentStop`.

- [ ] **Step 1: Write the failing tests**

Append to `test/codex.test.js` (add `import { normalizeEvent } from '../src/adapters/index.js';` and `stateForEvent` to the codex import):

```js
const R = '0199f000-0000-7000-8000-000000000001', W = '0199f000-0000-7000-8000-000000000002';
const payload = (fields = {}) => JSON.stringify({ session_id: R, cwd: '/repo', ...fields });
const tool = { tool_name: 'Bash', tool_input: { command: 'echo hi' } };
test('a hook without agent_id stays the root session', () => {
  const event = normalizeEvent('codex', 'PreToolUse', payload(tool));
  assert.equal(event.agentId, `codex:${R}`);
  assert.equal(Object.hasOwn(event, 'root'), false);
});
test('a hook carrying agent_id is the worker, rooted at the session', () => {
  for (const [native, fields, kind] of [['SubagentStart', {}, 'session-start'], ['PreToolUse', tool, 'before-tool'],
    ['PermissionRequest', {}, 'needs-approval'], ['SubagentStop', { stop_hook_active: false }, 'turn-end']]) {
    const event = normalizeEvent('codex', native, payload({ ...fields, agent_id: W, agent_type: 'default' }));
    assert.deepEqual([event.agentId, event.sessionId, event.root, event.kind], [`codex:${W}`, W, `codex:${R}`, kind], native);
  }
  assert.equal(stateForEvent('SubagentStart'), 'working');
  assert.equal(stateForEvent('SubagentStop'), 'done');
});
test('a worker identity is refused rather than guessed', () => {
  for (const native of ['SubagentStart', 'SubagentStop']) {
    assert.throws(() => normalizeEvent('codex', native, payload()), { code: 'INVALID_INPUT' }, native);
  }
  for (const agent_id of ['', ' ', null, 7, R]) {
    assert.throws(() => normalizeEvent('codex', 'PreToolUse', payload({ ...tool, agent_id })), { code: 'INVALID_INPUT' }, String(agent_id));
  }
});
test('a Claude Code payload carrying agent_id is not routed', () => {
  const event = normalizeEvent('claude-code', 'PreToolUse', payload({ ...tool, agent_id: W }));
  assert.equal(event.agentId, `claude-code:${R}`);
  assert.equal(Object.hasOwn(event, 'root'), false);
});
```

In `test/replies.test.js`, replace line 24's assertion with a per-harness list, and add the SubagentStop cases inside the same `for` loop, guarded to Codex:

```js
    const expected = harness === 'codex' ? ['PreToolUse', 'Stop', 'SubagentStop', 'UserPromptSubmit'] : ['PreToolUse', 'Stop', 'UserPromptSubmit'];
    assert.deepEqual(Object.keys(replies).sort(), expected);
```

and after the loop:

```js
  const codex = adapterFor('codex');
  assert.deepEqual(codex.encodeReply('SubagentStop', { decision: 'deny', reason: 'keep going' }), {
    stdout: '{"decision":"block","reason":"keep going"}\n', stderr: 'keep going\n', exitCode: 2 });
  assert.throws(() => codex.encodeReply('SubagentStop', { decision: 'allow', context: 'c' }), { code: 'UNSUPPORTED_REPLY' });
  assert.throws(() => codex.encodeReply('SubagentStart', { decision: 'deny', reason: 'no' }), { code: 'UNSUPPORTED_REPLY' });
```

Append to `test/subscribers.test.js`:

```js
test('a Codex turn-end guard still loads once SubagentStop shares the kind', () => {
  validateSubscribers({ schema: 1, subscribers: [guard({ kinds: ['turn-end'], harnesses: ['codex'], tools: null })] });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `just test-one test/codex.test.js test/replies.test.js test/subscribers.test.js`
Expected: FAIL — `UNSUPPORTED_EVENT` for SubagentStart, `agentId` is the root's for a worker payload, and the replies key list lacks SubagentStop. The subscribers test passes already (SubagentStop is not yet a `turn-end` event); it guards Step 3.

- [ ] **Step 3: Implement**

`src/adapters/codex.js`: add to `events`:

```js
  'SubagentStart': Object.freeze({ kind: 'session-start', level: 'working' }),
  'SubagentStop': Object.freeze({ kind: 'turn-end', level: 'done' }),
```

add to `replies` (SubagentStop's reply schema is Stop's at Codex 0.162.1):

```js
  'SubagentStop': Object.freeze({ refuse: true, context: false }),
```

and after `encodeReply`:

```js
// A worker's hooks carry the root's session_id and the worker's own agent_id (its thread id);
// no root hook carries agent_id. Spec: docs/specs/2026-10-15-codex-worker-rows.md.
const SUBAGENT_EVENTS = Object.freeze(['SubagentStart', 'SubagentStop']);
/** @param {Record<string, any>} data @param {string} nativeEvent @returns {string|null} */
export function workerIdOf(data, nativeEvent) {
  if (!Object.hasOwn(data, 'agent_id')) {
    if (SUBAGENT_EVENTS.includes(nativeEvent)) throw relayError('INVALID_INPUT', 'a subagent event requires agent_id');
    return null;
  }
  const id = data.agent_id;
  if (typeof id !== 'string' || !id.trim() || id === data.session_id) throw relayError('INVALID_INPUT', 'invalid worker agent_id');
  return id;
}
```

`src/types.js` `Adapter` typedef: add `workerIdOf?: (data: Record<string, any>, nativeEvent: string) => string|null` after `resolveSessionPid`.

`src/adapters/index.js` `normalizeEvent`:

```js
export function normalizeEvent(harness, nativeEvent, raw) {
  const adapter = adapterFor(harness);
  adapter.stateForEvent(nativeEvent);
  const kind = adapter.events[nativeEvent].kind;
  const data = parsePayload(raw, nativeEvent);
  const worker = adapter.workerIdOf?.(data, nativeEvent) ?? null, sessionId = worker ?? data.session_id;
  return validateEvent({ schema: 1, kind, harness, nativeEvent, agentId: `${harness}:${sessionId}`, sessionId,
    ...(worker === null ? {} : { root: `${harness}:${data.session_id}` }), cwd: data.cwd,
    ...(Object.hasOwn(data, 'stop_hook_active') ? { stopHookActive: data.stop_hook_active } : {}),
    tool: kind === 'before-tool' ? { name: data.tool_name, input: data.tool_input,
      command: data.tool_name === 'Bash' && typeof data.tool_input.command === 'string' ? data.tool_input.command : null } : null });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test-one test/codex.test.js test/replies.test.js test/subscribers.test.js` — Expected: PASS. Run: `just check` — Expected: clean.

- [ ] **Step 5: Document the mappings**

In `docs/api.md` "Event mappings", add after the Codex `PermissionRequest` row and after the `Stop` row respectively:

```markdown
| Codex | SubagentStart | session-start | working |
| Codex | SubagentStop | turn-end | done |
```

and after the paragraph beginning "Unlisted events fail;", add:

```markdown
A Codex payload carrying `agent_id` is a worker's event: its `agentId` is
`codex:<agent_id>`, its `sessionId` the `agent_id`, and `root` is `codex:<session_id>`.
`agent_id` must be nonempty text other than `session_id`; SubagentStart and SubagentStop
require it. Anything else is `INVALID_INPUT`. Claude Code and OpenCode payloads are not
routed by `agent_id`. SubagentStop refuses as Stop does (`decision: block`, exit 2), so a
guard on Codex `turn-end` also sees worker turn ends, and its install needs a passed
SubagentStop refusal probe.
```

- [ ] **Step 6: Commit**

```bash
just test-fast
git add src/adapters/codex.js src/adapters/index.js src/types.js test/codex.test.js test/replies.test.js test/subscribers.test.js docs/api.md
git commit -m "feat(codex): route agent_id hooks to the worker and map SubagentStart/SubagentStop"
```

---

### Task 3: The registry publishes worker rows and removes them with their root

**Files:**
- Modify: `src/bus/transaction.js` (`mutate`)
- Test: `test/transaction.test.js`

**Interfaces:**
- Consumes: worker events from Task 2 (`event.root`), `registry-workers.json` from Task 1.
- Produces: `applyEvent` writes `{scope: 'worker', root}` rows for worker events and, on a SessionEnd for agent `X`, removes `X` and every row whose `root` is `X` in one publication.

- [ ] **Step 1: Write the failing tests**

Append to `test/transaction.test.js` (it already imports `fs`, `normalizeEvent`, `applyEvent`, `reapRegistry`, `readSnapshot`, `createProcessOps`, `tempState`, `localObservation`):

```js
const R = '0199f000-0000-7000-8000-000000000001', W1 = '0199f000-0000-7000-8000-000000000002', C = '0199f000-0000-7000-8000-0000000000c1';
const codex = (native, fields = {}) => normalizeEvent('codex', native, JSON.stringify({ session_id: R, cwd: '/repo', ...fields }));
const tool = { tool_name: 'Bash', tool_input: { command: 'true' } };
const worker = (native, fields = {}) => codex(native, { ...fields, agent_id: W1, agent_type: 'default' });
const seed = async (p, handleFor) => {
  const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/registry-workers.json', import.meta.url), 'utf8'));
  for (const agent of Object.values(fixture.agents)) agent.process = handleFor(agent);
  await fs.writeFile(p.agentsPath, JSON.stringify(fixture), { mode: 0o600 });
  return fixture;
};
test('a background worker never moves its root row', async t => {
  const p = await tempState(t), o = localObservation(p);
  for (const native of ['SessionStart', 'UserPromptSubmit', 'Stop']) await applyEvent(codex(native), o);
  const started = await applyEvent(worker('SubagentStart'), o);
  assert.equal(started.snapshot.agents[`codex:${W1}`].state, 'working');
  await applyEvent(worker('PreToolUse', tool), o);
  const { snapshot } = await applyEvent(worker('SubagentStop', { stop_hook_active: false }), o);
  const root = snapshot.agents[`codex:${R}`], row = snapshot.agents[`codex:${W1}`];
  assert.equal(root.state, 'done');
  assert.deepEqual([row.scope, row.root, row.sessionId, row.state], ['worker', `codex:${R}`, W1, 'done']);
  assert.deepEqual(row.process, root.process);
  assert.equal(Object.hasOwn(root, 'root'), false);
});
test('a later worker turn reopens its row without a start event', async t => {
  const p = await tempState(t), o = localObservation(p);
  await applyEvent(worker('SubagentStart'), o);
  await applyEvent(worker('SubagentStop', { stop_hook_active: false }), o);
  const { snapshot } = await applyEvent(worker('PreToolUse', tool), o);
  assert.equal(snapshot.agents[`codex:${W1}`].state, 'working');
});
test('a worker seen before its root still names it, and leaves with it', async t => {
  const p = await tempState(t), o = localObservation(p);
  const first = await applyEvent(worker('PreToolUse', tool), o);
  assert.deepEqual(Object.keys(first.snapshot.agents), [`codex:${W1}`]);
  assert.equal(first.snapshot.agents[`codex:${W1}`].root, `codex:${R}`);
  const ended = await applyEvent(codex('SessionEnd'), { paths: p });
  assert.deepEqual(ended.snapshot.agents, {});
});
test('a root SessionEnd removes the root and its workers, nested included, in one revision', async t => {
  const p = await tempState(t), live = createProcessOps().handleOf(process.pid);
  const fixture = await seed(p, () => live);
  const ended = await applyEvent(normalizeEvent('codex', 'SessionEnd', JSON.stringify({ session_id: R, cwd: '/home/user/project' })), { paths: p });
  assert.deepEqual(Object.keys(ended.snapshot.agents), [`claude-code:${C}`]);
  assert.equal(ended.snapshot.revision, fixture.revision + 1);
});
test('a root SessionEnd removes its workers when its own row is already gone', async t => {
  const p = await tempState(t), live = createProcessOps().handleOf(process.pid);
  const fixture = await seed(p, () => live);
  delete fixture.agents[`codex:${R}`];
  await fs.writeFile(p.agentsPath, JSON.stringify(fixture), { mode: 0o600 });
  const ended = await applyEvent(codex('SessionEnd'), { paths: p });
  assert.deepEqual(Object.keys(ended.snapshot.agents), [`claude-code:${C}`]);
});
test('a dead codex process takes its root and every worker with it', async t => {
  const p = await tempState(t), live = createProcessOps().handleOf(process.pid);
  const dead = { ...live, start: String(BigInt(live.start) + 1n) };
  await seed(p, agent => agent.harness === 'codex' ? dead : live);
  const reaped = await reapRegistry({ paths: p });
  assert.deepEqual(reaped.reaped.sort(), [`codex:${R}`, `codex:${W1}`, 'codex:0199f000-0000-7000-8000-000000000003']);
  assert.deepEqual(Object.keys(reaped.snapshot.agents), [`claude-code:${C}`]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `just test-one test/transaction.test.js`
Expected: FAIL — worker rows are written as `scope: 'session'` with no `root` (the transaction does not copy it yet), so the scope and root assertions fail, and the cascade tests leave worker rows behind.

- [ ] **Step 3: Implement**

In `src/bus/transaction.js` `mutate`, replace the `if (level === null) { … }` branch and the row construction:

```js
      if (level === null) {
        // A root's SessionEnd ends its workers too: they share its process and have no end event.
        const ended = Object.keys(agents).filter(id => id === event.agentId || agents[id].root === event.agentId);
        changed ||= ended.length > 0;
        for (const id of ended) delete agents[id];
      }
      else {
        const state = adapter.reduceState(level,agents[event.agentId]?.state ?? null);
        const {remote,repoRoot} = /** @type {{remote: string|null, repoRoot: string|null}} */ (context);
        agents[event.agentId] = {id:event.agentId,harness:event.harness,sessionId:event.sessionId,
          scope:event.harness === 'opencode' ? 'process' : event.root === undefined ? 'session' : 'worker',
          ...(event.root === undefined ? {} : {root:event.root}),process:handle,cwd:event.cwd,repoRoot,remote,
          projectKey:projectKeyFor({remote,repoRoot,cwd:event.cwd}),project:displayProject({remote,repoRoot,cwd:event.cwd}),state: /** @type {import("../types.js").State} */ (state),updatedAt:opts.now()};
        changed = true;
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test-one test/transaction.test.js` — Expected: PASS, including the existing tests. Run: `just check` — Expected: clean.

- [ ] **Step 5: Commit and close the subsumed task**

```bash
just test-fast
git add src/bus/transaction.js test/transaction.test.js
git commit -m "feat(registry): publish Codex worker rows and remove them with their root"
tasks done relay-15b49c "Worker events now update their own codex:<agent_id> row (scope worker); the root row is untouched, pinned by the background-worker test in test/transaction.test.js (relay-635fdc Task 3)."
```

---

### Task 4: The installer binds the worker lifecycle, with its rollout runbook

**Files:**
- Modify: `src/install/hooks.js:11`
- Test: `test/install-hooks.test.js`, `test/install-capabilities.test.js`
- Docs: `docs/runbooks/hook-install-rollback.md`

**Interfaces:**
- Consumes: Codex `events`/`replies` from Task 2.
- Produces: `bindingsFor('codex')` events in order `SessionStart, SubagentStart, UserPromptSubmit, PreToolUse, PermissionRequest, Stop, SubagentStop, SessionEnd`.

- [ ] **Step 1: Write the failing tests**

Append to `test/install-hooks.test.js` (import `bindingsFor` from `../src/install/hooks.js` alongside `planHooks`):

```js
test('Codex binds the worker lifecycle with the default budget and no matcher', () => {
  assert.deepEqual(bindingsFor('codex').map(binding => binding.event),
    ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Stop', 'SubagentStop', 'SessionEnd']);
  const hooks = JSON.parse(planHooks({ text: '{"hooks":{}}', harness: 'codex', relayBin: relay, subscribersPath: subscribers })).hooks;
  for (const event of ['SubagentStart', 'SubagentStop']) {
    const [entry] = hooks[event];
    assert.equal(Object.hasOwn(entry, 'matcher'), false, event);
    assert.match(entry.hooks[0].command, new RegExp(` hook --harness codex --outer-ms 600000 --subscribers \\S+ ${event}$`), event);
    assert.equal(entry.hooks[0].timeout, 600, event);
  }
});
```

Append to `test/install-capabilities.test.js` (import `validateCapabilities` from `../src/install/capabilities.js` and `bindingsFor` from `../src/install/hooks.js` if not already imported):

```js
test('a Codex turn-end guard needs a passed SubagentStop refusal probe as well as Stop', () => {
  const subscribers = { schema: 1, subscribers: [{ name: 'g', role: 'guard', kinds: ['turn-end'], harnesses: ['codex'], tools: null, argv: ['/usr/bin/true'], timeoutMs: 1000 }] };
  const evidence = (events) => ({ schema: 1, harness: 'codex', version: '0.162.1',
    probes: events.map(event => ({ event, reply: 'refuse', outerMs: 600000, passed: true })) });
  assert.throws(() => validateCapabilities({ harness: 'codex', subscribers, bindings: bindingsFor('codex'), evidence: evidence(['Stop']) }),
    { code: 'UNSUPPORTED_BINDING', message: /SubagentStop/ });
  validateCapabilities({ harness: 'codex', subscribers, bindings: bindingsFor('codex'), evidence: evidence(['Stop', 'SubagentStop']) });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `just test-one test/install-hooks.test.js test/install-capabilities.test.js`
Expected: FAIL — the binding list lacks SubagentStart and SubagentStop, and the capability check passes with Stop alone.

- [ ] **Step 3: Implement**

`src/install/hooks.js` line 11:

```js
  codex: [['SessionStart'], ['SubagentStart'], ['UserPromptSubmit'], ['PreToolUse', '*'], ['PermissionRequest'], ['Stop'], ['SubagentStop'], ['SessionEnd', undefined, 3000]],
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test-one test/install-hooks.test.js test/install-capabilities.test.js` — Expected: PASS.
Run: `just test-fast` — Expected: PASS. If another test pins the full Codex binding list or hooks file (`grep -n "SessionEnd\|PermissionRequest" test/install-*.test.js`), add the two events there in the order above; do not change behavior to fit it.

- [ ] **Step 5: Write the rollout runbook section**

Append to `docs/runbooks/hook-install-rollback.md`:

```markdown
## Activating Codex worker rows

Codex workers get their own registry rows (`scope: "worker"`, spec
`docs/specs/2026-10-15-codex-worker-rows.md`). Before relay hooks run under Codex on a
host where tasks' relay identity is on:

1. Every `tasks` binary each harness resolves on `PATH` carries the worker-scope and
   thread-hint tie-break change (the tasks project task "Accept relay Codex worker rows:
   worker scope and thread-hint tie-break"). An older tasks refuses the whole registry
   while any worker row exists, Claude sessions included.
2. Every relay writer on the host resolves to a relay with worker rows: the installed
   hook command of every harness (Claude Code settings, Codex `hooks.json`, the OpenCode
   plugin when enabled), every `relay reap`, and every package that depends on relay and
   calls `applyEvent` or `reapRegistry` (familiar pins its own). List each writer with
   the relay path it runs. An older writer refuses a snapshot holding a worker row with
   `INVALID_SCHEMA` and writes nothing: its hook reports the diagnostic, its observers
   are skipped, and `relay reap` and `relay list` fail until it is upgraded.
3. Install the Codex hooks, which now include SubagentStart and SubagentStop. A guard on
   Codex `turn-end` needs a passed SubagentStop refusal probe in `--evidence` as well as
   Stop's. Re-trust the changed hooks in Codex.
```

- [ ] **Step 6: Commit**

```bash
git add src/install/hooks.js test/install-hooks.test.js test/install-capabilities.test.js docs/runbooks/hook-install-rollback.md
git commit -m "feat(install): bind Codex SubagentStart and SubagentStop; runbook for worker rows"
```

---

### Task 5: Registry acceptance through relay's own hooks, and the older-writer check

**Files:**
- Create: `tools/codex-subagent-capture/lib.sh`, `tools/codex-subagent-capture/judge-registry.mjs`
- Modify: `tools/codex-subagent-capture/run`, `tools/codex-subagent-capture/summarize.mjs`
- Create: `docs/notes/2026-10-15-codex-worker-rows-acceptance.md`

**Interfaces:**
- Consumes: the whole relay change (Tasks 1–4), `registry-workers.json`.
- Produces: `lib.sh` functions used by Task 6: `capture_home OUT` (private `CODEX_HOME` at `OUT/home` with only `auth.json` copied in, `OUT/log`, the hook `OUT/hook.sh`), `plain_hooks OUT` (the logging hook alone on every event), `install_relay OUT RELAY_BIN` (empty subscriber file at `OUT/relay-config/subscribers.json`, private state at `OUT/relay-state`, relay's hooks in `OUT/home/hooks.json`), `wrap_relay OUT` (every relay hook command runs inside the logging hook, which then copies the registry, and the tasks claims when `CAPTURE_CLAIMS` is set, before passing relay's reply through), `scrub_auth OUT`. Per hook record `<seq>-<Event>.json`, the copies are `<seq>-<Event>.agents.json` and `<seq>-<Event>.claims.json`. `run --relay` and `judge-registry.mjs OUT_DIR` exit 0 on pass, 1 on fail, 2 on an invalid run.

- [ ] **Step 1: Extract the shared setup into `lib.sh`**

`tools/codex-subagent-capture/lib.sh` (sourced, never run; it replaces `run`'s inline auth
copy, `hook.sh` heredoc and hooks.json writer):

```bash
# Shared setup for the Codex capture tools. Sourced by run and by codex-worker-claims/run.

# A private CODEX_HOME at OUT/home holding only a copy of auth.json, OUT/log, OUT/hook.sh.
capture_home() {
  local out=$1 auth=${CODEX_AUTH:-$HOME/.codex/auth.json}
  [[ -r $auth ]] || { echo "no readable Codex auth at $auth" >&2; return 2; }
  mkdir -p "$out/home" "$out/log"
  install -m 600 "$auth" "$out/home/auth.json"
  cat >"$out/hook.sh" <<'HOOK'
#!/usr/bin/env bash
# Records each hook as JSON: payload, CODEX_* env and /proc ancestry. Given a third argument,
# it wraps that hook command: the payload is piped to it first, then the relay registry (and
# tasks' claims, when CAPTURE_CLAIMS is set) is copied, and the command's reply and exit
# code are passed through. Each copy is therefore the state that event left.
event=$1 log=$2 wrapped=${3:-}
exec 3>&2 2>>"$log/hook.stderr"
seq=$(date +%s%N)
payload=$(cat)
rc=0
if [[ -n $wrapped ]]; then
  printf '%s' "$payload" | sh -c "$wrapped" >"$log/$seq-$event.reply" 2>"$log/$seq-$event.reply-stderr" || rc=$?
  [[ -n ${RELAY_STATE_DIR:-} && -r $RELAY_STATE_DIR/agents.json ]] && cp "$RELAY_STATE_DIR/agents.json" "$log/$seq-$event.agents.json"
  [[ -n ${CAPTURE_CLAIMS:-} ]] && tasks claims >"$log/$seq-$event.claims.json"
fi
chain='[' pid=$$ sep=
while [[ $pid -gt 1 && -r /proc/$pid/stat ]]; do
  stat=$(</proc/$pid/stat)
  comm=${stat#*(} comm=${comm%)*}
  rest=${stat##*) } ppid=$(cut -d' ' -f2 <<<"$rest")
  argv0=$(tr '\0' '\n' </proc/$pid/cmdline | head -1)
  chain+="$sep{\"pid\":$pid,\"ppid\":$ppid,\"comm\":$(jq -Rn --arg v "$comm" '$v'),\"argv0\":$(jq -Rn --arg v "$argv0" '$v')}"
  sep=, pid=$ppid
done
chain+=']'
env_json=$(env | grep '^CODEX_' | jq -Rn '[inputs | capture("^(?<key>[^=]+)=(?<value>.*)$")] | from_entries')
jq -n --arg event "$event" --argjson payload "$payload" --argjson env "$env_json" --argjson ancestry "$chain" \
  '{event: $event, payload: $payload, env: $env, ancestry: $ancestry}' >"$log/$seq-$event.json"
if [[ -n $wrapped ]]; then
  cat "$log/$seq-$event.reply"; cat "$log/$seq-$event.reply-stderr" >&3
  exit "$rc"
fi
# A failing logger must not block the run: Codex reads exit 2 as a refusal.
exit 0
HOOK
  chmod 700 "$out/hook.sh"
}

scrub_auth() { rm -f "$1/home/auth.json"; }

CAPTURE_EVENTS=(SessionStart SubagentStart UserPromptSubmit PreToolUse PostToolUse PermissionRequest Stop SubagentStop SessionEnd)

# The logging hook alone, on every event.
plain_hooks() {
  local out=$1
  jq -n --arg hook "$out/hook.sh" --arg log "$out/log" '
    {hooks: ($ARGS.positional | map({key: ., value: [{hooks: [{type: "command",
      command: "\($hook | @sh) \(. | @sh) \($log | @sh)", timeout: 30}]}]}) | from_entries)}' \
    --args "${CAPTURE_EVENTS[@]}" >"$out/home/hooks.json"
}

# Relay's own hooks, from relay install, into OUT/home/hooks.json; private state and config.
install_relay() {
  local out=$1 relay=$2
  mkdir -p "$out/relay-config" "$out/relay-state" && chmod 700 "$out/relay-config" "$out/relay-state"
  printf '{"schema":1,"subscribers":[]}\n' >"$out/relay-config/subscribers.json"
  chmod 600 "$out/relay-config/subscribers.json"
  printf '{"hooks":{}}\n' >"$out/home/hooks.json"
  node "$relay" install --harness codex --subscribers "$out/relay-config/subscribers.json" \
    --target "$out/home/hooks.json" --artifact "$out/relay-install.json" --apply >"$out/relay-install.out"
}

# Run every relay hook inside the logging hook, and log PostToolUse, which relay does not bind.
wrap_relay() {
  local out=$1 tmp
  tmp=$(mktemp)
  jq --arg hook "$out/hook.sh" --arg log "$out/log" '
    .hooks |= with_entries(.key as $e | .value |= map(.hooks |= map(.command =
      "\($hook | @sh) \($e | @sh) \($log | @sh) \(.command | @sh)")))
    | .hooks.PostToolUse = ((.hooks.PostToolUse // []) + [{hooks: [{type: "command",
      command: "\($hook | @sh) PostToolUse \($log | @sh)", timeout: 30}]}])' \
    <"$out/home/hooks.json" >"$tmp" && mv "$tmp" "$out/home/hooks.json"
}
```

In `run`: source it (`. "$(dirname "$0")/lib.sh"`), replace the inline auth copy, heredoc
and hooks.json writer with `capture_home "$out"` and, without `--relay`, `plain_hooks
"$out"`; keep its `cleanup` trap but have it call `scrub_auth "$out"`. Add an option
parsed before `--case`:

```bash
relay=
if [[ ${1:-} == --relay ]]; then relay=${2:?--relay needs the path to bin/relay.js}; shift 2; fi
```

With `--relay`: call `install_relay "$out" "$relay"` then `wrap_relay "$out"` instead of
`plain_hooks`, and export `RELAY_STATE_DIR="$out/relay-state"` before Codex starts (the
TUI's tmux command line needs it too: add `RELAY_STATE_DIR=$(printf %q "$RELAY_STATE_DIR")`
beside `CODEX_HOME`).

The `background` case must end the TUI in order, so that its SessionEnd fires. Replace its
`sleep 3` / capture / `kill-session` sequence with:

```bash
  sleep 3
  tmux capture-pane -p -t "$tmux_session" >"$out/tui.txt" || true
  # Quit through the TUI so Codex fires SessionEnd; kill only if it has not exited.
  tmux send-keys -t "$tmux_session" /quit Enter
  quit_deadline=$((SECONDS + 20))
  until compgen -G "$out/log/*-SessionEnd.json" >/dev/null || ((SECONDS >= quit_deadline)); do sleep 1; done
  compgen -G "$out/log/*-SessionEnd.json" >/dev/null || echo "no SessionEnd within 20 s of /quit" >>"$out/tui-shutdown"
  tmux kill-session -t "$tmux_session" 2>/dev/null || true
  tmux_session=
```

After the run, reap separately, once the Codex process has exited:

```bash
if [[ -n $relay ]]; then
  RELAY_STATE_DIR="$out/relay-state" node "$relay" reap --outer-ms 30000 >/dev/null || status=$?
  if [[ -r $out/relay-state/agents.json ]]; then cp "$out/relay-state/agents.json" "$out/final-agents.json"
  else echo null >"$out/final-agents.json"; fi
fi
```

In `summarize.mjs`, read hook records only: the run now also writes `.agents.json`,
`.claims.json`, `.reply` and `.reply-stderr` files beside them. Replace its `files` line with:

```js
const files = readdirSync(log).filter(name => /^\d+-[A-Za-z]+\.json$/.test(name)).sort();
```

- [ ] **Step 2: Verify the refactor kept the plain capture**

Run: `tools/codex-subagent-capture/run --case single /tmp/relay-635fdc-single && node tools/codex-subagent-capture/summarize.mjs /tmp/relay-635fdc-single`
Expected: the 12-row table of brief §7 (labels identical), and no `home/auth.json` left.

- [ ] **Step 3: Write the registry judge**

`tools/codex-subagent-capture/judge-registry.mjs`:

```js
#!/usr/bin/env node
// Judge a `run --relay` capture. Worker rows exist with scope worker and their root, share
// the root's handle and never move the root row; the root's SessionEnd publication removes
// the root and its workers; reap after the process exits leaves nothing. Only events relay
// handled (wrapped hooks, which leave a .reply file) carry a registry copy; PostToolUse is
// logged only and is skipped. Exit 0 pass, 1 fail, 2 invalid run (no worker event).
// Usage: judge-registry.mjs OUT_DIR
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const dir = process.argv[2];
if (!dir) throw new Error('usage: judge-registry.mjs OUT_DIR');
const log = join(dir, 'log'), read = path => JSON.parse(readFileSync(path, 'utf8'));
const records = readdirSync(log).filter(name => /^\d+-[A-Za-z]+\.json$/.test(name)).sort().map(name => {
  const base = join(log, name.replace(/\.json$/, ''));
  return { name, ...read(join(log, name)), wrapped: existsSync(`${base}.reply`),
    after: existsSync(`${base}.agents.json`) ? read(`${base}.agents.json`) : null };
});
const failures = [], fail = message => failures.push(message);
const handled = records.filter(record => record.wrapped);
const workerEvents = handled.filter(record => typeof record.payload.agent_id === 'string');
if (!workerEvents.length) { console.log('INVALID: no worker event reached relay'); process.exit(2); }
const rooted = (rows, rootId) => Object.values(rows).filter(row => row.id === rootId || row.root === rootId).map(row => row.id);
let previousRoot = null, ended = false;
for (const record of handled) {
  if (record.after === null) { fail(`${record.name}: no registry copy after a relay event`); continue; }
  const rootId = `codex:${record.payload.session_id}`, rows = record.after.agents, root = rows[rootId] ?? null;
  if (typeof record.payload.agent_id === 'string') {
    const row = rows[`codex:${record.payload.agent_id}`];
    if (!row) fail(`${record.name}: no worker row`);
    else {
      if (row.scope !== 'worker' || row.root !== rootId) fail(`${record.name}: worker row scope ${row.scope}, root ${row.root}`);
      if (root && !isDeepStrictEqual(row.process, root.process)) fail(`${record.name}: worker and root handles differ`);
    }
    if (!isDeepStrictEqual(root, previousRoot)) fail(`${record.name}: a worker event changed the root row`);
  }
  if (record.event === 'SessionEnd') {
    ended = true;
    const left = rooted(rows, rootId);
    if (left.length) fail(`${record.name}: SessionEnd left ${left.join(', ')}`);
  }
  previousRoot = root;
}
if (!ended) fail('no SessionEnd publication captured');
const final = existsSync(join(dir, 'final-agents.json')) ? read(join(dir, 'final-agents.json')) : undefined;
if (final === undefined) fail('no final-agents.json (reap result)');
else if (final !== null && Object.keys(final.agents).length) fail(`rows left after reap: ${Object.keys(final.agents).join(', ')}`);
for (const message of failures) console.log(`FAIL: ${message}`);
console.log(failures.length ? `FAIL (${failures.length})` : `PASS: ${workerEvents.length} worker events, SessionEnd removed the session's rows, reap left none`);
process.exit(failures.length ? 1 : 0);
```

The root row check compares the whole row: a root event between two worker events updates `previousRoot` first, so only a worker event can trip it. Each copy is taken inside the wrapped relay hook, after relay published that event. Hooks of different events can still interleave if the controller acts while a worker runs; none of the three cases does that, so a root-row failure here is a defect to debug, not noise.

- [ ] **Step 4: Run the registry acceptance**

```bash
for c in single nested background; do
  tools/codex-subagent-capture/run --relay "$PWD/bin/relay.js" --case $c /tmp/relay-635fdc-reg-$c >/dev/null
  echo "== $c"; node tools/codex-subagent-capture/judge-registry.mjs /tmp/relay-635fdc-reg-$c
done
```

Expected: `PASS` for each case, each naming SessionEnd. An `INVALID` result (the model did not spawn) is rerun, at most twice. For `background`, a `tui-shutdown` file means `/quit` produced no SessionEnd: that is a FAIL to investigate (which key ends the TUI in order), never a pass by reap. A `FAIL` is a defect: stop, debug with superpowers:systematic-debugging, and fix in the owning task's files with a test before rerunning.

- [ ] **Step 5: Run the older-writer check**

```bash
old=$(mktemp -d) state=$(mktemp -d) && chmod 700 "$state"
git archive 022f29d src | tar -x -C "$old"
cp test/fixtures/registry-workers.json "$state/agents.json" && chmod 600 "$state/agents.json"
before=$(sha256sum <"$state/agents.json")
RELAY_STATE_DIR=$state node --input-type=module -e "
  const { reapRegistry, applyEvent } = await import('$old/src/bus/transaction.js');
  const { normalizeEvent } = await import('$old/src/adapters/index.js');
  for (const [name, run] of [['reap', () => reapRegistry()], ['claude event', () => applyEvent(normalizeEvent('claude-code', 'SessionStart', JSON.stringify({ session_id: 'c', cwd: '/tmp' })), { resolveSessionPid: () => null, gitContext: async () => ({ remote: null, repoRoot: null }) })]])
    await run().then(() => console.log(name, 'WROTE'), e => console.log(name, 'refused', e.code));"
[[ $(sha256sum <"$state/agents.json") == "$before" ]] && echo unchanged || echo CHANGED
rm -rf "$old" "$state"
```

Expected: `reap refused INVALID_SCHEMA`, `claude event refused INVALID_SCHEMA`, `unchanged`.

- [ ] **Step 6: Record the evidence**

Create `docs/notes/2026-10-15-codex-worker-rows-acceptance.md` with: the Codex version (`codex --version`), the relay commit, each case's judge output and its `summarize.mjs` table (ids redacted by the summarizer), the older-writer output, and the date. Remove `/tmp/relay-635fdc-*` afterwards; confirm no `home/auth.json` remains in any of them first.

- [ ] **Step 7: Commit**

```bash
git add tools/codex-subagent-capture docs/notes/2026-10-15-codex-worker-rows-acceptance.md
git commit -m "test(acceptance): judge Codex worker rows from relay's own hooks"
```

---

### Task 6: Claim acceptance through tasks, and the sandboxed refusal control

Runs only when the `tasks` on `PATH` carries tasks-af3aac. Check first: `tasks show tasks-af3aac | jq -r .task.status` is `done` and the installed binary was built after it landed; otherwise stop and park this task `--reason dependency`.

**Files:**
- Create: `tools/codex-worker-claims/run`, `tools/codex-worker-claims/judge.mjs`
- Modify: `docs/notes/2026-10-15-codex-worker-rows-acceptance.md`

**Interfaces:**
- Consumes: `lib.sh` from Task 5 (`capture_home`, `install_relay`, `wrap_relay`, `scrub_auth`); its `<seq>-<Event>.claims.json` copies when `CAPTURE_CLAIMS=1`.
- Produces: `run [--sandboxed] [OUT_DIR]` leaves `OUT/A.json`, `OUT/B.json` (`tasks show` output after the run), `OUT/ids` (`A=…`, `B=…`), and the hook log with registry and claims copies; `judge.mjs OUT_DIR [--sandboxed]` exits 0 pass, 1 fail, 2 invalid run.

- [ ] **Step 1: Write the run script**

`tools/codex-worker-claims/run`:

```bash
#!/usr/bin/env bash
# One Codex controller and one worker acquire separate tasks through relay identity, then
# each tries to start, park and close the other's task. Everything lives under OUT_DIR: a
# private CODEX_HOME, relay state and subscriber file, tasks config and state, and a
# throwaway tasks project. --sandboxed runs the refusal control under workspace-write.
# Usage: tools/codex-worker-claims/run [--sandboxed] [OUT_DIR]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
. "$here/../codex-subagent-capture/lib.sh"
sandboxed=; [[ ${1:-} == --sandboxed ]] && { sandboxed=1; shift; }
out=${1:-$(mktemp -d "${TMPDIR:-/tmp}/codex-worker-claims.XXXXXX")}
mkdir -p "$out" && out=$(cd "$out" && pwd -P)
relay=$(cd "$here/../.." && pwd -P)/bin/relay.js
trap 'scrub_auth "$out"' EXIT

capture_home "$out"
install_relay "$out" "$relay"
wrap_relay "$out"
mkdir -p "$out/xdg-config/tasks" "$out/xdg-state" "$out/project"
printf '[identity]\nrelay = true\n' >"$out/xdg-config/tasks/config.toml"
export XDG_CONFIG_HOME=$out/xdg-config XDG_STATE_HOME=$out/xdg-state RELAY_STATE_DIR=$out/relay-state TASKS_FORMAT=json
git -C "$out/project" init -q
(cd "$out/project" && tasks init --prefix wk >/dev/null)
A=$(cd "$out/project" && tasks add "A" -p 2 | jq -r .id) B=$(cd "$out/project" && tasks add "B" -p 2 | jq -r .id)
(cd "$out/project" && git add -A && git -c user.name=t -c user.email=t@t commit -qm init)
printf 'A=%s\nB=%s\n' "$A" "$B" >"$out/ids"

model=${CAPTURE_MODEL:-$(sed -n 's/^model = "\(.*\)"$/\1/p' "$HOME/.codex/config.toml" | head -1)}
if [[ -n $sandboxed ]]; then
  sandbox="sandbox_mode = \"workspace-write\"
[sandbox_workspace_write]
writable_roots = [\"$out\"]"
  prompt="Run the shell command \`tasks start $A 2>&1; echo exit=\$?\` exactly once and reply with its output. Run nothing else."
else
  # Host PID view: a workspace-write sandbox hides the codex session process from tasks.
  sandbox='sandbox_mode = "danger-full-access"'
  # Each command reports its exit code and folds stderr (where tasks writes errors) into the
  # tool result the judge reads.
  x='2>&1; echo exit=$?'
  prompt="Follow these steps exactly, running each command verbatim as one shell command and nothing else. 1. Run \`tasks start $A $x\`. 2. Spawn exactly one subagent named worker with this instruction: \"Run \`tasks start $B $x\`. Then run each of these once, continuing after failures: \`tasks start $A $x\`, \`tasks park $A probe $x\`, \`tasks done $A probe $x\`. Then reply done.\" 3. Wait for the worker to finish. 4. Run each of these once, continuing after failures: \`tasks start $B $x\`, \`tasks park $B probe $x\`, \`tasks done $B probe $x\`. 5. Reply with the single word done."
fi
cat >"$out/home/config.toml" <<TOML
model = "$model"
approval_policy = "never"
$sandbox

[features]
hooks = true
multi_agent = true
TOML

status=0
env -i HOME="$HOME" PATH="$PATH" USER="${USER:-}" LANG="${LANG:-C.UTF-8}" TERM=dumb \
  CODEX_HOME="$out/home" XDG_CONFIG_HOME="$XDG_CONFIG_HOME" XDG_STATE_HOME="$XDG_STATE_HOME" \
  RELAY_STATE_DIR="$RELAY_STATE_DIR" TASKS_FORMAT=json CAPTURE_CLAIMS=1 \
  timeout "${CAPTURE_TIMEOUT:-900}" codex exec --skip-git-repo-check --dangerously-bypass-hook-trust \
  -C "$out/project" "$prompt" >"$out/exec.stdout" 2>"$out/exec.stderr" || status=$?
(cd "$out/project" && tasks show "$A" >"$out/A.json" && tasks show "$B" >"$out/B.json")
codex --version >"$out/codex-version"; tasks --version >"$out/tasks-version"
echo "$out"
exit "$status"
```

`env -i` keeps `TASKS_SESSION`, `TASKS_SESSION_PID` and `CLAUDE_CODE_SESSION_ID` out of Codex and its commands: identity comes from the relay row and Codex's own `CODEX_THREAD_ID` export alone. `CAPTURE_CLAIMS=1` reaches the hooks only, which snapshot `tasks claims` after every relay-bound event, while every claim is still live.

- [ ] **Step 2: Write the judge**

`tools/codex-worker-claims/judge.mjs`:

```js
#!/usr/bin/env node
// Judge a codex-worker-claims run from command results, tasks' claims and relay's rows,
// never from the transcript. Each scripted command ends `2>&1; echo exit=$?`, so its
// PostToolUse result carries tasks' error JSON (tasks writes errors to stderr) and its exit
// code. Exit 0 pass, 1 fail, 2 invalid run (the model skipped or altered a command).
// Usage: judge.mjs OUT_DIR [--sandboxed]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const [dir, mode] = process.argv.slice(2);
if (!dir) throw new Error('usage: judge.mjs OUT_DIR [--sandboxed]');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const ids = Object.fromEntries(readFileSync(join(dir, 'ids'), 'utf8').trim().split('\n').map(line => line.split('=')));
const log = join(dir, 'log');
const records = readdirSync(log).filter(name => /^\d+-[A-Za-z]+\.json$/.test(name)).sort().map(name => {
  const copy = suffix => { const path = join(log, name.replace(/\.json$/, suffix)); return existsSync(path) ? read(path) : null; };
  return { ...read(join(log, name)), after: copy('.agents.json'), claims: copy('.claims.json')?.claims ?? null };
});
const invalid = message => { console.log(`INVALID: ${message}`); process.exit(2); };
const failures = [], fail = message => failures.push(message);
// Claims seen while the run was live, per task id: every recorded holder session.
const holders = id => records.flatMap(r => (r.claims ?? []).filter(c => c.id === id).map(c => c.session));
const isBy = (record, by) => by === 'worker' ? typeof record.payload.agent_id === 'string' : !Object.hasOwn(record.payload, 'agent_id');
// The result of the one command `by` ran containing `text`: exit code and tasks' error, if any.
function result(by, text) {
  const pre = records.filter(r => r.event === 'PreToolUse' && r.payload.tool_name === 'Bash' && isBy(r, by)
    && String(r.payload.tool_input?.command ?? '').includes(text));
  if (pre.length !== 1) invalid(`${by} ran "${text}" ${pre.length} times`);
  const post = records.find(r => r.event === 'PostToolUse' && r.payload.tool_use_id === pre[0].payload.tool_use_id);
  if (!post) { fail(`no result captured for ${by} "${text}"`); return null; }
  const out = post.payload.tool_response;
  if (typeof out !== 'string') { fail(`${by} "${text}": tool_response is ${typeof out}, expected text`); return null; }
  const exit = /^exit=(\d+)$/m.exec(out);
  if (!exit) invalid(`${by} "${text}" did not report its exit code`);
  let error = null;
  const line = out.split('\n').find(l => l.startsWith('{"error"'));
  if (line) { try { error = JSON.parse(line).error; } catch { fail(`${by} "${text}": unparsable error ${line}`); } }
  return { exit: Number(exit[1]), error, out };
}
const succeeds = (by, text) => {
  const r = result(by, text);
  if (r && (r.exit !== 0 || r.error)) fail(`${by} "${text}" failed: exit ${r.exit}, ${r.error?.kind ?? r.out.trim()}`);
};
const refuses = (by, text, kind, detail = null) => {
  const r = result(by, text);
  if (!r) return;
  if (r.exit === 0 || r.error?.kind !== kind) fail(`${by} "${text}": exit ${r.exit}, kind ${r.error?.kind ?? 'none'} (${r.out.trim()}), expected refusal ${kind}`);
  else if (detail && !detail.test(r.error.detail ?? '')) fail(`${by} "${text}": ${kind} for another reason: ${r.error.detail}`);
};
const A = read(join(dir, 'A.json')), B = read(join(dir, 'B.json'));
const markers = task => (task.task.notes ?? []).filter(n => /^(started|resumed|done|dropped|parked)/.test(n.text));

if (mode === '--sandboxed') {
  // The sandbox hides the session process behind a pid-1 helper: tasks must refuse with its
  // PID-namespace diagnostic, nothing else.
  refuses('controller', `tasks start ${ids.A}`, 'config',
    /^relay identity: the nearest codex ancestor is pid 1 with no parent, so this command runs in a PID namespace/);
  if (holders(ids.A).length) fail(`A was claimed under the sandbox by ${holders(ids.A).join(', ')}`);
  if (A.task.status !== 'todo') fail(`A status ${A.task.status}`);
} else {
  succeeds('controller', `tasks start ${ids.A}`);
  succeeds('worker', `tasks start ${ids.B}`);
  for (const verb of ['start', 'park', 'done']) {
    refuses('worker', `tasks ${verb} ${ids.A}`, 'claimed');
    refuses('controller', `tasks ${verb} ${ids.B}`, 'claimed');
  }
  const start = records.find(r => r.event === 'SessionStart'), sub = records.find(r => r.event === 'SubagentStart');
  if (!start || !sub) invalid('no SessionStart or SubagentStart captured');
  const R = `codex:${start.payload.session_id}`, W = `codex:${sub.payload.agent_id}`;
  const rows = id => records.map(r => r.after?.agents?.[id]).filter(Boolean);
  const [rootRow] = rows(R), [workerRow] = rows(W);
  if (!rootRow || !workerRow) fail('the registry never held both the root and the worker row');
  else {
    if (workerRow.scope !== 'worker' || workerRow.root !== R) fail(`worker row scope ${workerRow.scope}, root ${workerRow.root}`);
    if (!isDeepStrictEqual(workerRow.process, rootRow.process)) fail('root and worker rows do not share a handle');
  }
  for (const [name, task, owner] of [['A', A, R], ['B', B, W]]) {
    if (task.task.status !== 'doing') fail(`${name} status ${task.task.status}`);
    const seen = holders(ids[name]);
    if (!seen.length) fail(`${name} was never claimed while the run was live`);
    else if (seen.some(session => session !== owner)) fail(`${name} held by ${[...new Set(seen)].join(', ')}, expected only ${owner}`);
    const lifecycle = markers(task);
    if (lifecycle.length !== 1 || lifecycle[0].text !== 'started') fail(`${name} lifecycle notes ${JSON.stringify(lifecycle.map(n => n.text))}`);
    else if (lifecycle[0].harness_session !== owner) fail(`${name} started by ${lifecycle[0].harness_session}, expected ${owner}`);
  }
}
for (const message of failures) console.log(`FAIL: ${message}`);
console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
process.exit(failures.length ? 1 : 0);
```

The refusal kinds come from tasks' source: a live claim held by another session refuses
`start`, `park` and `done` with `claimed` (`src/commands/mod.rs`, `src/commands/park.rs`).
Under the workspace-write sandbox the nearest `codex` process tasks can see is the sandbox
helper, pid 1 with no parent, and the resolver names that case before any row matching
(`src/relay/resolve.rs`, the `nearest.pid == 1 && nearest.ppid == 0` branch): kind
`config`, detail `relay identity: the nearest codex ancestor is pid 1 with no parent, so
this command runs in a PID namespace that hides the harness session process …`. The
control requires that diagnostic, a nonzero exit, and no claim on A; the generic "no relay
agent matches" refusal would mean the namespace was not detected, and fails. A command that never reached tasks (`command not found`, exit
127) fails every expectation. Codex 0.162.1 gave a Bash PostToolUse `tool_response` as
text (brief §7); any other shape fails rather than being searched loosely.

Claims are read from the snapshots taken during the run, because once Codex exits its claims are no longer live. Every snapshot that holds A's claim must name R, and every one holding B's must name W, so a cross attempt that took a claim over fails even if it was later released. The claim's `session` and the note's `harness_session` are the relay agent id and the native `codex:<thread>` respectively; for a Codex root the thread is the session id, so both equal `codex:<R>` for A and `codex:<W>` for B. If the first valid run shows tasks recording the claim session in another form, record it in the acceptance note and ask before changing the judge: a different form is a finding about the tasks change, not a judge bug.

- [ ] **Step 3: Run the positive acceptance**

```bash
chmod +x tools/codex-worker-claims/run tools/codex-worker-claims/judge.mjs
tools/codex-worker-claims/run /tmp/relay-635fdc-claims >/dev/null; node tools/codex-worker-claims/judge.mjs /tmp/relay-635fdc-claims
```

Expected: `PASS`. `INVALID` is rerun, at most twice. `FAIL` stops the task: record the judge output in a task note and park `--waiting-on user --reason decision` if the failure is in tasks' behavior, or debug relay with superpowers:systematic-debugging if it is in the rows.

- [ ] **Step 4: Run the sandboxed refusal control**

```bash
tools/codex-worker-claims/run --sandboxed /tmp/relay-635fdc-claims-sbx >/dev/null; node tools/codex-worker-claims/judge.mjs /tmp/relay-635fdc-claims-sbx --sandboxed
```

Expected: `PASS` (A unclaimed and `todo`). Record the refusal text from `exec.stdout`.

- [ ] **Step 5: Record the evidence and clean up**

Add a "Claim acquisition" section to `docs/notes/2026-10-15-codex-worker-rows-acceptance.md`: Codex and tasks versions, both judge outputs, the cross-claim refusal messages (from each command's PostToolUse `tool_response`, ids redacted to A, B, R, W), and the control's refusal. Confirm no `home/auth.json` remains, then `rm -rf /tmp/relay-635fdc-claims /tmp/relay-635fdc-claims-sbx`.

- [ ] **Step 6: Commit**

```bash
git add tools/codex-worker-claims docs/notes/2026-10-15-codex-worker-rows-acceptance.md
git commit -m "test(acceptance): prove controller and worker claims through tasks"
```
