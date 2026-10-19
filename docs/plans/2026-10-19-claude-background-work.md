# Claude Code Background Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry the counts of Claude Code's in-flight background work on registry rows, reduce `Stop` and `idle_prompt` by them, and release the change as relay v0.1.1.

**Architecture:** The Claude Code adapter reduces a `Stop` payload's `background_tasks` to `{agents, other}` counts (or `null` when unreadable), which ride on the normalized `Event`. The registry transaction carries the counts forward on the row and passes them to the adapter's reducer. Dispatch turns an unreadable report into a non-blocking diagnostic and exit 1 instead of a refusal. A patch release then publishes the tag familiar pins.

**Tech Stack:** Node >=22, ES modules, Node built-ins, `node:test`, strict `tsc --checkJs`. No new dependencies.

**Spec:** `docs/specs/2026-10-19-claude-background-work.md` (approved by the user 2026-10-19 after three review rounds).

**Status:** draft for user review, after plan review rounds 1 (strict-tsc comparisons, step-task closing order, entry readability rule, api.md anchors, OpenCode rejection) and 2 (accept).

## Global Constraints

- Node >=22, ES modules and built-ins only; the one runtime dependency stays `jsonc-parser`.
- `Snapshot.schema` stays `2`; `Event.schema`, subscriber config and envelope `schema` stay `1`.
- `type Background = { agents: number; other: number }`, both nonnegative safe integers.
- Agent-type labels, exactly: `subagent`, `workflow`, `teammate`, `cloud session`. In-flight statuses, exactly: `running`, `pending`. Every other label (an unmapped raw kind included) counts toward `other`.
- Only a Claude Code `Stop` is read for `background_tasks`; `session_crons` is never read.
- `Event.background`: absent (not reported), `Background`, or `null` (reported but unreadable); only on `harness: 'claude-code'`, `nativeEvent: 'Stop'`. `Agent.background`: absent or `Background`, only on `claude-code` rows.
- Nothing from a `background_tasks` entry other than the two counts leaves the adapter (entries carry `description` and shell `command` text).
- Diagnostic text, exactly: `BACKGROUND_UNREADABLE: background_tasks is not a list of {type, status} entries`.
- `reduceState(level, previous, { background } = {})`: the two-argument call keeps today's behaviour.
- Verify with `just test-one <file>` while working, `just test-fast` before each commit, `just check` (strict `tsc`, `tasks check`), and `just gate` on the development runtime and the Node 22 floor before integration. Node 22: `NODE22_BIN=$(dirname "$(ls -d ~/.nvm/versions/node/v22.*/bin/node | sort -V | tail -1)")`, then `PATH="$NODE22_BIN:$PATH" just gate`.
- Pushing `main`, pushing the tag and any public check are outside the repository: Task 6 runs only on the user's explicit go-ahead, given after the branch review.

## Review Focus

1. **A snapshot round-trip that drops the counts.** `validateSnapshot` constructs known fields, so a `validateAgent` that checks `background` but does not return it silently loses the counts on every write, and the next `idle_prompt` shows `needs-input`. Pinned in Task 1 (round-trip) and Task 3 (carry-forward across a `PreToolUse`).
2. **An unreadable `Stop` after an agent-type `Stop`.** The row was `working`; the unreadable report clears the counts, so this `Stop` lands at `done`, not `working`. Pinned in Task 3.
3. **`StopFailure` or `permission_prompt` while work is in flight.** They stay `error` and `needs-approval`, and the carried counts survive them. Pinned in Task 3.
4. **A Codex `Stop` payload carrying `background_tasks`** (a future Codex). It is ignored: no `background` on the event, no refusal. Pinned in Task 2.
5. **Observers on an unreadable `Stop`.** They still run after publication and see `event.background: null`, while the hook exits 1. Pinned in Task 4.

---

## File Structure

- `src/types.js`: `Background`; `Agent.background?`; `Event.background?`; `Adapter.reduceState`'s optional third argument; `Adapter.backgroundOf?`.
- `src/protocol.js`: validation of `Event.background` and `Agent.background`.
- `src/adapters/claude-code.js`: `backgroundOf`, and the reducer.
- `src/adapters/index.js`: `normalizeEvent` attaches `background`.
- `src/bus/transaction.js`: carry-forward and the reducer call.
- `src/dispatch.js`: the unreadable diagnostic and exit 1.
- `test/protocol.test.js`, `test/claude-code.test.js`, `test/payload.test.js`, `test/transaction.test.js`, `test/dispatch.test.js`, `test/types/contracts.js`: tests.
- `docs/api.md`: contracts. `package.json`, `package-lock.json`, `docs/runbooks/release.md`: the release.

