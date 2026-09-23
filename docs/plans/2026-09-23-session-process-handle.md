# Session Process Handle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the process that *is* each session as its registry handle, keep the terminal lookup separately for familiar, and move the registry to schema 2 so old consumers and rows written under the old rule cannot meet the new meaning.

**Architecture:** One nearest-first ancestor chain feeds two lookups in a new `src/adapters/ancestry.js`: `nearestSessionPid` (the nearest harness process, no terminal requirement, null on a non-session role) and `nearestTerminalPid` (the existing measured predicate). Each adapter exports `resolveSessionPid` and `resolveTerminalPid`; `applyEvent` publishes the session handle. `ProcessOps` gains `executableOf` and `argvOf`, read only for the one process a rule needs. The transaction replaces a schema-1 registry with an empty schema-2 one on its first mutation and refuses to read one.

**Tech Stack:** Node >=22, ES modules, Node built-ins, `node:test`. No new dependencies.

**Spec:** `docs/specs/2026-09-23-session-process-handle.md` (approved 2026-09-23 after two reviews).

## Global Constraints

- Node >=22, ES modules and built-ins only; the one runtime dependency stays `jsonc-parser`.
- `resolveAgentPid` is removed with no alias under the old name, in adapters and in `MutationOptions`.
- `Snapshot.schema` becomes `2`. `Event.schema`, the subscriber config and envelope `schema`, the lock token and the `handles.json` corpus stay `1`.
- Only schema `1` is superseded; any other unknown registry schema stays `INVALID_SCHEMA`.
- The executable path is read only for an ancestor whose `comm` matches `^[0-9]+(\.[0-9]+)+$`; argv is read only for the nearest Claude Code process.
- Claude Code non-session roles are exactly `argv[1]` ∈ {`daemon`, `bg-pty-host`}. Codex and OpenCode have no role list.
- An unreadable executable path or argv is `PROCESS_UNREADABLE`, never "not a harness" or "no role".
- A null session handle, for any reason, is published with the existing `PROCESS_UNAVAILABLE` diagnostic.
- Docs and fixtures use `/home/user/...` for home paths, never a real home directory.
- Test on Node 22 and the development runtime before integration (`just gate`).

## Review Focus

1. **Claude Code auto-updated while a session runs.** The kernel reports the executable as `…/versions/2.1.280 (deleted)`; the session must still be recognized. Pinned in Task 2 (`executableOf` strips the suffix).
2. **A non-Claude binary with a version-shaped name** (`1.2.3` at `/opt/tool/1.2.3`) between the hook and the session. It must be skipped, not published and not an error. Pinned in Task 3 (corpus chain `foreign-version-comm`).
3. **The nearest Claude process has an empty cmdline** (exiting, or a kernel quirk). `argv[1]` is undefined, which is not a role, so its pid is published. Pinned in Task 3.
4. **A schema-1 file whose `agents` is missing or not an object.** Supersession still replaces it and reports it, and does not crash on the key listing. Pinned in Task 1.
5. **The first event after an upgrade is a `SessionEnd`.** The schema-1 file must still be replaced by an empty schema-2 registry, not left in place because the removal found nothing. Pinned in Task 1.

---

## File Structure

- `src/protocol.js`: snapshot validation at schema 2.
- `src/bus/transaction.js`: supersession on read and mutation; `applyEvent` resolves the session handle.
- `src/bus/proc.js`: `executableOf`, `argvOf`, `readLink` injection.
- `src/adapters/ancestry.js` (new): the two chain lookups and the version-comm pattern.
- `src/adapters/{claude-code,codex,opencode}.js`: `resolveSessionPid` and `resolveTerminalPid` in place of `resolveAgentPid`.
- `test/fixtures/ancestry.json` (new): the cross-language chain corpus, exported as `relay/fixtures/ancestry.json`.
- `test/ancestry.test.js` (new): drives both lookups from the corpus.
- `docs/api.md`, `README.md`, `docs/runbooks/hook-install-rollback.md`, `package.json`, `test/pack.test.js`: contract, export and rollout precondition.

---

### Task 1: Registry schema 2 and schema-1 supersession

**Files:**
- Modify: `src/protocol.js:40-43`
- Modify: `src/bus/transaction.js:15-18,31-48`
- Test: `test/transaction.test.js`, `test/cli.test.js`, `test/protocol.test.js`, `test/dispatch.test.js:32,313`

**Interfaces:**
- Consumes: nothing new.
- Produces: `validateSnapshot` accepts and returns `schema: 2`. `readSnapshot`/`listAgents` throw `{code:'REGISTRY_SUPERSEDED'}` on a schema-1 file. `applyEvent`/`reapRegistry` replace a schema-1 file and add one diagnostic per dropped agent, `{code:'REGISTRY_SUPERSEDED', message:'dropped <id> from a superseded schema-1 registry', agentId:'<id>'}`, or a single `{code:'REGISTRY_SUPERSEDED', message:'replaced a schema-1 registry with no agents'}`.

- [ ] **Step 1: Write the failing tests**

In `test/protocol.test.js`, change the fixture snapshot and the unknown-schema test:

```js
const snapshot = { schema: 2, generation: '12345678-1234-4234-8234-123456789abc', revision: 0, agents: { [agent.id]: agent } };
```

```js
test('unknown snapshot schema is not an empty registry', () => {
  for (const schema of [1, 3]) assert.throws(() => validateSnapshot({ ...snapshot, schema }), { code: 'INVALID_SCHEMA' });
});
```

In `test/transaction.test.js`, make the unknown-schema case schema 3 (a bare `{"schema":2}` is still invalid, but it no longer means "unknown"):

```js
  for(const text of ['{ broken','{"schema":3}','null','[]','{}']) {
```

and append:

```js
const v1=(agents)=>JSON.stringify({schema:1,generation:'12345678-1234-4234-8234-123456789abc',revision:7,agents});
const row=(id,pid)=>({id,harness:'claude-code',sessionId:id.slice('claude-code:'.length),scope:'session',
  process:{platform:'linux',host:'h',bootId:null,pid,start:'1'},cwd:'/repo',repoRoot:null,remote:null,projectKey:'/repo',project:'repo',state:'idle',updatedAt:0});
test('a schema-1 registry is refused by reads and left untouched',async t=>{
  const p=await tempState(t),text=v1({'claude-code:outer':row('claude-code:outer',42)});await fs.writeFile(p.agentsPath,text,{mode:0o600});
  for(const read of [()=>readSnapshot({paths:p}),()=>listAgents({paths:p})])await assert.rejects(read(),{code:'REGISTRY_SUPERSEDED'});
  assert.equal(await fs.readFile(p.agentsPath,'utf8'),text);
});
test('reap supersedes a contaminated schema-1 registry: empty, fresh generation, every id reported',async t=>{
  const p=await tempState(t);
  await fs.writeFile(p.agentsPath,v1({'claude-code:outer':row('claude-code:outer',42),'claude-code:nested':row('claude-code:nested',42)}),{mode:0o600});
  const r=await reapRegistry({paths:p});
  assert.equal(r.changed,true);assert.equal(r.snapshot.schema,2);assert.equal(r.snapshot.revision,1);
  assert.notEqual(r.snapshot.generation,'12345678-1234-4234-8234-123456789abc');assert.deepEqual(r.snapshot.agents,{});
  assert.deepEqual(r.diagnostics.filter(d=>d.code==='REGISTRY_SUPERSEDED').map(d=>d.agentId).sort(),['claude-code:nested','claude-code:outer']);
  assert.deepEqual(await readSnapshot({paths:p}),r.snapshot);
});
test('an event supersedes a schema-1 registry and publishes only itself',async t=>{
  const p=await tempState(t);await fs.writeFile(p.agentsPath,v1({'claude-code:nested':row('claude-code:nested',42)}),{mode:0o600});
  const r=await applyEvent(event(),localObservation(p));
  assert.deepEqual(Object.keys(r.snapshot.agents),['codex:test']);assert.equal(r.snapshot.schema,2);
  assert.ok(r.diagnostics.some(d=>d.code==='REGISTRY_SUPERSEDED'&&d.agentId==='claude-code:nested'));
});
test('a SessionEnd supersedes a schema-1 registry even though it removes nothing',async t=>{
  const p=await tempState(t);await fs.writeFile(p.agentsPath,v1({'claude-code:nested':row('claude-code:nested',42)}),{mode:0o600});
  const r=await applyEvent(event('codex','SessionEnd'),{paths:p});
  assert.equal(r.changed,true);assert.deepEqual(r.snapshot.agents,{});assert.equal((await readSnapshot({paths:p})).schema,2);
});
test('a schema-1 file with no usable agents object is still superseded',async t=>{
  const p=await tempState(t);
  for(const text of ['{"schema":1}','{"schema":1,"agents":[]}','{"schema":1,"agents":null}']){
    await fs.writeFile(p.agentsPath,text,{mode:0o600});const r=await reapRegistry({paths:p});
    assert.deepEqual(r.diagnostics.filter(d=>d.code==='REGISTRY_SUPERSEDED'),[{code:'REGISTRY_SUPERSEDED',message:'replaced a schema-1 registry with no agents'}]);
    assert.equal((await readSnapshot({paths:p})).schema,2);
  }
});
```

In `test/cli.test.js`, make the list-error table cover schema 1 and 3:

```js
  for(const [content,code] of [['{broken','CORRUPT_STATE'],['{"schema":1}','REGISTRY_SUPERSEDED'],['{"schema":3}','INVALID_SCHEMA'],['null','INVALID_SCHEMA']]) {
```

and append:

```js
test('relay reap supersedes a schema-1 registry and names each dropped agent on stderr',async t=>{
  const p=await tempState(t);
  await fs.writeFile(p.agentsPath,JSON.stringify({schema:1,generation:'12345678-1234-4234-8234-123456789abc',revision:3,agents:{'codex:old':{}}}),{mode:0o600});
  const r=run(p,['reap']);assert.equal(r.status,0);assert.equal(r.stdout,'Reaped 0 agent(s).\n');
  assert.match(r.stderr,/^REGISTRY_SUPERSEDED: dropped codex:old from a superseded schema-1 registry$/m);
  const listed=run(p,['list','--json']);assert.equal(listed.status,0);assert.equal(JSON.parse(listed.stdout).snapshot.schema,2);
});
```

In `test/dispatch.test.js` lines 32 and 313, change `schema: 1` to `schema: 2` inside the two `published` snapshot literals only.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/protocol.test.js test/transaction.test.js test/cli.test.js`
Expected: FAIL. The schema-2 fixture is rejected as `invalid registry snapshot`, and the supersession tests see `INVALID_SCHEMA` instead of `REGISTRY_SUPERSEDED`.

- [ ] **Step 3: Implement schema 2 in `src/protocol.js`**

```js
export function validateSnapshot(v) {
  if (!object(v) || v.schema !== 2 || !uuid(v.generation) || !integer(v.revision) || !object(v.agents)) fail('invalid registry snapshot');
  return { schema: 2, generation: v.generation, revision: v.revision,
    agents: Object.fromEntries(Object.entries(v.agents).map(([key, agent]) => [key, validateAgent(agent, key)])) };
}
```

- [ ] **Step 4: Implement supersession in `src/bus/transaction.js`**

Replace `read` and the head of `mutate`, and write schema 2:

```js
// Schema 1 published the terminal owner's pid; schema 2 publishes the session's own process.
// A schema-1 row can hold a handle borrowed from another session, and which of two rows sharing
// a handle is rightful cannot be told, so its rows are dropped rather than migrated. Spec:
// docs/specs/2026-09-23-session-process-handle.md, "Rollout and recovery".
const SUPERSEDED_MESSAGE = 'registry predates session handles; run relay reap or wait for any hook event';
const isSchemaOne = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && value.schema === 1;
async function read(opts) {
  const value = await readJson(opts.paths.agentsPath,opts);
  if (value === undefined) return null;
  if (isSchemaOne(value)) throw relayError('REGISTRY_SUPERSEDED',SUPERSEDED_MESSAGE);
  return validateSnapshot(value);
}
async function readForMutation(opts, diagnostics) {
  const value = await readJson(opts.paths.agentsPath,opts);
  if (value === undefined) return {before:null,superseded:false};
  if (!isSchemaOne(value)) return {before:validateSnapshot(value),superseded:false};
  const agents = value.agents;
  const ids = agents !== null && typeof agents === 'object' && !Array.isArray(agents) ? Object.keys(agents) : [];
  diagnostics.push(...(ids.length === 0
    ? [{code:'REGISTRY_SUPERSEDED',message:'replaced a schema-1 registry with no agents'}]
    : ids.map(agentId=>({code:'REGISTRY_SUPERSEDED',message:`dropped ${agentId} from a superseded schema-1 registry`,agentId}))));
  return {before:null,superseded:true};
}
```

In `mutate`, replace `const before = await read(opts);` and the `changed` initializer:

```js
    const {before,superseded} = await readForMutation(opts,diagnostics);
    const {agents,reaped,liveness} = pruneDead(before?.agents ?? {},{probe:h=>opts.processOps.probe(h,opts)});
    diagnostics.push(...diagnosticsFor(liveness));
    let changed = superseded || reaped.length > 0;
