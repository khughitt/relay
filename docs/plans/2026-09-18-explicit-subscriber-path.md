# Explicit Subscriber Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** draft for review, 2026-09-18.

**Goal:** Installed relay hook entries name their subscriber file with `--subscribers FILE`, that file is validated at install time exactly as at runtime, and an explicit path is loaded without consulting the hook process environment.

**Architecture:** `src/subscribers.js` gains `loadSubscribersFrom(file)`, the required-file variant of `loadSubscribers(paths)`, sharing one reader and the existing privacy checks. `dispatchHook` takes `subscribersPath`; with it, configuration comes from that file before any environment lookup, and the state paths are resolved only at the registry phase, where failure is already a diagnostic. `bin/relay.js` parses the flag in fixed order for `hook` and, for `install`, reads the subscriber file through the same loader and passes that path into `planHooks`, which renders it into every relay entry and recognizes the new shape as relay-owned.

**Tech Stack:** Node >=22, ES modules, Node built-ins; `node:test`; `jsonc-parser` stays confined to the installer.

**Spec:** `docs/specs/2026-09-18-explicit-subscriber-path.md` (revised after review). Parent: ops `docs/specs/2026-09-16-relay-design.md`; installers plan `docs/plans/2026-09-17-installers.md`.

## Global Constraints

- Node >=22, ES modules, Node built-ins only at runtime; `relay hook` must keep importing nothing from `node_modules` (`test/pack.test.js` proves it).
- Configured guards fail closed: every configuration failure on `PreToolUse`, `UserPromptSubmit` and `Stop` is a native refusal; on other events it is a reported error (`dispatch.js` `abort`).
- Subscriber file privacy is unchanged: regular file, 0600, in a 0700 directory, both owned by the invoking user, no symlink (`src/bus/store.js` `checkPrivate`).
- Flagless `relay hook` and `relay reap` keep today's behavior: `$XDG_CONFIG_HOME/relay/subscribers.json` else `~/.config/relay/subscribers.json`, absent file means no subscribers.
- CLI flag order for `hook` is fixed: `--harness NAME [--outer-ms N] [--subscribers FILE] EVENT`; each flag at most once; `FILE` absolute; violations are `USAGE`, exit 1, empty stdout.
- Conventional commits, no AI attribution. `tasks check` before every commit; `just test-fast` while working; `just gate` on the development runtime and on Node 22 (`PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH just gate`) before integration.
- Work in `.worktrees/relay-a1510a` on branch `relay-a1510a`; `tasks start <child>` before each task, `tasks done <child>` in the task's commit.

## File Structure

| File | Responsibility after this plan |
| --- | --- |
| `src/subscribers.js` | Validation, matching, budgets (unchanged) plus two loaders: `loadSubscribers(paths)` (environment default, absent = none) and `loadSubscribersFrom(file)` (explicit, absent = `INVALID_CONFIG`). |
| `src/dispatch.js` | `dispatchHook` chooses the loader from `subscribersPath`; state paths resolve at the registry phase when the config was explicit. |
| `bin/relay.js` | `hook` parses `--subscribers FILE`; `install` reads subscribers with `loadSubscribersFrom` and passes its absolute path to the planners. |
| `src/install/hooks.js` | Renders `--subscribers '<file>'` into every relay entry; ownership regex accepts the new optional flag. |
| `src/install/claude-code.js`, `src/install/codex.js` | Require and forward `subscribersPath`. |
| `docs/api.md`, `README.md`, `docs/runbooks/hook-install-rollback.md` | Contract text. |

---

### Task 1: The explicit loader

**Files:**
- Modify: `src/subscribers.js:53-62` (`loadSubscribers`)
- Test: `test/subscribers.test.js`

**Interfaces:**
- Consumes: `checkPrivate(path, directory, { io })` from `src/bus/store.js` (returns `false` on ENOENT, throws `IO_ERROR` on unsafe mode/owner/type/symlink), `validateSubscribers(value)`.
- Produces: `loadSubscribersFrom(file, { io = fs } = {}) → Promise<{ schema: 1, subscribers: Subscriber[] }>`; throws `INVALID_CONFIG` when `file` is not an absolute string, does not exist, is unsafe, unreadable or invalid. `loadSubscribers(paths, { io })` keeps its signature and behavior.

- [ ] **Step 1: Write the failing tests**

Append to `test/subscribers.test.js` (the file already imports `chmod`, `tempPaths`, `writeSubscribers`; add `loadSubscribersFrom` to the import from `../src/subscribers.js` and `import { join } from 'node:path'; import { symlink } from 'node:fs/promises';`):