---

### Task 1: Registry and event contract for background counts

**Files:**
- Modify: `src/types.js`, `src/protocol.js`
- Test: `test/protocol.test.js`, `test/types/contracts.js`
- Docs: `docs/api.md` (`Agent` and `Event` types, and the validator paragraph after them)

**Interfaces:**
- Produces: typedef `Background` (`{agents: number, other: number}`); `Agent.background?: Background`; `Event.background?: Background|null`. `validateEvent` and `validateAgent` (through `validateSnapshot`) return `background` when present, constructed as `{ agents, other }` only.

- [ ] **Step 1: Write the failing tests** in `test/protocol.test.js`, reusing its `agent`, `snapshot` and event shapes:
  - `test('a Claude row keeps its background counts through validation')`: a `claude-code` session row with `background: { agents: 1, other: 2, extra: 3 }` validates to the same row with `background: { agents: 1, other: 2 }`; a row without `background` validates without the key (`Object.hasOwn(..., 'background') === false`).
  - `test('row background is counts on a Claude row only')`: `INVALID_SCHEMA` for `background` on a Codex row, on an OpenCode row, `null` on a Claude row, and counts `{ agents: -1, other: 0 }`, `{ agents: 0.5, other: 0 }`, `{ agents: 0, other: Number.MAX_SAFE_INTEGER + 1 }`, `{ agents: 0 }`, `[]`.
  - `test('event background is counts or null on a Claude Stop only')`: a Claude `Stop` event (`kind: 'turn-end'`, `nativeEvent: 'Stop'`) validates with counts (extra keys stripped) and with `null`; `INVALID_SCHEMA` for `background` on a Claude `PreToolUse` event, on a Codex `Stop` event, on an OpenCode `init` event (counts and `null`), and for the malformed counts above.
- [ ] **Step 2:** In `test/types/contracts.js`, add `// @ts-expect-error Background counts are numbers.` above `event.background = { agents: '1', other: 0 };`.
- [ ] **Step 3: Run** `just test-one test/protocol.test.js`. Expected: the three new tests fail.
- [ ] **Step 4: Implement.** In `src/types.js`, add `@typedef {{agents: number, other: number}} Background` and the two optional fields. In `src/protocol.js`, add `function counts(v)` (an object whose `agents` and `other` pass `integer`, else `fail('invalid background')`, returning `{ agents, other }`). `validateAgent` accepts `background` only when `v.harness === 'claude-code'` and returns it when present. `validateEvent` accepts it only when `v.harness === 'claude-code' && v.nativeEvent === 'Stop'`, as `null` or `counts(...)`, and returns it when present, beside `stopHookActive`.
- [ ] **Step 5: Run** `just test-one test/protocol.test.js` and `just check`. Expected: pass, and `tsc` clean (the `@ts-expect-error` line is an expected error).
- [ ] **Step 6: Document** in `docs/api.md`: `background?: { agents: number; other: number }; // Claude Code rows only: in-flight background work last reported by Stop` on `Agent`; `background?: { agents: number; other: number } | null; // Claude Code Stop only; null: reported but unreadable` on `Event`; and in the paragraph after them, that `background` is optional on both.
- [ ] **Step 7: Commit** after `just test-fast`: `feat(protocol): carry Claude background counts on events and rows`.

### Task 2: Read background work from a Claude Code Stop

**Files:**
- Modify: `src/adapters/claude-code.js`, `src/adapters/index.js`, `src/types.js` (`Adapter.backgroundOf?`)
- Test: `test/claude-code.test.js`
- Docs: `docs/api.md` (Event mappings section: the parsing rule)

**Interfaces:**
- Consumes: `Background`, and `validateEvent`'s acceptance of `background` (Task 1).
- Produces: `export function backgroundOf(data: Record<string, any>, nativeEvent: string): Background|null|undefined` in `src/adapters/claude-code.js`; `Adapter.backgroundOf?` with that signature. `normalizeEvent` adds `background` to the event only when `backgroundOf` returns something other than `undefined`.