```

and the snapshot literal:

```js
    const snapshot = validateSnapshot({schema:2,generation:before?.generation ?? opts.uuid(),revision:(before?.revision ?? 0)+1,agents});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `just test-fast`
Expected: PASS, whole suite.

- [ ] **Step 6: Commit**

```bash
git add src/protocol.js src/bus/transaction.js test/protocol.test.js test/transaction.test.js test/cli.test.js test/dispatch.test.js
git commit -m "feat(registry): move to schema 2 and supersede schema-1 registries"
```

---

### Task 2: Executable path and arguments in ProcessOps

**Files:**
- Modify: `src/bus/proc.js:1,87-169`
- Test: `test/proc.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `createProcessOps({ ..., readLink })` returns `{ recordOf, ancestors, handleOf, probe, executableOf, argvOf }`. `executableOf(pid, options?) → string` (absolute on Linux, with a trailing ` (deleted)` removed). `argvOf(pid, options?) → string[]`. Both throw `{code:'PROCESS_UNREADABLE'}` for unreadable or malformed evidence; Darwin `ps` failures keep their existing codes.

- [ ] **Step 1: Write the failing tests**

Append to `test/proc.test.js`:

```js
const linuxWith = (files, links = {}) => createProcessOps({ platform: 'linux',
  readText: (p) => { if (!Object.hasOwn(files, p)) throw failure('ENOENT'); if (files[p] instanceof Error) throw files[p]; return files[p]; },
  readLink: (p) => { if (!Object.hasOwn(links, p)) throw failure('ENOENT'); if (links[p] instanceof Error) throw links[p]; return links[p]; } });
test('Linux executable path comes from the exe link, and a replaced binary keeps its path', () => {
  const path = '/home/user/.local/share/claude/versions/2.1.280';
  assert.equal(linuxWith({}, { '/proc/7/exe': path }).executableOf(7), path);
  assert.equal(linuxWith({}, { '/proc/7/exe': `${path} (deleted)` }).executableOf(7), path);
  for (const link of [failure('EACCES'), failure('ENOENT'), 'relative/path', ''])
    assert.throws(() => linuxWith({}, { '/proc/7/exe': link }).executableOf(7), { code: 'PROCESS_UNREADABLE' });
});
test('Linux arguments split the NUL-separated cmdline; an empty cmdline is no arguments', () => {
  assert.deepEqual(linuxWith({ '/proc/7/cmdline': 'claude\0daemon\0run\0' }).argvOf(7), ['claude', 'daemon', 'run']);
  assert.deepEqual(linuxWith({ '/proc/7/cmdline': 'claude\0-p\0two words\0' }).argvOf(7), ['claude', '-p', 'two words']);
  assert.deepEqual(linuxWith({ '/proc/7/cmdline': '' }).argvOf(7), []);
  for (const text of [failure('EACCES'), failure('ENOENT')])
    assert.throws(() => linuxWith({ '/proc/7/cmdline': text }).argvOf(7), { code: 'PROCESS_UNREADABLE' });
});
test('Darwin executable path and arguments come from one targeted ps each', () => {
  const calls = [];
  const ops = createProcessOps({ platform: 'darwin', runPs: (args) => { calls.push(args.join(' '));
    return args.includes('comm=') ? '/Users/user/.local/share/claude/versions/2.1.280\n' : '/Users/user/.local/bin/claude daemon run\n'; } });
  assert.equal(ops.executableOf(9), '/Users/user/.local/share/claude/versions/2.1.280');
  assert.deepEqual(ops.argvOf(9), ['/Users/user/.local/bin/claude', 'daemon', 'run']);
  assert.deepEqual(calls, ['-p 9 -o comm=', '-p 9 -o args=']);
  const empty = createProcessOps({ platform: 'darwin', runPs: () => '\n' });
  for (const read of [() => empty.executableOf(9), () => empty.argvOf(9)]) assert.throws(read, { code: 'PROCESS_UNREADABLE' });
});
test('real local process exposes its own executable and arguments', () => {
  const ops = createProcessOps();
  if (process.platform !== 'linux') return;
  assert.equal(ops.executableOf(process.pid), readlinkSync('/proc/self/exe'));
  assert.equal(ops.argvOf(process.pid)[0], process.argv0);
});
```

and extend the `node:fs` import at the top of the file: `import { readFileSync, readlinkSync } from 'node:fs';`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/proc.test.js`
Expected: FAIL with `ops.executableOf is not a function`.

- [ ] **Step 3: Implement**

In `src/bus/proc.js`, import `readlinkSync` beside `readFileSync`, add `readLink = (p) => readlinkSync(p)` to the `createProcessOps` options, and before the `return` add:

```js
  // Read for one process at a time, only when an adapter's rule needs it (spec: "Recognizing a
  // harness process" and "Non-session roles"). The kernel suffixes the exe link of a binary
  // replaced on disk, which a Claude Code auto-update does to every running session.
  const DELETED = ' (deleted)';
  const executableOf = (pid, options) => {
    if (platform === 'linux') {
      let target;
      try { target = readLink(`/proc/${pid}/exe`); }
      catch (cause) { throw relayError('PROCESS_UNREADABLE', 'cannot read process executable', cause); }
      if (typeof target !== 'string' || !target.startsWith('/')) throw relayError('PROCESS_UNREADABLE', 'invalid process executable');
      return target.endsWith(DELETED) ? target.slice(0, -DELETED.length) : target;
    }
    const output = runPs(['-p', String(pid), '-o', 'comm='], options);
    const path = typeof output === 'string' ? output.trim() : '';
    if (!path) throw relayError('PROCESS_UNREADABLE', 'invalid process executable');
    return path;
  };
  const argvOf = (pid, options) => {
    if (platform === 'linux') {
      let text;
      try { text = readText(`/proc/${pid}/cmdline`); }
      catch (cause) { throw relayError('PROCESS_UNREADABLE', 'cannot read process arguments', cause); }
      if (typeof text !== 'string') throw relayError('PROCESS_UNREADABLE', 'invalid process arguments');
      if (text === '') return [];
      return (text.endsWith('\0') ? text.slice(0, -1) : text).split('\0');
    }
    // ps joins arguments with spaces, so an argument containing one splits wrongly. Only
    // argv[1] of a Claude Code process is read, and Darwin roles are unmeasured (spec, Out of scope).
    const output = runPs(['-p', String(pid), '-o', 'args='], options);
    if (typeof output !== 'string' || !output.trim()) throw relayError('PROCESS_UNREADABLE', 'invalid process arguments');
    return output.trim().split(/\s+/);
  };
  return { recordOf, ancestors, handleOf, probe, executableOf, argvOf };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test-fast`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bus/proc.js test/proc.test.js