```js
test('loadSubscribersFrom reads an explicit file and treats absence as INVALID_CONFIG', async (t) => {
  const p = await tempPaths(t);
  await assert.rejects(loadSubscribersFrom(p.subscribersPath), { code: 'INVALID_CONFIG', message: /does not exist/ });
  assert.deepEqual(await loadSubscribers(p), { schema: 1, subscribers: [] }); // the default loader is unchanged
  await writeSubscribers(p, [guard()]);
  const config = await loadSubscribersFrom(p.subscribersPath);
  assert.equal(config.subscribers[0].name, 'guard');
  for (const bad of ['relative/subscribers.json', '', null, 7]) await assert.rejects(loadSubscribersFrom(bad), { code: 'INVALID_CONFIG', message: /absolute/ });
});

test('loadSubscribersFrom applies the runtime privacy checks and names them', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [guard()]);
  await chmod(p.subscribersPath, 0o644);
  await assert.rejects(loadSubscribersFrom(p.subscribersPath), { code: 'INVALID_CONFIG', message: /0600 regular file in a 0700 directory/ });
  await chmod(p.subscribersPath, 0o600); await chmod(p.configDir, 0o755);
  await assert.rejects(loadSubscribersFrom(p.subscribersPath), { code: 'INVALID_CONFIG' });
  await chmod(p.configDir, 0o700);
  const link = join(p.configDir, 'link.json'); await symlink(p.subscribersPath, link);
  await assert.rejects(loadSubscribersFrom(link), { code: 'INVALID_CONFIG' });
  await writeSubscribers(p, [], { text: '{broken' });
  await assert.rejects(loadSubscribersFrom(p.subscribersPath), { code: 'INVALID_CONFIG', message: /JSON/ });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/subscribers.test.js`
Expected: the two new tests fail (`loadSubscribersFrom` is not exported).

- [ ] **Step 3: Implement the shared reader**

Replace `loadSubscribers` in `src/subscribers.js` (add `dirname` to the `node:path` import):

```js
// One reader for both loaders. The default location may be absent, which means no
// subscribers; an explicitly named file was written by an installer and must exist.
async function readSubscribers(paths, { io, required }) {
  let present;
  try { present = await checkPrivate(paths.configDir, true, { io }) && await checkPrivate(paths.subscribersPath, false, { io }); }
  catch (cause) { fail(`subscriber config ${paths.subscribersPath} must be a privately owned 0600 regular file in a 0700 directory`, cause); }
  if (!present) {
    if (required) fail(`subscriber config ${paths.subscribersPath} does not exist`);
    return { schema: 1, subscribers: [] };
  }
  let value;
  try { value = JSON.parse(await io.readFile(paths.subscribersPath, 'utf8')); }
  catch (cause) { fail('cannot read subscriber config JSON', cause); }
  return validateSubscribers(value);
}

export const loadSubscribers = (paths, { io = fs } = {}) => readSubscribers(paths, { io, required: false });

// async so that a bad path rejects like every other failure instead of throwing synchronously.
export async function loadSubscribersFrom(file, { io = fs } = {}) {
  if (typeof file !== 'string' || !isAbsolute(file)) fail('subscriber config path must be absolute');
  return readSubscribers({ configDir: dirname(file), subscribersPath: file }, { io, required: true });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/subscribers.test.js test/dispatch.test.js`
Expected: all pass (the existing "privately owned" assertion in the dispatch suite, if any, must be updated to the new message; search for `privately owned 0600 file` and change it to `0600 regular file`).

- [ ] **Step 5: Commit**

```bash
tasks check
git add src/subscribers.js test/subscribers.test.js test/dispatch.test.js
git commit -m "feat: load subscriber configuration from an explicit path"
```

---

### Task 2: The dispatcher takes the explicit path

**Files:**
- Modify: `src/dispatch.js:77-118` (`dispatchHook`)
- Test: `test/dispatch.test.js`

**Interfaces:**
- Consumes: `loadSubscribersFrom` (Task 1).
- Produces: `dispatchHook({ harness, nativeEvent, input, outerMs, subscribersPath = null }, deps)`; `deps.loadConfigFrom` (default `loadSubscribersFrom`) beside the existing `deps.loadConfig`. With `subscribersPath`, `deps.paths ?? defaultPaths(env)` is evaluated only at the registry phase.

- [ ] **Step 1: Write the failing tests**