- [ ] **Step 1: Write the failing tests** in `test/claude-code.test.js`, building events with `normalizeEvent('claude-code', 'Stop', JSON.stringify({ session_id: 's', cwd: '/repo', background_tasks: list }))` (`entry = (type, status = 'running') => ({ id: 'x', type, status, description: 'PRIVATE_DESCRIPTION', command: 'PRIVATE_COMMAND' })`):
  - `test('a Stop without background_tasks reports nothing')`: `Object.hasOwn(event, 'background') === false`.
  - `test('in-flight work splits into agent-type and other')`, as `[list, expected]` rows: `[]` → `{agents:0,other:0}`; `[subagent]` → `{1,0}`; `[workflow pending]` → `{1,0}`; `[teammate, cloud session]` → `{2,0}`; `[shell]` → `{0,1}`; `[monitor]` → `{0,1}`; `[subagent completed]` → `{0,0}`; `[local_newkind]` (an unmapped raw kind) → `{0,1}`; `[subagent, shell, shell completed]` → `{1,1}`.
  - `test('entry text never reaches the event')`: `JSON.stringify(event)` contains neither `PRIVATE_DESCRIPTION` nor `PRIVATE_COMMAND`.
  - `test('a minimal entry is readable')`: `[{ type: 'shell', status: 'running' }]` → `{ agents: 0, other: 1 }` (no `id` or `description` needed).
  - `test('an unreadable background_tasks is null, not a failure')`: each of `{}`, `'x'`, `[null]`, `['shell']`, `[{ status: 'running' }]`, `[{ type: 'shell', status: 1 }]`, and `[entry('shell'), { type: 'subagent', status: null }]` (one malformed entry beside a readable one) normalizes without throwing to `background: null`.
  - `test('only a Claude Stop is read')`: a Claude `PreToolUse` payload (with `tool_name`/`tool_input`) carrying `background_tasks: [entry('shell')]` has no `background`; so does a Codex `Stop` payload carrying the same list (Review Focus 4).
- [ ] **Step 2: Run** `just test-one test/claude-code.test.js`. Expected: the new tests fail.
- [ ] **Step 3: Implement** `backgroundOf` in `src/adapters/claude-code.js` with module constants `AGENT_TYPES = new Set(['subagent', 'workflow', 'teammate', 'cloud session'])` and `IN_FLIGHT = new Set(['running', 'pending'])`. It returns `undefined` unless `nativeEvent === 'Stop'` and `Object.hasOwn(data, 'background_tasks')`; `null` for an unreadable list; otherwise the counts. The list is readable when it is an array and every entry is a non-null, non-array object whose `type` and `status` are strings; nothing else is required of an entry. Check every entry before counting any, so one malformed entry makes the whole report `null`. A comment cites the spec and the Claude Code 2.1.302 label map. In `src/adapters/index.js`, `normalizeEvent` calls `adapter.backgroundOf?.(data, nativeEvent)` and spreads `{ background }` into the event when it is not `undefined`.
- [ ] **Step 4: Run** `just test-one test/claude-code.test.js` and `just check`. Expected: pass.
- [ ] **Step 5: Document** in `docs/api.md` under Event mappings: Claude Code `Stop`'s optional `background_tasks` becomes `Event.background` by the rule above (labels, statuses, `null` when unreadable, `session_crons` unread, entry text never copied).
- [ ] **Step 6: Commit** after `just test-fast`: `feat(claude-code): count in-flight background work from Stop`.

### Task 3: Carry the counts and reduce Stop and idle_prompt

**Files:**
- Modify: `src/adapters/claude-code.js` (`reduceState`), `src/bus/transaction.js` (`mutate`), `src/types.js` (`Adapter.reduceState`)
- Test: `test/claude-code.test.js`, `test/payload.test.js`, `test/transaction.test.js`
- Docs: `docs/api.md` (Event mappings: the reduction and carry-forward)

**Interfaces:**
- Consumes: `Event.background`, `Agent.background` (Task 1); `normalizeEvent` producing them (Task 2).
- Produces: `reduceState(level: State|null, previous?: State|null, context?: {background?: Background}) => State|null` on every adapter type; Claude Code's applies the spec's table. Rows carry `background` per the spec's carry-forward table.