git commit -m "feat(proc): read a process's executable path and arguments on demand"
```

---

### Task 3: Session and terminal lookups replace resolveAgentPid

**Files:**
- Create: `src/adapters/ancestry.js`
- Create: `test/fixtures/ancestry.json`
- Create: `test/ancestry.test.js`
- Modify: `src/adapters/claude-code.js:1,31-34`, `src/adapters/codex.js:28-31`, `src/adapters/opencode.js:23-26`
- Modify: `src/bus/transaction.js:61`
- Modify (rename `resolveAgentPid` → `resolveSessionPid`): `test/helpers/fixture.js:19`, `test/fixtures/lock-worker.js:16`, `test/dispatch.test.js:26`, `test/transaction.test.js:22,52,57,62,68`, `test/cli.test.js:27`
- Modify: `test/payload.test.js:23,65-71`, `test/claude-code.test.js`, `test/codex.test.js`, `test/opencode.test.js`

**Interfaces:**
- Consumes: Task 2's `executableOf(pid, options?) → string` and `argvOf(pid, options?) → string[]`.
- Produces:
  - `src/adapters/ancestry.js`: `VERSION_COMM: RegExp`; `nearestSessionPid(chain: ProcessRow[], { isHarness: (row) => boolean, roles?: string[], argvOf?: (pid) => string[] }) → number | null`; `nearestTerminalPid(chain: ProcessRow[], comm: string) → number | null`.
  - Every adapter: `resolveSessionPid({ startPid?, ancestors?, executableOf?, argvOf? }) → number | null` and `resolveTerminalPid({ startPid?, ancestors? }) → number | null`.
  - `MutationOptions.resolveSessionPid?: (adapter) => number | null`.

- [ ] **Step 1: Write the corpus `test/fixtures/ancestry.json`**

Rows are nearest-first; index 0 is the hook. A row's `exe` or `argv` of `null` means the rule must not read it: the test harness throws if it does, which pins the read gates.

```json
{
  "schema": 1,
  "chains": [
    { "name": "interactive-claude", "source": "familiar spike 2026-07-11, finding C, interactive shape", "harness": "claude-code",
      "rows": [
        { "pid": 500, "ppid": 450, "comm": "node", "tty": null, "exe": null, "argv": null },
        { "pid": 450, "ppid": 200, "comm": "claude", "tty": true, "exe": null, "argv": ["claude", "--dangerously-skip-permissions"] },
        { "pid": 200, "ppid": 100, "comm": "zsh", "tty": true, "exe": null, "argv": null },
        { "pid": 100, "ppid": 1, "comm": "kitty", "tty": null, "exe": null, "argv": null } ],
      "session": 450, "terminal": 450 },
    { "name": "background-daemon-under-interactive", "source": "familiar spike 2026-07-11, finding C, background shape; exe reconstructed from the recorded command line", "harness": "claude-code",
      "rows": [
        { "pid": 500, "ppid": 450, "comm": "node", "tty": null, "exe": null, "argv": null },
        { "pid": 450, "ppid": 400, "comm": "2.1.207", "tty": null, "exe": "/home/user/.local/share/claude/versions/2.1.207", "argv": ["/home/user/.local/share/claude/versions/2.1.207", "--session-id", "b1"] },
        { "pid": 400, "ppid": 300, "comm": "2.1.207", "tty": null, "exe": null, "argv": null },
        { "pid": 300, "ppid": 200, "comm": "claude", "tty": null, "exe": null, "argv": null },
        { "pid": 200, "ppid": 100, "comm": "claude", "tty": true, "exe": null, "argv": null },
        { "pid": 100, "ppid": 1, "comm": "zsh", "tty": true, "exe": null, "argv": null } ],
      "session": 450, "terminal": 200 },
    { "name": "background-under-systemd", "source": "measured 2026-09-23, Claude Code 2.1.280 claude --bg", "harness": "claude-code",
      "rows": [
        { "pid": 900, "ppid": 800, "comm": "node", "tty": null, "exe": null, "argv": null },
        { "pid": 800, "ppid": 790, "comm": "2.1.280", "tty": true, "exe": "/home/user/.local/share/claude/versions/2.1.280", "argv": ["/home/user/.local/share/claude/versions/2.1.280", "--session-id", "9a2732d5-47a7-432b-a3c7-3f7bc08ac4f1"] },
        { "pid": 790, "ppid": 780, "comm": "2.1.280", "tty": null, "exe": null, "argv": null },
        { "pid": 780, "ppid": 700, "comm": "claude", "tty": null, "exe": null, "argv": null },
        { "pid": 700, "ppid": 1, "comm": "systemd", "tty": null, "exe": null, "argv": null } ],
      "session": 800, "terminal": null },
    { "name": "version-session-under-interactive", "source": "review reproduction 2026-09-23: tasks -> 2.1.280 -> claude", "harness": "claude-code",
      "rows": [
        { "pid": 610, "ppid": 600, "comm": "node", "tty": null, "exe": null, "argv": null },
        { "pid": 600, "ppid": 500, "comm": "2.1.280", "tty": null, "exe": "/home/user/.local/share/claude/versions/2.1.280", "argv": ["/home/user/.local/share/claude/versions/2.1.280", "-p", "task"] },
        { "pid": 500, "ppid": 400, "comm": "claude", "tty": true, "exe": null, "argv": null },
        { "pid": 400, "ppid": 1, "comm": "zsh", "tty": true, "exe": null, "argv": null } ],
      "session": 600, "terminal": 500 },
    { "name": "nested-headless-claude", "source": "measured 2026-09-23, claude -p inside an interactive session", "harness": "claude-code",
      "rows": [
        { "pid": 700, "ppid": 690, "comm": "node", "tty": null, "exe": null, "argv": null },
        { "pid": 690, "ppid": 680, "comm": "sh", "tty": null, "exe": null, "argv": null },
        { "pid": 680, "ppid": 670, "comm": "claude", "tty": null, "exe": null, "argv": ["claude", "-p", "Run this probe"] },
        { "pid": 670, "ppid": 600, "comm": "zsh", "tty": null, "exe": null, "argv": null },
        { "pid": 600, "ppid": 590, "comm": "claude", "tty": true, "exe": null, "argv": null },
        { "pid": 590, "ppid": 1, "comm": "zsh", "tty": true, "exe": null, "argv": null } ],
      "session": 680, "terminal": 600 },
    { "name": "daemon-nearest", "source": "spec, Non-session roles", "harness": "claude-code",
      "rows": [
        { "pid": 500, "ppid": 300, "comm": "node", "tty": null, "exe": null, "argv": null },
        { "pid": 300, "ppid": 200, "comm": "claude", "tty": null, "exe": null, "argv": ["/home/user/.local/bin/claude", "daemon", "run", "--origin", "transient"] },
        { "pid": 200, "ppid": 1, "comm": "claude", "tty": true, "exe": null, "argv": null } ],
      "session": null, "terminal": 200 },
    { "name": "pty-host-nearest", "source": "spec, Non-session roles", "harness": "claude-code",
      "rows": [
        { "pid": 500, "ppid": 400, "comm": "node", "tty": null, "exe": null, "argv": null },
        { "pid": 400, "ppid": 300, "comm": "2.1.280", "tty": null, "exe": "/home/user/.local/share/claude/versions/2.1.280", "argv": ["claude", "bg-pty-host", "--bg-pty-host", "/tmp/cc/pty/s.sock"] },
        { "pid": 300, "ppid": 200, "comm": "claude", "tty": null, "exe": null, "argv": null },
        { "pid": 200, "ppid": 1, "comm": "claude", "tty": true, "exe": null, "argv": null } ],
      "session": null, "terminal": 200 },
    { "name": "foreign-version-comm", "source": "plan Review Focus 2", "harness": "claude-code",
      "rows": [
        { "pid": 500, "ppid": 450, "comm": "node", "tty": null, "exe": null, "argv": null },
        { "pid": 450, "ppid": 400, "comm": "1.2.3", "tty": null, "exe": "/opt/tool/1.2.3", "argv": null },
        { "pid": 400, "ppid": 1, "comm": "claude", "tty": true, "exe": null, "argv": ["claude"] } ],
      "session": 400, "terminal": 400 },
    { "name": "headless-codex-exec", "source": "measured 2026-09-23, codex-cli 0.156.1 codex exec without a terminal", "harness": "codex",
      "rows": [
        { "pid": 900, "ppid": 890, "comm": "node", "tty": null, "exe": null, "argv": null },
        { "pid": 890, "ppid": 880, "comm": "codex", "tty": null, "exe": null, "argv": null },
        { "pid": 880, "ppid": 1, "comm": "timeout", "tty": null, "exe": null, "argv": null } ],
      "session": 890, "terminal": null },
    { "name": "interactive-codex", "source": "measured 2026-09-23, codex-cli 0.156.1 native binary with a terminal", "harness": "codex",
      "rows": [
        { "pid": 10, "ppid": 9, "comm": "node", "tty": null, "exe": null, "argv": null },
        { "pid": 9, "ppid": 7, "comm": "sh", "tty": null, "exe": null, "argv": null },
        { "pid": 7, "ppid": 6, "comm": "codex", "tty": true, "exe": null, "argv": null },
        { "pid": 6, "ppid": 1, "comm": "zsh", "tty": true, "exe": null, "argv": null } ],
      "session": 7, "terminal": 7 },
    { "name": "darwin-claude", "source": "measured on a Mac, existing claude-code fixture", "harness": "claude-code",
      "rows": [
        { "pid": 37708, "ppid": 37707, "comm": "node", "tty": null, "exe": null, "argv": null },
        { "pid": 37707, "ppid": 37609, "comm": "sh", "tty": null, "exe": null, "argv": null },
        { "pid": 37609, "ppid": 35113, "comm": "claude", "tty": "ttys000", "exe": null, "argv": ["claude"] },
        { "pid": 35113, "ppid": 35112, "comm": "-zsh", "tty": "ttys000", "exe": null, "argv": null } ],
      "session": 37609, "terminal": 37609 },
    { "name": "darwin-codex", "source": "measured on a Mac, existing codex fixture", "harness": "codex",
      "rows": [
        { "pid": 38843, "ppid": 38829, "comm": "node", "tty": "ttys000", "exe": null, "argv": null },
        { "pid": 38829, "ppid": 38609, "comm": "zsh", "tty": "ttys000", "exe": null, "argv": null },
        { "pid": 38609, "ppid": 38608, "comm": "codex", "tty": "ttys000", "exe": null, "argv": null },
        { "pid": 38608, "ppid": 35113, "comm": "node", "tty": "ttys000", "exe": null, "argv": null } ],
      "session": 38609, "terminal": 38609 },
    { "name": "darwin-opencode", "source": "measured on a Mac, existing opencode fixture", "harness": "opencode",
      "rows": [
        { "pid": 42885, "ppid": 42878, "comm": "node", "tty": "ttys000", "exe": null, "argv": null },
        { "pid": 42878, "ppid": 35113, "comm": "opencode", "tty": "ttys000", "exe": null, "argv": null },
        { "pid": 35113, "ppid": 35112, "comm": "-zsh", "tty": "ttys000", "exe": null, "argv": null } ],
      "session": 42878, "terminal": 42878 }
  ]
}
```

- [ ] **Step 2: Write the corpus test `test/ancestry.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adapterFor } from '../src/adapters/index.js';
const corpus = JSON.parse(readFileSync(new URL('./fixtures/ancestry.json', import.meta.url)));
test('ancestry corpus is versioned and names every harness', () => {
  assert.equal(corpus.schema, 1);
  assert.deepEqual([...new Set(corpus.chains.map(c => c.harness))].sort(), ['claude-code', 'codex', 'opencode']);
});
for (const chain of corpus.chains) {
  test(`ancestry corpus: ${chain.name}`, () => {
    const adapter = adapterFor(chain.harness), rows = new Map(chain.rows.map(r => [r.pid, r]));
    const ancestors = () => chain.rows.map(({ pid, ppid, comm, tty }) => ({ pid, ppid, comm, tty, starttime: '1', state: 'S' }));
    const gated = (field) => (pid) => {
      const value = rows.get(pid)?.[field];
      if (value === null || value === undefined) throw new Error(`${field} of ${pid} must not be read`);
      return value;
    };
    const startPid = chain.rows[0].pid;
    assert.equal(adapter.resolveSessionPid({ startPid, ancestors, executableOf: gated('exe'), argvOf: gated('argv') }), chain.session, 'session');
    assert.equal(adapter.resolveTerminalPid({ startPid, ancestors }), chain.terminal, 'terminal');
  });
}
test('unreadable executable or arguments of the process under test is an error, never a skip', () => {
  const claude = adapterFor('claude-code');
  const unreadable = () => { throw Object.assign(new Error('denied'), { code: 'PROCESS_UNREADABLE' }); };
  const version = () => [{ pid: 5, comm: 'node', tty: null }, { pid: 4, comm: '2.1.280', tty: null }, { pid: 3, comm: 'claude', tty: true }];
  assert.throws(() => claude.resolveSessionPid({ ancestors: version, executableOf: unreadable, argvOf: () => ['x'] }), { code: 'PROCESS_UNREADABLE' });
  const plain = () => [{ pid: 5, comm: 'node', tty: null }, { pid: 3, comm: 'claude', tty: true }];
  assert.throws(() => claude.resolveSessionPid({ ancestors: plain, executableOf: unreadable, argvOf: unreadable }), { code: 'PROCESS_UNREADABLE' });
});
test('an empty cmdline on the nearest Claude process is no role, so its pid is published', () => {
  const chain = () => [{ pid: 5, comm: 'node', tty: null }, { pid: 3, comm: 'claude', tty: null }];
  assert.equal(adapterFor('claude-code').resolveSessionPid({ ancestors: chain, executableOf: () => { throw new Error('not read'); }, argvOf: () => [] }), 3);
});
test('the hook itself is never the session, even when it is a harness process', () => {
  for (const [harness, comm] of [['claude-code', 'claude'], ['codex', 'codex'], ['opencode', 'opencode']]) {
    const only = () => [{ pid: 5, comm, tty: true }];
    assert.equal(adapterFor(harness).resolveSessionPid({ ancestors: only, executableOf: () => '', argvOf: () => [] }), null);
    assert.equal(adapterFor(harness).resolveTerminalPid({ ancestors: only }), null);
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/ancestry.test.js`
Expected: FAIL with `adapter.resolveSessionPid is not a function`.

- [ ] **Step 4: Create `src/adapters/ancestry.js`**

```js
// Two lookups over one nearest-first ancestor chain whose index zero is the hook itself.
// The session process is the registry's identity handle: the harness process that fired the
// hook, terminal or not. The terminal process is where a presentation layer paints: the
// measured familiar predicate. They coincide for an interactive session and differ for every
// session without a terminal of its own. Spec: docs/specs/2026-09-23-session-process-handle.md.
export const VERSION_COMM = /^[0-9]+(\.[0-9]+)+$/;
// The walk never continues past the nearest harness process: a pid borrowed from an outer
// session is worse than none.
export function nearestSessionPid(chain, { isHarness, roles = [], argvOf }) {
  const nearest = chain.find((row, index) => index > 0 && isHarness(row));
  if (!nearest) return null;
  if (roles.length > 0 && roles.includes(argvOf(nearest.pid)[1])) return null;
  return nearest.pid;
}
export function nearestTerminalPid(chain, comm) {
  return chain.find((row, index) => index > 0 && row.comm === comm && row.tty !== null)?.pid ?? null;
}
```

- [ ] **Step 5: Replace the resolver in each adapter**

`src/adapters/claude-code.js`: add `import { VERSION_COMM, nearestSessionPid, nearestTerminalPid } from './ancestry.js';` and replace the comment and `resolveAgentPid` with:

```js
// The native installer runs every version as …/claude/versions/<version>, so a background
// session's own process is named after its version. The daemon and the pty host share that
// executable and never fire a hook; landing on one means an unmeasured shape, so null.
const ROLES = Object.freeze(['daemon', 'bg-pty-host']);
const ops = () => createProcessOps();
export function resolveSessionPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid),
  executableOf = (pid) => ops().executableOf(pid), argvOf = (pid) => ops().argvOf(pid) } = {}) {
  const isHarness = (row) => row.comm === 'claude'
    || (VERSION_COMM.test(row.comm) && executableOf(row.pid).endsWith(`/claude/versions/${row.comm}`));
  return nearestSessionPid(ancestors(startPid), { isHarness, roles: ROLES, argvOf });
}
export function resolveTerminalPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid) } = {}) {
  return nearestTerminalPid(ancestors(startPid), 'claude');
}
```

`src/adapters/codex.js`: add `import { nearestSessionPid, nearestTerminalPid } from './ancestry.js';` and replace the comment and `resolveAgentPid` with:

```js
const ops = () => createProcessOps();
export function resolveSessionPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid) } = {}) {
  return nearestSessionPid(ancestors(startPid), { isHarness: (row) => row.comm === 'codex' });
}
export function resolveTerminalPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid) } = {}) {
  return nearestTerminalPid(ancestors(startPid), 'codex');
}
```

`src/adapters/opencode.js`: the same as codex, with `'opencode'` in both places.

- [ ] **Step 6: Switch the transaction and the injection name**

In `src/bus/transaction.js`, replace the pid line in `applyEvent`:

```js
      const pid = given.resolveSessionPid ? given.resolveSessionPid(adapter) : adapter.resolveSessionPid({
        ancestors:p=>opts.processOps.ancestors(p,opts),executableOf:p=>opts.processOps.executableOf(p,opts),argvOf:p=>opts.processOps.argvOf(p,opts)});