Append to `test/dispatch.test.js` (helpers `hook`, `guard`, `payload`, `denyOut`, `tempPaths`, `writeSubscribers`, `readSnapshot`, `local` already exist there; `hook` passes `deps` through, so pass `subscribersPath` inside a new `request` option — first extend the helper):

```js
// Replace the existing helper so a request field can be added without a new signature.
async function hook(p, { harness = 'claude-code', nativeEvent = 'PreToolUse', body = payload(), outerMs, subscribersPath, deps = {} } = {}) {
  return dispatchHook({ harness, nativeEvent, input: Readable.from([Buffer.from(body)]), outerMs, subscribersPath }, { paths: p, applyOptions: local, ...deps });
}
```

```js
test('an explicit subscriber path is loaded from that file, not the environment', async (t) => {
  const p = await tempPaths(t), other = await tempPaths(t);
  await writeSubscribers(other, [guard('g', 'deny')]);
  // p has no configuration; the explicit file elsewhere still denies.
  const r = await hook(p, { subscribersPath: other.subscribersPath });
  assert.equal(r.exitCode, 2); assert.ok(r.stdout.startsWith(denyOut));
  // An explicit absent file is a refusal on guard-capable events and an error elsewhere.
  const absent = await hook(p, { subscribersPath: p.subscribersPath });
  assert.equal(absent.exitCode, 2); assert.match(absent.stdout, /relay refused: INVALID_CONFIG: subscriber config .* does not exist/);
  const start = await hook(p, { nativeEvent: 'SessionStart', body: JSON.stringify({ session_id: 'sess', cwd: '/repo' }), subscribersPath: p.subscribersPath });
  assert.deepEqual([start.exitCode, start.stdout], [1, '']); assert.match(start.stderr, /INVALID_CONFIG/);
});

test('an unusable environment cannot reach the policy phase when the path is explicit', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [guard('g', 'deny'), guard('h', 'context')]);
  const bad = { HOME: 'relative', XDG_CONFIG_HOME: 'relative', XDG_STATE_HOME: 'relative' };
  // Denial: the environment is never consulted.
  const denied = await hook(p, { subscribersPath: p.subscribersPath, deps: { paths: undefined, env: bad } });
  assert.equal(denied.exitCode, 2); assert.ok(denied.stdout.startsWith(denyOut));
  // Allow with context: the reply carries the context; the state failure is only a diagnostic.
  await writeSubscribers(p, [guard('h', 'context')]);
  const allowed = await hook(p, { subscribersPath: p.subscribersPath, deps: { paths: undefined, env: bad } });
  assert.equal(allowed.exitCode, 1); assert.match(allowed.stdout, /additionalContext/); assert.match(allowed.stderr, /^registry: INVALID_INPUT/m);
  // Flagless: the same environment refuses before the guards, as today.
  const flagless = await hook(p, { deps: { paths: undefined, env: bad } });
  assert.equal(flagless.exitCode, 2); assert.match(flagless.stdout, /relay refused: INVALID_INPUT/);
});
```