- [ ] **Step 1: Write the failing reducer tests** in `test/claude-code.test.js` (`STATES` from `src/protocol.js`):
  - `test('Claude reduction is the identity without counts')`: for every level in `STATES` plus `null`, `reduceState(level, 'done')`, `reduceState(level, 'done', {})` and `reduceState(level, 'done', { background: { agents: 0, other: 0 } })` equal `level`.
  - `test('a Stop with agent work in flight stays working')`: `reduceState('done', 'working', { background: { agents: 1, other: 0 } }) === 'working'`, and the same with `{ agents: 2, other: 3 }`.
  - `test('idle_prompt with other work in flight is idle; agent counts do not count')`: `needs-input` with `{0,1}` → `idle`; with `{2,0}` → `needs-input`.
  - `test('other levels ignore the counts')`: `idle`, `working`, `needs-approval` and `error` with `{ agents: 1, other: 1 }` equal themselves.
- [ ] **Step 2:** Keep `test/payload.test.js`'s two-argument reducer test unchanged; it must still pass.
- [ ] **Step 3: Write the failing transaction tests** in `test/transaction.test.js`, using `tempState`/`localObservation` and `claude = (native, fields = {}) => normalizeEvent('claude-code', native, JSON.stringify({ session_id: S, cwd: '/repo', ...fields }))` with `S` a fixed UUID, `shell = { id: 'b1', type: 'shell', status: 'running', description: 'd' }`, `agent = { ...shell, id: 'a1', type: 'subagent' }`, `bg = (list) => ({ background_tasks: list })`; read `snapshot.agents['claude-code:' + S]`:
  - `test('a shell left running turns the idle prompt into idle')`: `Stop` `bg([shell])` then `Notification:idle_prompt`: `state === 'idle'`, `background` `{0,1}`.
  - `test('the idle prompt after the work finished is needs-input again')`: `Stop` `bg([shell])`, `Stop` `bg([{ ...shell, status: 'completed' }])`, `idle_prompt`: `needs-input`, `background` `{0,0}`.
  - `test('an event that does not report carries the counts forward')`: `Stop` `bg([shell])` then `PreToolUse` (with a tool): `background` `{0,1}` (Review Focus 1).
  - `test('a Stop handing work to an agent stays working')`: `Stop` `bg([agent])`: `working`.
  - `test('agent and shell, then shell only, then the idle prompt')`: `working`, then `done`, then `idle`.
  - `test('an agent-only Stop then the idle prompt is needs-input')`.
  - `test('an unreadable report clears the counts')`: `Stop` `bg([shell])`, `Stop` `bg('x')`, `idle_prompt`: `needs-input` and `Object.hasOwn(row, 'background') === false`. Also `Stop` `bg([agent])` then `Stop` `bg('x')`: `done` (Review Focus 2).
  - `test('failure and approval prompts ignore the counts and keep them')`: after `Stop` `bg([agent, shell])`, `StopFailure` → `error` with `background` `{1,1}`; then `Notification:permission_prompt` → `needs-approval` with `background` `{1,1}` (Review Focus 3).
  - `test('a session row without a report has no background')`: `SessionStart` alone: no `background` key.
- [ ] **Step 4: Run** `just test-one test/claude-code.test.js test/transaction.test.js`. Expected: the new tests fail.
- [ ] **Step 5: Implement.** `src/types.js`: `reduceState: (level: State|null, previous?: State|null, context?: {background?: Background}) => State|null`. `src/adapters/claude-code.js`: `reduceState(level, _previous, { background } = {})` with the spec's two rules: `level === 'done' && (background?.agents ?? 0) > 0` gives `working`, and `level === 'needs-input' && (background?.other ?? 0) > 0` gives `idle` (the `?? 0` keeps strict `tsc` clean); its comment states why each holds (spec, Reduction). `src/bus/transaction.js`, in the upsert branch of `mutate`: `const previous = agents[event.agentId]`; `background` is `previous?.background` when `event.background === undefined`, nothing when it is `null`, else `event.background`; pass `{ background }` to `reduceState`; spread `{ background }` into the row only when defined.
- [ ] **Step 6: Run** `just test-one test/claude-code.test.js test/payload.test.js test/transaction.test.js` and `just check`. Expected: pass.
- [ ] **Step 7: Document** in `docs/api.md` under Event mappings: the reduction table and the carry-forward table from the spec, and that observers read the reduced state from the row, since matching uses `event.kind`. In the adapter interface (`docs/api.md`, `reduceState(level: State | null, previous: State | null): State | null;`), make `previous` optional and add `context?: { background?: { agents: number; other: number } }`; say the two-argument call means no counts.
- [ ] **Step 8: Commit** after `just test-fast`: `feat(registry): reduce Claude Stop and idle prompts by background work`.