```

Then rename every remaining use in tests:

Run: `sed -i 's/resolveAgentPid/resolveSessionPid/g' test/helpers/fixture.js test/fixtures/lock-worker.js test/dispatch.test.js test/transaction.test.js test/cli.test.js`

- [ ] **Step 7: Rewrite the per-adapter resolver tests**

In `test/payload.test.js` line 23, change the function list to `['stateForEvent','reduceState','resolveSessionPid','resolveTerminalPid']`, and replace the test `'resolvers skip self and use nearest matching terminal candidate'` with:

```js
test('session lookup takes the nearest harness process; terminal lookup the nearest with a terminal', () => {
  for (const [harness,comm] of [['claude-code','claude'],['codex','codex'],['opencode','opencode']]) {
    const adapter = adapterFor(harness), argvOf = () => [comm];
    const chain = () => [{pid:5,comm,tty:true},{pid:4,comm,tty:null},{pid:3,comm,tty:true},{pid:2,comm,tty:true}];
    assert.equal(adapter.resolveSessionPid({ancestors:chain,executableOf:()=>'',argvOf}),4);
    assert.equal(adapter.resolveTerminalPid({ancestors:chain}),3);
  }
});
```

In `test/claude-code.test.js`, `test/codex.test.js` and `test/opencode.test.js`, the chains now live in the corpus. Delete every `resolveAgentPid` test, remove `resolveAgentPid` from each import, and add one test per file that keeps the terminal-only "daemon" chains, which were modelled on the Claude spike and remain the terminal predicate's regression cases. For `test/codex.test.js`:

```js
import { resolveSessionPid, resolveTerminalPid, reduceState } from '../src/adapters/codex.js';
```

```js
test('a same-named process without a terminal is the session when nearest, and never the terminal', () => {
  // Modelled on the Claude spike, not measured for codex: kept as the terminal predicate's case.
  const chain = () => [{ pid: 10, comm: 'node', tty: null }, { pid: 9, comm: 'sh', tty: null },
    { pid: 8, comm: 'codex', tty: null }, { pid: 7, comm: 'codex', tty: true }];
  assert.equal(resolveSessionPid({ ancestors: chain }), 8);
  assert.equal(resolveTerminalPid({ ancestors: chain }), 7);
});
```

For `test/opencode.test.js`, the same test with `opencode`, pids 400/300/200, the hook at 400 and the two `opencode` rows at 300 (no tty) and 200 (tty): expect session 300, terminal 200. For `test/claude-code.test.js` import `resolveSessionPid, resolveTerminalPid, reduceState` and add:

```js
test('no Claude process in the chain is null for both lookups', () => {
  const chain = () => [{ pid: 500, comm: 'node', tty: null }, { pid: 400, comm: 'zsh', tty: true }];
  assert.equal(resolveSessionPid({ ancestors: chain, executableOf: () => { throw new Error('not read'); }, argvOf: () => [] }), null);
  assert.equal(resolveTerminalPid({ ancestors: chain }), null);
});
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `just test-fast`
Expected: PASS. Then `grep -rn resolveAgentPid src test bin integrations` prints nothing.