`guard('h', 'context')` uses the existing subscriber fixture's `context` mode (see `test/fixtures/subscriber.js`); `deps.paths: undefined` removes the helper's temp paths so `defaultPaths(env)` runs.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/dispatch.test.js`
Expected: the two new tests fail (`subscribersPath` is ignored; the second refuses with `INVALID_INPUT` on the denial case).

- [ ] **Step 3: Implement**

In `src/dispatch.js`, import `loadSubscribersFrom` beside `loadSubscribers`, and change `dispatchHook`:

```js
export async function dispatchHook({ harness, nativeEvent, input, outerMs, subscribersPath = null }, deps = {}) {
  const clock = deps.clock ?? performance.now.bind(performance), start = clock();
  const { loadConfig = loadSubscribers, loadConfigFrom = loadSubscribersFrom, run = runChild, apply = applyEvent, readInput = readNativeInput, applyOptions = {} } = deps;
  const failure = (error) => ({ stdout: '', stderr: `${describe(error)}\n`, exitCode: 1 });
  let adapter, budget;
  try { adapter = adapterFor(harness); adapter.stateForEvent(nativeEvent); budget = budgetFor({ harness, nativeEvent, outerMs }); }
  catch (error) { return failure(error); }
  const capability = adapter.replies[nativeEvent] ?? NONE;
  const refuse = (reason) => adapter.encodeReply(nativeEvent, { decision: 'deny', reason });
  const abort = (error) => capability.refuse ? refuse(refusalReason(error)) : failure(error);
  const workDeadline = start + budget.totalMs - budget.reserveMs, diagnostics = [];
  // An installed entry names its file; the hook environment (which a harness's shell
  // startup may rewrite) then decides nothing about policy. State paths are needed only
  // for publication and are resolved there, where failure is already a diagnostic.
  const statePaths = () => deps.paths ?? defaultPaths(deps.env ?? process.env);
  let paths = null, event, guards, observers;
  try {
    const load = subscribersPath === null ? () => loadConfig(paths = statePaths()) : () => loadConfigFrom(subscribersPath);
    const config = await bounded(load, { clock, deadline: workDeadline }, 'subscriber configuration did not load before the deadline');
    checkBudget(config, budget, { harness, kind: adapter.events[nativeEvent].kind });
    const raw = await readInput(input, { clock, deadline: Math.min(workDeadline, start + budget.inputMs) });
    event = normalizeEvent(harness, nativeEvent, raw);
    const matching = matchSubscribers(config, event);
    guards = matching.filter((subscriber) => subscriber.role === 'guard');
    observers = matching.filter((subscriber) => subscriber.role === 'observer');
  } catch (error) { return abort(error); }
  const { denial, error, context } = await runGuards(guards, event, capability, { clock, workDeadline, run }, diagnostics);
  if (denial !== null) return refuse(denial);
  if (error) return abort(error);
  let result = null;
  try {
    paths ??= statePaths();
    const deadline = Math.min(workDeadline, clock() + budget.registryMs);
    result = await bounded(() => apply(event, { ...applyOptions, paths, clock, deadline }), { clock, deadline }, 'registry publication did not finish before the deadline');
    for (const diagnostic of result.diagnostics) diagnostics.push(`${diagnostic.code}: ${diagnostic.message}${diagnostic.agentId ? ` (${diagnostic.agentId})` : ''}`);
  } catch (cause) { diagnostics.push(`registry: ${describe(cause)}`); }
  if (result === null) for (const observer of observers) diagnostics.push(`SUBSCRIBER_SKIPPED: ${observer.name} skipped after registry failure`);
  else await runObservers(observers, (observer) => envelope('event', observer, event, result), { clock, workDeadline, run }, diagnostics);
  const reply = adapter.encodeReply(nativeEvent, context ? { decision: 'allow', context } : { decision: 'allow' });
  return { stdout: reply.stdout, stderr: lines(diagnostics), exitCode: result === null ? 1 : reply.exitCode };
}
```

The only behavioral changes are the loader choice and where `statePaths()` runs; `reconcile` is untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/dispatch.test.js`
Expected: all pass, including the existing `path resolution failures are refusals, not startup errors` (flagless behavior is unchanged).

- [ ] **Step 5: Commit**

```bash
tasks check
git add src/dispatch.js test/dispatch.test.js
git commit -m "feat: dispatch from an explicit subscriber path without the environment"
```

---

### Task 3: The hook CLI flag and the environment regression

**Files:**
- Modify: `bin/relay.js:8` (HELP), `bin/relay.js:11-27` (`parse`)
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: `dispatchHook` with `subscribersPath` (Task 2).
- Produces: `relay hook --harness NAME [--outer-ms N] [--subscribers FILE] EVENT`; `parse` returns `{ harness, outerMs?, subscribersPath?, nativeEvent }`.

- [ ] **Step 1: Write the failing tests**

In `test/cli.test.js`, extend the usage matrix inside the `usage:` test with these argument lists (same loop, same assertions):

```js
['hook','--harness','codex','--subscribers','relative.json','PreToolUse'],
['hook','--harness','codex','--subscribers','PreToolUse'],
['hook','--harness','codex','--subscribers','/a.json','--outer-ms','1000','PreToolUse'],
['hook','--harness','codex','--subscribers','/a.json','--subscribers','/b.json','PreToolUse'],
['hook','--harness','codex','PreToolUse','--subscribers','/a.json'],
```

and change the help assertion to `assert.match(run(p,['--help']).stdout,/hook --harness NAME \[--outer-ms N\] \[--subscribers FILE\] EVENT/);`.

Append a new test (uses the existing `tempState`, `layout`, `configure`, `hookRun`, `fixture`, `body`, `join`, `fs`):