### Task 4: An unreadable report never blocks a Stop

**Files:**
- Modify: `src/dispatch.js` (`dispatchHook`)
- Test: `test/dispatch.test.js`
- Docs: `docs/api.md` (Hook exit codes table, observer envelope line)

**Interfaces:**
- Consumes: `Event.background === null` from `normalizeEvent` (Task 2); publication from Task 3.
- Produces: on an event with `background: null`, the hook pushes the exact `BACKGROUND_UNREADABLE` diagnostic, publishes, runs observers, and exits 1 with the allow reply's stdout; a guard denial still returns the refusal (exit 2).

- [ ] **Step 1: Write the failing tests** in `test/dispatch.test.js`, with `stopBody = (list) => JSON.stringify({ session_id: 'sess', cwd: '/repo', stop_hook_active: false, background_tasks: list })` and `hook(p, { nativeEvent: 'Stop', body: ... })`:
  - `test('an unreadable background report publishes and exits 1 without refusing')`: no subscribers, `stopBody('x')`: `{ stdout: '', stderr: 'BACKGROUND_UNREADABLE: background_tasks is not a list of {type, status} entries\n', exitCode: 1 }`; `readSnapshot` shows `claude-code:sess` at `done` with no `background`.
  - `test('a refusing Stop guard still wins over an unreadable report')`: a `turn-end` guard in `deny` mode: `exitCode === 2`, stdout `{"decision":"block","reason":"denied by fixture"}\n`, and `readSnapshot` is `null`.
  - `test('observers see the counts, or null when unreadable')`: a `record` observer with `kinds: ['turn-end']`: for `stopBody([{ id: 'a', type: 'subagent', status: 'running', description: 'PRIVATE_DESCRIPTION' }])` the recorded `event.background` is `{ agents: 1, other: 0 }` and the file does not contain `PRIVATE_DESCRIPTION`; for `stopBody('x')` it is `null` and the hook exits 1 (Review Focus 5).
  - A readable `stopBody([])` with no subscribers still returns `{ stdout: '', stderr: '', exitCode: 0 }`.
- [ ] **Step 2: Run** `just test-one test/dispatch.test.js`. Expected: the new tests fail.
- [ ] **Step 3: Implement** in `dispatchHook`: after `normalizeEvent`, when `event.background === null`, push the diagnostic; the final return's `exitCode` is `1` when `result === null` or the event was unreadable, else `reply.exitCode`. The envelope already spreads the event, so it needs no change.
- [ ] **Step 4: Run** `just test-one test/dispatch.test.js` and `just check`. Expected: pass.
- [ ] **Step 5: Document** in `docs/api.md`: in the Hook exit codes section, after "Observer failures never change the exit code; they are stderr diagnostics.", `BACKGROUND_UNREADABLE` with its exact text, that it is a stderr diagnostic, not an error code, and that the event still publishes and observers still run; the exit-code row for `1` adds "or a published event whose `background_tasks` was unreadable (`BACKGROUND_UNREADABLE`); exit 1 does not imply the registry is unchanged"; the observer envelope line notes `event.background`.
- [ ] **Step 6: Commit** after `just test-fast`: `fix(dispatch): report an unreadable background list instead of refusing Stop`.

### Task 5: Prepare v0.1.1

**Files:**
- Modify: `package.json`, `package-lock.json` (`version`, both places), `docs/runbooks/release.md` (new `## v0.1.1` section above `## v0.1.0`), `docs/specs/2026-10-19-claude-background-work.md` (Status line)