- [ ] **Step 9: Commit**

```bash
git add src/adapters test/ancestry.test.js test/fixtures/ancestry.json src/bus/transaction.js test
git commit -m "feat(adapters): publish the session's own process and keep the terminal lookup apart"
```

---

### Task 4: Registry scenarios end to end

**Files:**
- Test: `test/transaction.test.js`

**Interfaces:**
- Consumes: Task 1's supersession, Task 3's `resolveSessionPid` and the adapter lookup, Task 2's `ProcessOps` shape.
- Produces: tests only.

- [ ] **Step 1: Write the tests**

Append to `test/transaction.test.js`. The fake `processOps` serves a fixed chain and a handle per pid; `probe` reports every handle alive, which is the contaminated case's premise.

```js
const chainOps=(chains)=>({
  ancestors:(pid)=>chains[pid],
  executableOf:(pid)=>{throw new Error(`exe of ${pid} must not be read`);},
  argvOf:()=>['claude'],
  handleOf:(pid)=>({platform:'linux',host:'h',bootId:null,pid,start:String(pid)}),
  probe:()=>({status:'alive',reason:'test'}),
  recordOf:()=>null});
const observe=(p,ops)=>({paths:p,processOps:ops,gitContext:async()=>({remote:null,repoRoot:null})});
const claudeEvent=(session)=>normalizeEvent('claude-code','SessionStart',JSON.stringify({session_id:session,cwd:'/repo'}));
// outer: hook 101 under claude 100 (tty). nested: hook 201 under claude 200 (no tty) under claude 100.
const nested={101:[{pid:101,comm:'node',tty:null},{pid:100,comm:'claude',tty:true}],
  201:[{pid:201,comm:'node',tty:null},{pid:200,comm:'claude',tty:null},{pid:150,comm:'zsh',tty:null},{pid:100,comm:'claude',tty:true}]};
test('a nested headless session publishes its own process, beside its parent',async t=>{
  const p=await tempState(t),ops=chainOps(nested);
  await applyEvent(claudeEvent('outer'),{...observe(p,ops),resolveSessionPid:(a)=>a.resolveSessionPid({startPid:101,ancestors:ops.ancestors,executableOf:ops.executableOf,argvOf:ops.argvOf})});
  const r=await applyEvent(claudeEvent('nested'),{...observe(p,ops),resolveSessionPid:(a)=>a.resolveSessionPid({startPid:201,ancestors:ops.ancestors,executableOf:ops.executableOf,argvOf:ops.argvOf})});
  assert.equal(r.snapshot.agents['claude-code:outer'].process.pid,100);
  assert.equal(r.snapshot.agents['claude-code:nested'].process.pid,200);
});
test('a contaminated schema-1 registry recovers: reap, then the outer event, leaves one correct row',async t=>{
  const p=await tempState(t),ops=chainOps(nested),borrowed={platform:'linux',host:'h',bootId:null,pid:100,start:'100'};
  const agent=(session)=>({id:`claude-code:${session}`,harness:'claude-code',sessionId:session,scope:'session',process:borrowed,
    cwd:'/repo',repoRoot:null,remote:null,projectKey:'/repo',project:'repo',state:'idle',updatedAt:0});
  const contaminated=JSON.stringify({schema:1,generation:'12345678-1234-4234-8234-123456789abc',revision:9,
    agents:{'claude-code:outer':agent('outer'),'claude-code:nested':agent('nested')}});
  for(const first of ['reap','event']){
    await fs.writeFile(p.agentsPath,contaminated,{mode:0o600});
    if(first==='reap')await reapRegistry({paths:p,processOps:ops});
    const r=await applyEvent(claudeEvent('outer'),{...observe(p,ops),resolveSessionPid:(a)=>a.resolveSessionPid({startPid:101,ancestors:ops.ancestors,executableOf:ops.executableOf,argvOf:ops.argvOf})});
    assert.deepEqual(Object.keys(r.snapshot.agents),['claude-code:outer'],first);
    assert.equal(r.snapshot.agents['claude-code:outer'].process.pid,100,first);
  }
});
```