```js
test('an installed entry keeps its guard when the hook environment loses the config base', async t => {
  const base=await tempState(t),p=layout(base);
  await configure(p,[{name:'g',role:'guard',kinds:['before-tool'],harnesses:['claude-code','codex'],argv:[process.execPath,fixture,'deny'],timeoutMs:2000}]);
  const file=join(p.configHome,'relay','subscribers.json');
  // The regression the Codex probe missed: a login shell rewrote XDG_CONFIG_HOME before relay ran.
  for(const configHome of [join(base.stateDir,'elsewhere'),'relative']) {
    const r=hookRun({...p,configHome},['--harness','codex','--subscribers',file,'PreToolUse'],body);
    assert.equal(r.status,2,configHome);assert.match(r.stdout,/"permissionDecision":"deny","permissionDecisionReason":"denied by fixture"/);assert.equal(r.stderr,'denied by fixture\n');
  }
  // Without the flag the lost base means no configuration, exactly as before.
  const lost=hookRun({...p,configHome:join(base.stateDir,'elsewhere')},['--harness','codex','PreToolUse'],body);
  assert.equal(lost.status,0);assert.equal(lost.stdout,'');
  // The flag names a file that must exist.
  const missing=hookRun(p,['--harness','codex','--subscribers',join(base.stateDir,'none.json'),'PreToolUse'],body);
  assert.equal(missing.status,2);assert.match(missing.stdout,/INVALID_CONFIG: subscriber config .* does not exist/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/cli.test.js`
Expected: the usage test fails on the help pattern and on `['hook','--harness','codex','--subscribers','relative.json','PreToolUse']` (currently `USAGE` for the wrong reason is still exit 1 — the failing assertions are the help text and the new regression test, which gets exit 1 `USAGE` instead of a denial).

- [ ] **Step 3: Implement the parser**

In `bin/relay.js`, add `isAbsolute` to the `node:path` import, set

```js
const HELP = 'Usage: relay --help | list --json | reap [--outer-ms N] | hook --harness NAME [--outer-ms N] [--subscribers FILE] EVENT | install --harness NAME --subscribers FILE [--target FILE|--config-dir DIR] [--evidence FILE] [--retire familiar] [--artifact FILE --apply] | rollback --artifact FILE\n';
```

and replace the hook branch of `parse`:

```js
  const [flag, name, ...tail] = args, nativeEvent = tail.at(-1), options = tail.slice(0, -1);
  if (flag !== '--harness' || !name || name.startsWith('--')) throw usage('hook requires --harness NAME first');
  const order = () => usage('hook requires [--outer-ms N] [--subscribers FILE] then exactly one EVENT');
  if (!nativeEvent || nativeEvent.startsWith('--')) throw order();
  const request = { harness: name, nativeEvent };
  let i = 0;
  if (options[i] === '--outer-ms') { request.outerMs = readOuter(options[i + 1]); i += 2; }
  if (options[i] === '--subscribers') {
    const file = options[i + 1];
    if (!file || !isAbsolute(file)) throw usage('--subscribers requires an absolute path');
    request.subscribersPath = file; i += 2;
  }
  if (i !== options.length) throw order();
  return request;
```

Update the comment above `parse` to `// Strict flag parsing: --harness NAME (hook only), --outer-ms N, --subscribers FILE, then exactly one EVENT for hook.`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/cli.test.js test/pack.test.js`
Expected: all pass (`pack` proves `relay hook` still imports nothing from `node_modules`).

- [ ] **Step 5: Commit**

```bash
tasks check
git add bin/relay.js test/cli.test.js
git commit -m "feat: accept --subscribers FILE on relay hook"
```

---

### Task 4: The installer writes and validates the path

**Files:**
- Modify: `src/install/hooks.js` (`command`, `relay`, `planHooks`), `src/install/claude-code.js`, `src/install/codex.js`, `bin/relay.js:56-70` (install branch)
- Test: `test/install-hooks.test.js`, `test/install-claude-code.test.js`, `test/install-codex.test.js`, `test/install-cli.test.js`

**Interfaces:**
- Consumes: `loadSubscribersFrom` (Task 1), `shellQuote`, `timeoutSeconds` (existing).
- Produces: `planHooks({ text, harness, relayBin, subscribersPath, retireFamiliar })`, `planClaudeCode({ ..., subscribersPath })`, `planCodex({ ..., subscribersPath })`; every relay entry command is `'<relay>' hook --harness H --outer-ms N --subscribers '<file>' EVENT`.

- [ ] **Step 1: Write the failing planner tests**

In `test/install-hooks.test.js`, add `const subscribers = '/home/me/.config/relay/subscribers.json';` after `relay`, pass `subscribersPath: subscribers` to every existing `planHooks` call, and update the two assertions that expect the budget and event to be adjacent: in the first test, `assert.match(text, /--outer-ms 600000 PreToolUse/);` becomes `assert.match(text, /--outer-ms 600000 --subscribers '\/home\/me\/\.config\/relay\/subscribers\.json' PreToolUse/);`, and in `planner replaces a relay entry whose timeout drifted from its command`, `assert.match(entry.hooks[0].command, /--outer-ms 600000 PreToolUse$/);` becomes `assert.match(entry.hooks[0].command, /--outer-ms 600000 --subscribers '[^']*' PreToolUse$/);`. Then append:

```js
test('every relay entry names the subscriber file after the outer budget', () => {
  for (const harness of ['claude-code', 'codex']) {
    const hooks = JSON.parse(planHooks({ text: '{"hooks":{}}', harness, relayBin: relay, subscribersPath: subscribers })).hooks;
    for (const entries of Object.values(hooks)) for (const entry of entries) {
      assert.match(entry.hooks[0].command, new RegExp(`^'/opt/relay/bin/relay' hook --harness ${harness} --outer-ms \\d+ --subscribers '/home/me/\\.config/relay/subscribers\\.json' \\S+$`));
    }
  }
  assert.throws(() => planHooks({ text: '{"hooks":{}}', harness: 'codex', relayBin: relay, subscribersPath: 'relative.json' }), /absolute/);
  assert.throws(() => planHooks({ text: '{"hooks":{}}', harness: 'codex', relayBin: relay }), /absolute/);
});

test('relay entries from before the flag, and with it, are owned and replaced', () => {
  const text = '{"hooks":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"/x/relay hook --harness codex PreToolUse"}]}],"Stop":[{"hooks":[{"type":"command","command":"\'/x/relay\' hook --harness codex --outer-ms 600000 --subscribers \'/old/subscribers.json\' Stop","timeout":600}]}]}}';
  const hooks = JSON.parse(planHooks({ text, harness: 'codex', relayBin: relay, subscribersPath: subscribers })).hooks;
  assert.equal(hooks.PreToolUse.length, 1); assert.match(hooks.PreToolUse[0].hooks[0].command, /--subscribers '\/home\/me\/\.config\/relay\/subscribers\.json' PreToolUse$/);
  assert.equal(hooks.Stop.length, 1); assert.match(hooks.Stop[0].hooks[0].command, /--subscribers '\/home\/me\/\.config\/relay\/subscribers\.json' Stop$/);
});

test('a second install recognizes its own entries when the paths contain apostrophes', () => {
  // shellQuote writes an apostrophe as '\'' — ownership must read the renderer's own escaping,
  // or a reinstall keeps the old entry and appends a second relay writer.
  const quirky = "/tmp/team's config/subscribers.json", bin = "/opt/o'relay/bin/relay";
  const once = planHooks({ text: '{"hooks":{}}', harness: 'codex', relayBin: bin, subscribersPath: quirky });
  // Match the decoded command: the JSON text doubles the backslash in '\''.
  assert.match(JSON.parse(once).hooks.PreToolUse[0].hooks[0].command, /--subscribers '\/tmp\/team'\\''s config\/subscribers\.json' PreToolUse/);
  const twice = planHooks({ text: once, harness: 'codex', relayBin: bin, subscribersPath: quirky });
  assert.equal(twice, once);
  for (const entries of Object.values(JSON.parse(twice).hooks)) assert.equal(entries.length, 1);
  const moved = JSON.parse(planHooks({ text: once, harness: 'codex', relayBin: relay, subscribersPath: subscribers })).hooks;
  assert.equal(moved.PreToolUse.length, 1); assert.match(moved.PreToolUse[0].hooks[0].command, /^'\/opt\/relay\/bin\/relay' hook/);
});
```

In `test/install-claude-code.test.js` and `test/install-codex.test.js`, pass `subscribersPath: '/home/me/.config/relay/subscribers.json'` to the existing calls and assert `assert.match(result.changes[0].after, /--subscribers '\/home\/me\/\.config\/relay\/subscribers\.json'/);`; add to each `assert.throws(() => plan…({ …same args without subscribersPath… }), /subscriber/);`.

- [ ] **Step 2: Run the planner tests to verify they fail**

Run: `node --test test/install-hooks.test.js test/install-claude-code.test.js test/install-codex.test.js`
Expected: the new assertions fail (no `--subscribers` in the rendered commands; the absolute-path throws are missing).

- [ ] **Step 3: Implement the planner**

In `src/install/hooks.js`:

```js
// A shell-quoted token as shellQuote writes it: single quotes, with an embedded apostrophe
// as '\''. The bare form has no spaces or quotes. This is recognition of our own renderer's
// output, not shell evaluation.
const executable = "(?:'(?:[^']|'\\\\'')*'|[^\\s']+)";
const command = (bin, harness, event, outerMs, subscribersPath) => `${shellQuote(bin)} hook --harness ${harness} --outer-ms ${outerMs} --subscribers ${shellQuote(subscribersPath)} ${event}`;
const relay = (value, harness, event) => new RegExp(`^${executable} hook --harness ${esc(harness)}(?: --outer-ms \\d+)?(?: --subscribers ${executable})? ${esc(event)}$`).test(value);
```

`executable` replaces the existing `(?:'[^']*'|\S+)`, which stops at the first apostrophe inside a quoted token; the same pattern serves `familiar` (unchanged shapes still match, since familiar's quoted paths without apostrophes are a subset). Check the source string produces the regex `(?:'(?:[^']|'\\'')*'|[^\s']+)` — in a JavaScript string literal each regex backslash is written twice.

and in `planHooks({ text, harness, relayBin, subscribersPath, retireFamiliar = false })` add, before the JSONC parse, `if (typeof subscribersPath !== 'string' || !isAbsolute(subscribersPath)) throw new Error('subscriber path must be absolute');` (import `isAbsolute` from `node:path`), and render with `command(relayBin, harness, binding.event, binding.outerMs, subscribersPath)`.

In `src/install/claude-code.js` and `src/install/codex.js`, accept `subscribersPath` in the destructured argument, add `|| !isAbsolute(subscribersPath ?? '')` to the existing guard condition with the message extended `… and subscriber path must be explicit`, and pass `subscribersPath` into `planHooks`.

- [ ] **Step 4: Run the planner tests to verify they pass**

Run: `node --test test/install-hooks.test.js test/install-claude-code.test.js test/install-codex.test.js`
Expected: all pass.

- [ ] **Step 5: Write the failing install CLI tests**

Append to `test/install-cli.test.js` (add `import { mkdtemp, mkdir, writeFile, chmod, rm, symlink } from 'node:fs/promises'; import { tmpdir } from 'node:os'; import { join } from 'node:path';`):

```js
async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), 'relay-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'relay'); await mkdir(dir, { mode: 0o700 });
  const file = join(dir, 'subscribers.json'); await writeFile(file, '{"schema":1,"subscribers":[]}\n', { mode: 0o600 });
  const target = join(root, 'hooks.json'); await writeFile(target, '{"hooks":{}}\n');
  return { root, dir, file, target };
}
const install = (args) => { const out = stream(), err = stream(); return main(args, { stdout: out, stderr: err }).then((code) => ({ code, out: out.text, err: err.text })); };

test('install reads the subscriber file with the runtime checks and writes its path', async (t) => {
  const s = await scratch(t);
  const ok = await install(['install', '--harness', 'codex', '--subscribers', s.file, '--target', s.target]);
  assert.equal(ok.code, 0, ok.err);
  const artifact = JSON.parse(ok.out);
  assert.match(artifact.changes[0].after, new RegExp(`--subscribers '${s.file.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}' PreToolUse`));
  const relative = await install(['install', '--harness', 'codex', '--subscribers', 'relay/subscribers.json', '--target', s.target]);
  assert.equal(relative.code, 1); assert.match(relative.err, /INVALID_CONFIG: subscriber config path must be absolute/);
});

test('install refuses a subscriber file the hook would refuse at runtime', async (t) => {
  const s = await scratch(t);
  const cases = [
    ['0644 file', async () => chmod(s.file, 0o644), /0600 regular file in a 0700 directory/],
    ['0755 directory', async () => { await chmod(s.file, 0o600); await chmod(s.dir, 0o755); }, /0600 regular file in a 0700 directory/],
    ['symlink', async () => { await chmod(s.dir, 0o700); await symlink(s.file, join(s.dir, 'link.json')); s.file = join(s.dir, 'link.json'); }, /0600 regular file in a 0700 directory/],
    ['missing', async () => { s.file = join(s.dir, 'none.json'); }, /does not exist/],
    ['invalid JSON', async () => { s.file = join(s.dir, 'subscribers.json'); await writeFile(s.file, '{broken', { mode: 0o600 }); }, /JSON/],
  ];
  for (const [name, arrange, expected] of cases) {
    await arrange();
    const r = await install(['install', '--harness', 'codex', '--subscribers', s.file, '--target', s.target]);
    assert.equal(r.code, 1, name); assert.equal(r.out, '', name); assert.match(r.err, /^INVALID_CONFIG: /, name); assert.match(r.err, expected, name);
  }
});
```

- [ ] **Step 6: Run the install CLI tests to verify they fail**

Run: `node --test test/install-cli.test.js`
Expected: the first new test fails (no `--subscribers` in the artifact; relative path succeeds today); the second fails on the 0644 case (install accepts it today).

- [ ] **Step 7: Implement the install branch**

In `bin/relay.js`, replace line 62 with:

```js
      const { loadSubscribersFrom } = await import('../src/subscribers.js');
      const subscribersPath = f['--subscribers'], subscribers = await loadSubscribersFrom(subscribersPath);