- [ ] **Step 1: Bump the version** with `npm version 0.1.1 --no-git-tag-version`. Expected: `package.json` and both `package-lock.json` entries read `0.1.1`; `git diff --stat` touches only those two files.
- [ ] **Step 2: Write `## v0.1.1`** in `docs/runbooks/release.md`: one paragraph on what changed (Claude Code background counts: `Agent.background`, `Event.background`, the two reductions, exit 1 with `BACKGROUND_UNREADABLE`; spec and task named), that platform status and capability evidence are unchanged from v0.1.0, and a `### Gates` line to fill in Step 4.
- [ ] **Step 3: Mark the spec implemented**: its Status line gains `Implemented 2026-10-19 by docs/plans/2026-10-19-claude-background-work.md.`
- [ ] **Step 4: Gate the branch** with `just gate` and `PATH="$NODE22_BIN:$PATH" just gate`. Expected: both pass; record both counts in the `### Gates` line.
- [ ] **Step 5: Commit**: `chore(release): prepare v0.1.1`.
- [ ] **Step 6: Final whole-branch review** (fresh reviewer), then corrective rounds per the execution skill, before integration.
- [ ] **Step 7: Integrate and fix `REL`.** In the main checkout: `git merge --ff-only feat/bg-tasks` when main has not moved, else `git merge --no-ff feat/bg-tasks`; `just gate` on both runtimes on main; `REL=$(git rev-parse HEAD)`; `tasks note relay-fe38b1 "REL <sha>: gates <dev counts> / <node22 counts>"`. Later steps read `REL` from that note.
- [ ] **Step 8: Privacy review** over `v0.1.0..$REL` by the runbook (its pattern-file controls first; the range in place of `--all`, keeping `--diff-merges=first-parent`; gitleaks with `--log-opts="v0.1.0..$REL --diff-merges=first-parent"`). Expected: every row's expected result. Anything else: stop and report.
- [ ] **Step 9: Rehearse `REL`** by the runbook's step 4 with tag `v0.1.1-rehearsal`, on both runtimes. Expected: `portability: pass` twice. Remove the scratch directory.

### Task 6: Publish v0.1.1

Runs only on the user's explicit go-ahead for this task. The repository is already public, so the runbook's private-refusal step (7) does not apply and step 8 is a check. Read `REL` from the Task 5 note.

- [ ] **Step 1: Check account and remote.** `GH_TOKEN=$(gh auth token --user khughitt) gh api user --jq .login` prints `khughitt`; `… gh repo view khughitt/relay --json visibility` shows `PUBLIC`; `git ls-remote --refs origin` lists `refs/heads/main` at an ancestor of `REL` and `refs/tags/v0.1.0`, nothing else. Anything else: stop.
- [ ] **Step 2: Push and tag**: `git push origin "$REL:refs/heads/main"`, `git tag -a v0.1.1 -m "relay v0.1.1" "$REL"`, `git push origin refs/tags/v0.1.1`.
- [ ] **Step 3: Verify one commit everywhere**: `git ls-remote origin 'refs/tags/v0.1.1^{}' refs/heads/main` prints `REL` twice; `git ls-remote --refs origin` lists exactly `main`, `v0.1.0` and `v0.1.1`.
- [ ] **Step 4: Portability against the public tag** on both runtimes: `node tools/release/portability.mjs --spec git+https://github.com/khughitt/relay.git#v0.1.1 --commit "$REL"`. Expected: `portability: pass` twice. A network, DNS, GitHub 5xx or codeload failure is rerun after a short wait; only a failure that reproduces with the network healthy is a defect.

### Task 7: Record the release and close out

- [ ] **Step 1: Publication record.** On `feat/bg-tasks`, after `git merge --ff-only main`, append `### Publication record` to the v0.1.1 section: tag object sha, `REL`, push date, `REL`'s gate counts and privacy-review results (Task 5), and both runtimes' portability output verbatim. Commit: `docs(release): v0.1.1 publication record`.
- [ ] **Step 2: Tell the consumer.** `tasks note fam-6e8321` with the pin `git+https://github.com/khughitt/relay.git#v0.1.1`, `REL`, the field `Agent.background: {agents, other}` (not `backgroundTasks`), and that consumer spec §8 and its parity test need that shape. If the note is refused (`stale_copy`: another session holds the task), give the same text to the user instead.
- [ ] **Step 3: Close this step, then the task, on the branch**: `tasks done relay-74b012 "<publication record committed; consumer told>"`, then `tasks done relay-fe38b1 "<tag, REL, portability result>"`. The parent refuses while any step task is open, so every earlier step task must already be done (each closes when its commit lands).
- [ ] **Step 4: Integrate and push**: fast-forward main (else `--no-ff` and `just gate`), privacy review over `"$REL"..main`, `git push origin main`. Task 6's go-ahead covers this push.
- [ ] **Step 5: Remove the worktree** after integration, as cleanup outside the task's record: `tt-report`, the ignored-file check, no host pointer into it, `git worktree unlock`, `git worktree remove`.