- [ ] **Step 2: Run the tests**

Run: `node --test test/transaction.test.js`
Expected: PASS, since Tasks 1–3 implement the behaviour. If either fails, the defect is in the earlier task's code: fix it there, rerun that task's tests, and fold the fix into this commit with a message naming it.

- [ ] **Step 3: Run the suite**

Run: `just test-fast`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/transaction.test.js
git commit -m "test(registry): nested sessions keep distinct handles; contaminated registries recover"
```

---

### Task 5: Contract, export and rollout precondition

**Files:**
- Modify: `docs/api.md` (the `Handle`/`Agent`/`Snapshot` block, `ProcessOps`, `Adapter`, `MutationOptions`, and the "recordOf returns null…" paragraph)
- Modify: `package.json` (`exports`, `files`)
- Modify: `test/pack.test.js:16,24`
- Modify: `docs/runbooks/hook-install-rollback.md`
- Modify: `README.md`
- Modify: `docs/specs/2026-09-23-session-process-handle.md` (Status line)

**Interfaces:**
- Consumes: the names from Tasks 1–3.
- Produces: `relay/fixtures/ancestry.json` as a package export.

- [ ] **Step 1: Write the failing pack test**

In `test/pack.test.js`, add `'test/fixtures/ancestry.json'` to the list on line 16, and add to the `smoke` script after the handles corpus check:

```js
    const chains=JSON.parse(await readFile(new URL(import.meta.resolve('relay/fixtures/ancestry.json')),'utf8'));assert.equal(chains.schema,1);assert.ok(chains.chains.some(c=>c.name==='background-under-systemd'));
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/pack.test.js`
Expected: FAIL on `test/fixtures/ancestry.json` missing from the pack.

- [ ] **Step 3: Export the corpus**

In `package.json` add `"./fixtures/ancestry.json": "./test/fixtures/ancestry.json"` to `exports` and `"test/fixtures/ancestry.json"` to `files`.

- [ ] **Step 4: Update `docs/api.md`**

- In the `Snapshot` type, `schema: 2;`, and after the type block add: "Schema 2 publishes, as `Agent.process`, the handle of the process that is the session, not of the terminal that displays it (spec `docs/specs/2026-09-23-session-process-handle.md`). A schema-1 file is superseded, never read: `readSnapshot`, `listAgents` and `relay list` fail with `REGISTRY_SUPERSEDED`; the first `applyEvent` or `reapRegistry` replaces it with an empty schema-2 snapshot under a fresh generation and reports one `REGISTRY_SUPERSEDED` diagnostic per dropped agent. Any other unknown schema is `INVALID_SCHEMA`."
- In `ProcessOps`, add `executableOf(pid: number, options?: ClockOptions): string;` and `argvOf(pid: number, options?: ClockOptions): string[];`.
- In `Adapter`, replace `resolveAgentPid` with the `resolveSessionPid` and `resolveTerminalPid` signatures from the spec's "Contract changes".
- In `MutationOptions`, `resolveSessionPid?: (adapter: Adapter) => number | null;`.
- Replace "The measured comm/tty predicate skips index zero; no matching agent yields null." with: "`resolveSessionPid` takes the nearest ancestor after index zero that is a process of the harness (Claude Code: `comm` `claude`, or a version-shaped `comm` whose executable ends in `/claude/versions/<comm>`), with no terminal requirement, and yields null when there is none or when the nearest Claude Code process has `argv[1]` `daemon` or `bg-pty-host`. `resolveTerminalPid` keeps the measured predicate: the nearest ancestor after index zero whose `comm` is the harness name and which owns a terminal. `executableOf` is read only for a version-shaped `comm` and `argvOf` only for the nearest Claude Code process; an unreadable one is `PROCESS_UNREADABLE`. The shared chains are `relay/fixtures/ancestry.json`."

- [ ] **Step 5: Add the rollout precondition to `docs/runbooks/hook-install-rollback.md`**

Append:

```markdown
## Activating session handles (registry schema 2)