```

A relative `--subscribers` is refused by the loader (`INVALID_CONFIG: subscriber config path must be absolute`), the same rule `--target` already follows through the planners; the path written into the entries is the path that was checked, byte for byte. Then pass `subscribersPath` into `planClaudeCode` and `planCodex`; `planOpenCode` is unchanged (its `subscribers` object still arrives from the loader).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test test/install-cli.test.js test/cli.test.js`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
tasks check
git add src/install/hooks.js src/install/claude-code.js src/install/codex.js bin/relay.js test/install-hooks.test.js test/install-claude-code.test.js test/install-codex.test.js test/install-cli.test.js
git commit -m "feat: name the subscriber file in installed hook entries"
```

---

### Task 5: Contract docs, gate, and closure

**Files:**
- Modify: `docs/api.md:257-259` (subscriber configuration), `docs/api.md:301-303` (budget source), `docs/api.md:397-398` (CLI), `README.md:28-29`, `docs/runbooks/hook-install-rollback.md`, `docs/specs/2026-09-18-explicit-subscriber-path.md` (status), this plan (status).

- [ ] **Step 1: Update `docs/api.md`**

Subscriber configuration paragraph:

```markdown
**Subscriber configuration** (`$XDG_CONFIG_HOME/relay/subscribers.json`, 0700 dir,
0600 file, owned by the invoking user; an absent file means no subscribers,
anything unreadable, unsafe or invalid is `INVALID_CONFIG`). An installed hook
entry names its file with `--subscribers FILE` instead: that file is loaded
directly, the hook environment is not consulted for it, and an absent file is
`INVALID_CONFIG` (a native refusal on guard-capable events). The installer reads
the file through the same loader, so a file the hook would refuse never installs.
```

Budget source: `relay hook --harness NAME [--outer-ms H] [--subscribers FILE] EVENT`; the installer passes the `H` it writes as the harness `timeout` and the absolute subscriber path it validated.

CLI list: `relay hook --harness NAME [--outer-ms N] [--subscribers FILE] EVENT`.

- [ ] **Step 2: Update `README.md` and the runbook**

README line 28–29: "subscribers come from `~/.config/relay/subscribers.json` for a direct `relay hook`, and from the `--subscribers FILE` an installed entry names."

Runbook, after the timeout paragraph: "Every installed entry also names the subscriber file (`--subscribers '<absolute path>'`) so the harness's hook shell cannot redirect relay to another configuration; the install refuses a file that is not a 0600 regular file in a 0700 directory owned by you, or that is missing or invalid, before writing an artifact. Moving the subscriber file requires a new install."

- [ ] **Step 3: Gate**

Run: `just gate` and `PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH just gate`; then `git diff --check` and `tasks check`.
Expected: both gates pass with zero failures; no whitespace errors; no task findings.

- [ ] **Step 4: Status and closure**

Set the spec status to `implemented and verified, <date>` with the test counts from Step 3, and this plan's status likewise. Then:

```bash
tasks done relay-a1510a "Codex encoding verified correct against codex-cli 0.155.0; the live failure was relay resolving its subscriber file from a hook environment that Codex's login shell rewrote. Installed entries now carry --subscribers <file>, loaded without the environment; an explicit absent file refuses; install validates the file with the runtime checks."
git add -A
git commit -m "docs: record the explicit subscriber path contract

Completes relay-a1510a."
```

Merge fast-forward into `main`, harvest timing logs with `tt-report --project relay --since 1`, unlock and remove the worktree. Live Codex proof remains with ops `ops-88916d`, whose probe must render the current entry shape.

## Verification and Handoff

The regression the probe missed is now a unit-level fact (`test/cli.test.js`: an installed entry keeps its guard when the hook environment loses the config base). Install-time and runtime read the subscriber file through one loader. The ops rerun (`ops-88916d`) provides the live proof and must generate the installer's entry shape (`timeout` field, `--subscribers`), not the pre-change one; note that Codex delivers `additionalContext` as a developer message, so the probe's "tool result" wording may under-report it.