Before a schema-2 relay publishes on a host where tasks' relay identity is on
(`[identity] relay = true` in tasks' host config), every `tasks` binary that can run
there must carry the session-process walk: check each `tasks` that each harness's
environment resolves on `PATH`, not only the main checkout's. An older tasks refuses
a schema-2 registry for new claims, but can still continue a claim it already holds
from process proof alone, and its older walk can prove a nested session to be its
parent. A host with the opt-in off is not exposed.

After upgrading relay, run `relay reap` once. It replaces a schema-1 registry with an
empty schema-2 one and names every dropped agent on stderr; each live session
reappears with its own handle at its next hook event. No session restart is needed.
```

- [ ] **Step 6: Update `README.md`**

After the paragraph beginning "State uses RELAY_STATE_DIR", add: "The registry is schema 2: each agent's handle names the session's own process. Upgrading from schema 1 is `relay reap`, and on a host using tasks' relay identity, tasks is upgraded first; see the [hook install runbook](docs/runbooks/hook-install-rollback.md#activating-session-handles-registry-schema-2)."

- [ ] **Step 7: Mark the spec implemented**

Replace the spec's `Status:` line with: `Status: implemented, 2026-09-23 (Linux verified live; Darwin unmeasured, see Out of scope).` Update the date if the work lands later.

- [ ] **Step 8: Run the gate**

Run: `just gate`
Expected: PASS on the development runtime. Then run the gate on the Node 22 floor, the release the README records (22.23.2, installed under nvm): `PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" just gate`, and confirm PASS.

- [ ] **Step 9: Commit**

```bash
git add docs/api.md package.json test/pack.test.js docs/runbooks/hook-install-rollback.md README.md docs/specs/2026-09-23-session-process-handle.md
git commit -m "docs(api): document session handles, schema 2 and the activation precondition"
```

---

### Task 6: Live verification on Linux

**Files:**
- None changed. Results go in a task note.

**Interfaces:**
- Consumes: the built worktree, run by explicit path.
- Produces: evidence recorded with `tasks note relay-cb616b`.

Every command runs relay by explicit path (`.worktrees/nested-headless/bin/relay.js`, relative to the relay checkout) into a private state directory. Nothing is installed and no host pointer changes.

- [ ] **Step 1: Prepare a private state directory**

```bash
S=$(mktemp -d) && mkdir -m 700 "$S/state" && export RELAY_STATE_DIR="$S/state"
R="$PWD/bin/relay.js"   # run from the worktree root
```

- [ ] **Step 2: Interactive session**

From the interactive Claude Code session running this plan:

```bash
printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart"}' "$CLAUDE_CODE_SESSION_ID" "$PWD" | node "$R" hook --harness claude-code SessionStart
node "$R" list --json
```

Expected: one row whose `process.pid` is the `claude` process that owns this terminal (check `/proc/<pid>/comm` and `tty_nr`).

- [ ] **Step 3: Nested headless session**

Write a probe that runs the same hook with the nested session's own id, and run it inside `claude -p` with the cheapest model and a 180 s timeout. Expected: a second row whose `process.pid` is the nested `claude` process, not the outer one; `relay list` shows two rows with different handles.

- [ ] **Step 4: Background session**

Start `claude --bg` with the probe as its prompt (send it with `claude attach` if it starts idle), read the row, then `claude stop <id>` and `claude rm <id>`, and confirm the transient daemon exits. Expected: `process.pid` is the `2.1.x` session process, whose `/proc/<pid>/cmdline` carries `--session-id <that id>`.

- [ ] **Step 5: Headless Codex**

Run the probe under `codex exec` (with `CODEX_SESSION_ID`/`CODEX_THREAD_ID` as the session id). Expected: `process.pid` is the `codex` process that fired the hook.

- [ ] **Step 6: Supersession on a real file**

Rewrite the private registry as schema 1 (set `"schema": 1` in `agents.json`), run `node "$R" list --json` (expect `REGISTRY_SUPERSEDED`), then `node "$R" reap` (expect every id named on stderr), then rerun Step 2 and confirm one fresh row.

- [ ] **Step 7: Record and clean up**

`tasks note relay-cb616b "<the four pids and what each was checked against>"`, confirm `host-load --section session` reports nothing left, and remove `$S`.
