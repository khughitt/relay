# Typed interaction messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Accepted after plan review round 4. All 14 tasks are implemented and
independently reviewed. The user-present tailnet acceptance (spec acceptance 7)
passed phone answer, phone defer and desk withdrawal; see the
[run record](../runbooks/inbox-e2e-2026-10.md).

**Goal:** A durable question inbox in relay, served by one long-lived `relay serve`,
answered from a phone over the tailnet. The first route is a Claude Code
`AskUserQuestion` in an interactive terminal session.

**Architecture:**
- **Data and state.** Messages are validated plain objects
  (`src/interaction/message.js`). The lifecycle is a pure state machine
  (`src/interaction/lifecycle.js`). A durable, fsynced per-entry store
  (`src/interaction/store.js`) holds the entries.
- **The service.** `relay serve` composes a serialized inbox (`src/serve/inbox.js`), a
  unix-socket server (`src/serve/socket.js`) and a loopback HTTP surface with a tailnet
  guard (`src/serve/http.js`). It holds the registry's existing lock primitive for its
  lifetime.
- **The Claude route.** `relay ask` is the hook: it translates the call and waits on the
  socket (`src/routes/claude-code.js`, `src/routes/ask.js`).

**Tech Stack:** Node >=22, ES modules, Node built-ins only (`node:net`, `node:http`,
`node:fs/promises`, `node:test`). The installer keeps its one dependency,
`jsonc-parser`.

**Spec:** `docs/specs/2026-10-11-typed-interaction-messages.md` (accepted, review round
3). Read it before any task: section numbers below (§5.2 and so on) refer to it.

## Global Constraints

- Runtime: Node >=22, ES modules, Node built-ins only; no new npm dependency (AGENTS.md).
- Every test passes on Node 26 and on the Node 22 floor:
  `PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH just gate`.
- Test front door: `just test-one <file>` for the file being worked on (added in Task 2),
  `just test-fast` before each commit, `just gate` before integration. Never call
  `node --test` directly.
- State lives under the existing private 0700 state directory (`paths().stateDir`). Files
  are 0600. An unsafe mode is rejected, never repaired.
- Error objects use `relayError(code, message, cause)` from `src/protocol.js`.
- No raw harness payload, transcript or environment value enters the inbox store (§6).
- No live hook is installed by any task. Installing `relay ask` into a real Claude
  settings file is the user's act (Task 12 uses `claude --settings` on a scratch file).
- Conventional commits, no AI attribution. Run `tasks check` before every commit.
- The CLI surface is pinned to `tools/cli.toml`, vendored from ops: a command in
  `src/commands.js` without its table row fails `test/cli-surface.test.js`. Tasks 7–11
  therefore build and test modules, driven by test fixtures. Task 12 lands the rows in
  ops, adopts them, and wires every new command in one commit.
- Each task's tracking child is started with `tasks start <id>` before its first change
  and closed with `tasks done <id> "<what landed>"` in its final commit.
- Times inside messages and entries are Unix milliseconds (`Date.now()`). Process
  deadlines use `performance.now()`, as the existing code does.

## Review Focus

1. **A hook killed while it holds a socket request.** The entry must move once, never
   twice. Tasks 7 and 9 test a kill before `handed`, a kill after `handed`, and a service
   crash between persisting `handed` and acknowledging it.
2. **A phone retries an answer whose response was lost, then a different device
   answers.** The retry returns the saved entry in every answer-holding state, and the
   second device gets `ALREADY_ANSWERED` with the winner (Tasks 3, 8).
3. **A host suspended past a question's expiry, then woken with an answer queued on the
   phone.** Expiry applies before the answer, so the answer gets `EXPIRED` (Tasks 5, 8).
4. **A proxied request whose `Host` or login differs only in case or port, or that
   carries the Funnel header.** It gets 403 for every path, static files included
   (Task 8).
5. **A Claude question whose text or header is outside the schema's limits.** The hook
   passes the call through to the native question and prints a diagnostic. It never
   blocks the user or invents an answer (Tasks 6, 9).

---

### Task 1: Live probes P1, P2 and P3, and the route evidence record

**Files:**
- Create: `tools/answer-probe/run.mjs`
- Create: `tools/answer-probe/hook.mjs`
- Create: `docs/evidence/claude-code-answer-routes.json`
- Create: `test/fixtures/claude-askuserquestion-post.json`
- Create: `docs/runbooks/answer-route-probes.md`

**Interfaces:**
- Produces: the evidence file, read by Task 10 (`routes[]` rows named in §11), and the
  PostToolUse fixture, read by Task 6 (`observedAnswers`).

This task runs Claude Code. It uses a private tmux server (`tmux -L relay-probe`), which
opens no desktop window and takes no focus, and it costs a few model turns per scenario.
The driver kills its tmux server on exit and on SIGINT or SIGTERM.

- [ ] **Step 1: Write the probe hook**

`tools/answer-probe/hook.mjs`:

```js
#!/usr/bin/env node
// Probe hook for AskUserQuestion. argv: MODE SECONDS LOGFILE. Appends one JSON line per
// event to LOGFILE; never touches anything else.
import { appendFileSync, readFileSync } from 'node:fs';
const [mode, seconds, log] = process.argv.slice(2);
const at = () => Date.now();
const note = (event, extra = {}) => appendFileSync(log, `${JSON.stringify({ at: at(), pid: process.pid, mode, event, ...extra })}\n`);
const input = JSON.parse(readFileSync(0, 'utf8'));
note('fired', { hook: input.hook_event_name, toolUseId: input.tool_use_id, toolInput: input.tool_input, toolResponse: input.tool_response });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { note('signal', { signal }); process.exit(143); });
const out = (value) => { note('return', { value }); process.stdout.write(`${JSON.stringify(value)}\n`); process.exit(0); };
const pre = (decision, extra) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, ...extra } });
const wait = (s) => new Promise((resolve) => setTimeout(resolve, Number(s) * 1000));
if (mode === 'post-log') process.exit(0);
await wait(seconds);
if (mode === 'answer') out(pre('allow', { updatedInput: { ...input.tool_input, answers: Object.fromEntries(input.tool_input.questions.map((q) => [q.question, 'Square'])) } }));
if (mode === 'deny') out(pre('deny', { permissionDecisionReason: 'question withdrawn by the user; do not wait for an answer' }));
if (mode === 'release') { note('return', { value: null }); process.exit(0); }
throw new Error(`unknown mode ${mode}`);
```

- [ ] **Step 2: Write the driver**

`tools/answer-probe/run.mjs`:

```js
#!/usr/bin/env node
// Live probes for the Claude terminal question route (spec §2 P1-P3, §11). Usage:
//   node tools/answer-probe/run.mjs --out DIR [--only NAME]
// Each scenario starts an interactive Claude session in a private tmux server with a scratch
// --settings file, records hook events and pane captures under DIR/<scenario>/, and prints a
// summary. Verdicts are written by the person or agent reading the summary (runbook).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const args = process.argv.slice(2), opt = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const out = resolve(opt('--out') ?? mkdtempSync(join(tmpdir(), 'answer-probe-'))), only = opt('--only');
const hook = new URL('./hook.mjs', import.meta.url).pathname, node = process.execPath;
const SOCKET = 'relay-probe';
const tmux = (...a) => execFileSync('tmux', ['-L', SOCKET, ...a], { encoding: 'utf8' });
const cleanup = () => spawnSync('tmux', ['-L', SOCKET, 'kill-server']);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup(); process.exit(130); });
process.on('exit', cleanup);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROMPT = 'Use the AskUserQuestion tool to ask me exactly one question: which shape do I prefer, with the two options Circle and Square. After I answer, reply with exactly CHOSEN=<the label I chose> and nothing else.';
const entry = (mode, seconds, log, timeout = 86400) => ({ type: 'command', command: `${node} ${hook} ${mode} ${seconds} ${log}`, timeout });
const scenarios = {
  // answer-hook-terminal and P2 (hook-supplied answer).
  'hook-answer': (log) => ({ PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('answer', 30, log)] }], PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('post-log', 0, log, 10)] }] }),
  // answer-hook-deny-stops.
  'deny': (log) => ({ PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('deny', 5, log)] }], PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('post-log', 0, log, 10)] }] }),
  // P1 and P2 (native answer after a release).
  'release': (log) => ({ PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('release', 120, log)] }], PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('post-log', 0, log, 10)] }] }),
  // P3: a fast deny beside a blocking hook.
  'under-denial': (log) => ({ PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('deny', 0, log), entry('answer', 120, log)] }], PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('post-log', 0, log, 10)] }] }),
};
const capture = (name) => tmux('capture-pane', '-p', '-t', name, '-S', '-200');
async function until(check, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return true; await sleep(1000); }
  return false;
}
async function waitFor(name, pattern, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const pane = capture(name); if (pattern.test(pane)) return pane; await sleep(1000); }
  return null;
}
const events = (log) => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const version = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim().split(/\s+/)[0];
const summary = { version, out, scenarios: {} };
for (const [name, settingsFor] of Object.entries(scenarios)) {
  if (only && only !== name) continue;
  const dir = join(out, name), ws = join(dir, 'ws'), log = join(dir, 'hook.log');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hooks: settingsFor(log) }, null, 2));
  tmux('new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', ws, `claude --settings ${join(dir, 'settings.json')} ${JSON.stringify(PROMPT)}`);
  if (await waitFor(name, /trust/i, 15000)) tmux('send-keys', '-t', name, 'Enter');
  const started = Date.now();
  const keys = [];
  if (name === 'release') {
    // The prompt itself names Circle and Square, so wait for the hook's release first, then for
    // the native option list: "2. Square" appears only there. Try the key sequences in turn until
    // PostToolUse fires, and record every key sent.
    const answered = () => events(log).some((e) => e.event === 'fired' && e.hook === 'PostToolUse');
    if (await until(() => events(log).some((e) => e.event === 'return'), 200000)) {
      for (const attempt of [['Down', 'Enter'], ['2'], ['Enter']]) {
        if (answered() || !await waitFor(name, /\b2\.\s+Square/, 20000)) break;
        for (const key of attempt) { tmux('send-keys', '-t', name, key); keys.push(key); await sleep(500); }
        if (await waitFor(name, /Submit|Review your answers/i, 3000)) { tmux('send-keys', '-t', name, 'Enter'); keys.push('Enter'); }
        await until(answered, 10000);
      }
    }
  }
  const finished = await waitFor(name, /CHOSEN=\w+/, name === 'deny' ? 60000 : 260000);
  await sleep(name === 'deny' ? 60000 : 5000); // deny: watch for a re-ask
  const pane = capture(name);
  writeFileSync(join(dir, 'pane.txt'), pane);
  summary.scenarios[name] = { startedAt: started, chosen: /CHOSEN=(\w+)/.exec(finished ?? pane)?.[1] ?? null, keys, events: events(log) };
  tmux('kill-session', '-t', name);
}
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
```

- [ ] **Step 3: Run the probes**

Run: `node tools/answer-probe/run.mjs --out "$(mktemp -d)/answer-probe"`
Expected: a JSON summary naming the installed Claude version, with four scenarios, each
holding its hook events and, for `release`, the keys the driver sent. It runs for about
12 minutes. If `release` shows the hook's release but no PostToolUse after all three key
sequences, rerun it with `--only release`. While it runs, watch with
`tmux -L relay-probe capture-pane -p -t release` and drive the UI by hand with
`tmux -L relay-probe send-keys -t release ...`. Write down every key you sent: a
failure to drive the UI is not a P1 failure.

- [ ] **Step 4: Judge each row and write the evidence record**

Apply these rules to `summary.json`:

| Row | Passes when |
| --- | --- |
| `answer-hook-terminal` | `hook-answer`: one `fired` (PreToolUse) and one `return` with `allow`, and `chosen` is `Square`. |
| `answer-hook-deny-stops` | `deny`: a `return` with `deny`, `chosen` is null, and no second PreToolUse `fired` within the 60 s watch. |
| `answer-release-native` (P1) | `release`: the hook's `return` with `value: null` precedes the native question, and `chosen` is `Square`. |
| `answer-receipt-observed` (P2) | `hook-answer` has a PostToolUse `fired` whose `toolUseId` equals the PreToolUse one, and whose `toolResponse` contains the answers map (question text to `Square`). The same holds in `release` for the native answer. Record the delay from the PreToolUse `return` to the PostToolUse `fired`. |
| `answer-hook-under-denial` (P3) | Recorded whatever happened: a `signal` event (killed), a late `return` (awaited), or neither before the session ended (left running). Also record whether PostToolUse fired. |

Write `docs/evidence/claude-code-answer-routes.json` in this exact shape, with real
values:

```json
{
  "schema": 1,
  "harness": "claude-code",
  "version": "<claude --version>",
  "probes": [],
  "routes": [
    { "name": "answer-hook-terminal", "passed": true, "note": "<one line: what the run showed>" },
    { "name": "answer-hook-deny-stops", "passed": true, "note": "<one line>" },
    { "name": "answer-release-native", "passed": true, "note": "<one line>" },
    { "name": "answer-receipt-observed", "passed": true, "note": "<one line, with the measured delay and where the answers sit in tool_response>" },
    { "name": "answer-hook-under-denial", "passed": true, "note": "<killed|awaited|left running>; PostToolUse <fired|did not fire>" }
  ]
}
```

Copy the `hook-answer` PostToolUse `fired` input to
`test/fixtures/claude-askuserquestion-post.json`. Take it from `hook.log` (the
`toolResponse` field) and rebuild the whole native payload in this shape:
`{ "session_id": "00000000-0000-4000-8000-000000000000", "transcript_path": "/tmp/x.jsonl", "cwd": "/tmp/ws", "hook_event_name": "PostToolUse", "tool_name": "AskUserQuestion", "tool_input": <toolInput>, "tool_response": <toolResponse>, "tool_use_id": "toolu_fixture" }`.
The fixed ids redact the real session.

- [ ] **Step 5: Apply the fallbacks the spec names, if any row failed**

- **P1 failed.** Later tasks are unchanged. The installer omits `--handback` (Task 11),
  and the hook's `expired` branch denies.
- **P2 failed, or the answers are not in `tool_response.answers`.** If P2 failed
  outright, the installer omits the PostToolUse row (Task 11), and nothing else changes.
  If the answers sit elsewhere, Task 6's `observedAnswers` reads them from the path the
  fixture shows. That is the only change, and the Task 6 fixture test pins it.
- **`answer-hook-terminal` or `answer-hook-deny-stops` failed.** Stop. Park the task
  with `tasks park <id> "<which row failed and what was seen>" --waiting-on user
  --reason decision`, because the route the spec designs does not exist on this
  version.

Note each fallback taken on the task: `tasks note <id> "<row> failed: <fallback applied>"`.

- [ ] **Step 6: Write the runbook**

`docs/runbooks/answer-route-probes.md`:

```markdown
# Answer route probes

Re-run whenever Claude Code's version changes before installing or reinstalling the
`relay ask` route (spec docs/specs/2026-10-11-typed-interaction-messages.md §2, §11).

    node tools/answer-probe/run.mjs --out "$(mktemp -d)/answer-probe"

The driver uses a private tmux server (`tmux -L relay-probe`) and a scratch
`--settings` file per scenario; it changes no live configuration. It merges with the
user's own settings, so the user's own PreToolUse hooks also run; a guard that denies
`AskUserQuestion` invalidates the run. Judge each row with the table in the
implementation plan's Task 1 Step 4 and write the record to
docs/evidence/claude-code-answer-routes.json. Keep the previous record in git history;
the installer reads the file named by `--evidence`.
```

- [ ] **Step 7: Commit**

```bash
tasks check
git add tools/answer-probe docs/evidence/claude-code-answer-routes.json test/fixtures/claude-askuserquestion-post.json docs/runbooks/answer-route-probes.md
git commit -m "test(probe): Claude Code answer route probes and evidence"
```

---

### Task 2: Message schema and validators

**Files:**
- Modify: `justfile` (add `test-one`)
- Create: `schemas/interaction/message.schema.json`
- Create: `src/interaction/message.js`
- Create: `test/helpers/interaction.js`
- Test: `test/interaction-message.test.js`

**Interfaces:**
- Produces:
  - `validateMessage(value) -> Message`. It throws `INVALID_MESSAGE` and returns a fresh
    normalized object.
  - `checkAnswer(questionBody, answerBody) -> void`. It throws `INVALID_ANSWER`.
  - Constants: `MESSAGE_KINDS`, `CLASSES`, `ITEM_TYPES`, `SURFACES`, `LOCAL_SURFACES`,
    `WITHDRAWAL_REASONS`.
  - Test helpers in `test/helpers/interaction.js`: `uuid()`, `HANDLE`, `OTHER_HANDLE`,
    `questionMessage(patch?)`, `answerMessage(question, valuesOrPatch?)`,
    `deferMessage(question, surface?)`, `withdrawalMessage(question, reason?)`,
    `noticeMessage(patch?)`.

- [ ] **Step 1: Add the focused test recipe**

In `justfile`, after the `test-fast` recipe:

```just
# One test file or pattern: the inner loop while writing it. Recorded like the others.
test-one *args:
    {{tt}} test-one -- node --test {{args}}
```

- [ ] **Step 2: Write the test helpers**

`test/helpers/interaction.js`:

```js
import { randomUUID } from 'node:crypto';
export const uuid = () => randomUUID();
export const HANDLE = Object.freeze({ platform: 'linux', host: 'h', bootId: null, pid: 4242, start: '100' });
export const OTHER_HANDLE = Object.freeze({ ...HANDLE, pid: 4343 });
export const NOW = 1_800_000_000_000;
export function questionMessage(patch = {}) {
  const id = patch.id ?? uuid();
  const base = { schema: 1, id, kind: 'question', correlationId: id,
    from: { kind: 'agent', agentId: 'claude-code:s1' }, to: { kind: 'user' }, createdAt: NOW,
    context: { project: null, taskId: null, cwd: '/w' },
    body: { class: 'clarification', expiresAt: NOW + 3_600_000, native: { harness: 'claude-code', sessionId: 's1', callId: 'toolu_1' },
      artifact: null, supersedes: null,
      items: [{ id: 'q1', header: 'Shape', prompt: 'Which shape?', type: 'single',
        options: [{ id: 'o1', label: 'Circle', description: null }, { id: 'o2', label: 'Square', description: 'Four sides' }],
        recommended: null, allowOther: true, maxLength: null }] } };
  return { ...base, ...patch, body: { ...base.body, ...(patch.body ?? {}) } };
}
const reply = (question, kind, body) => ({ schema: 1, id: uuid(), kind, correlationId: question.id, from: { kind: 'user' },
  to: question.from, createdAt: NOW + 1000, context: question.context, body });
export function answerMessage(question, patch = {}) {
  return reply(question, 'answer', { answerId: uuid(), surface: 'phone', outcome: 'answered', artifactRevision: null,
    values: { q1: { type: 'choice', optionIds: ['o2'] } }, ...patch });
}
export const deferMessage = (question, surface = 'phone') => reply(question, 'defer', { surface });
export const withdrawalMessage = (question, reason = 'user') => reply(question, 'withdrawal', { reason });
export function noticeMessage(patch = {}) {
  const id = uuid();
  return { schema: 1, id, kind: 'notice', correlationId: id, from: { kind: 'agent', agentId: 'claude-code:s1' }, to: { kind: 'user' },
    createdAt: NOW, context: { project: null, taskId: null, cwd: null },
    body: { expiresAt: NOW + 60_000, title: 'Build done', text: 'All green.', level: 'info' }, ...patch };
}
```

- [ ] **Step 3: Write the failing tests**

`test/interaction-message.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateMessage, checkAnswer, MESSAGE_KINDS, CLASSES, ITEM_TYPES, SURFACES, WITHDRAWAL_REASONS } from '../src/interaction/message.js';
import { questionMessage, answerMessage, deferMessage, withdrawalMessage, noticeMessage, uuid } from './helpers/interaction.js';

const invalid = (value) => assert.throws(() => validateMessage(value), { code: 'INVALID_MESSAGE' });
const badAnswer = (q, body) => assert.throws(() => checkAnswer(q.body, body), { code: 'INVALID_ANSWER' });

test('every kind round-trips to an equal normalized object', () => {
  const q = questionMessage();
  for (const m of [q, answerMessage(q), deferMessage(q), withdrawalMessage(q), noticeMessage()]) assert.deepEqual(validateMessage(m), m);
});
test('unknown optional fields are dropped, unknown schema and kind rejected', () => {
  const q = questionMessage();
  assert.equal(Object.hasOwn(validateMessage({ ...q, extra: 1 }), 'extra'), false);
  invalid({ ...q, schema: 2 }); invalid({ ...q, kind: 'verdict' }); invalid(null); invalid([]);
});
test('question and notice correlate to themselves', () => {
  invalid({ ...questionMessage(), correlationId: uuid() });
  invalid({ ...noticeMessage(), correlationId: uuid() });
});
test('ids, parties and context are checked', () => {
  invalid({ ...questionMessage(), id: 'not-a-uuid' });
  invalid({ ...questionMessage(), from: { kind: 'agent', agentId: 'vim:1' } });
  invalid({ ...questionMessage(), to: { kind: 'robot' } });
  invalid({ ...questionMessage(), context: { project: null, taskId: 'relay-zz', cwd: null } });
  assert.equal(validateMessage(questionMessage({ context: { project: 'p', taskId: 'relay-f58531', cwd: null } })).context.taskId, 'relay-f58531');
});
test('items: 1 to 4, unique ids, option counts by type, limits', () => {
  const item = questionMessage().body.items[0];
  const withItems = (items) => questionMessage({ body: { items } });
  invalid(withItems([])); invalid(withItems([item, item]));
  invalid(withItems([1, 2, 3, 4, 5].map((n) => ({ ...item, id: `q${n}` }))));
  invalid(withItems([{ ...item, options: [item.options[0]] }]));
  invalid(withItems([{ ...item, options: [item.options[0], item.options[0]] }]));
  invalid(withItems([{ ...item, header: 'x'.repeat(17) }]));
  invalid(withItems([{ ...item, prompt: 'x'.repeat(1001) }]));
  invalid(withItems([{ ...item, recommended: 'o9' }]));
  invalid(withItems([{ ...item, type: 'text', options: [], allowOther: true }]));
  invalid(withItems([{ ...item, type: 'boolean', options: [], allowOther: false, maxLength: 5 }]));
  invalid(withItems([{ ...item, maxLength: 10 }]));
  assert.ok(validateMessage(withItems([{ ...item, type: 'text', options: [], allowOther: false, maxLength: 200 }])));
  assert.ok(validateMessage(withItems([{ ...item, recommended: 'o2' }])));
});
test('question native, artifact, supersedes and expiry', () => {
  invalid(questionMessage({ body: { native: { harness: 'vim', sessionId: 's', callId: 'c' } } }));
  invalid(questionMessage({ body: { artifact: { ref: 'x' } } }));
  invalid(questionMessage({ body: { supersedes: 'x' } }));
  invalid(questionMessage({ body: { expiresAt: -1 } }));
  invalid(questionMessage({ body: { class: 'verdict' } }));
});
test('answer bodies', () => {
  const q = questionMessage();
  invalid(answerMessage(q, { answerId: 'x' })); invalid(answerMessage(q, { surface: 'watch' }));
  invalid(answerMessage(q, { values: { q1: { type: 'choice', optionIds: [] } } }));
  invalid(answerMessage(q, { values: { q1: { type: 'other', text: '' } } }));
  invalid({ ...withdrawalMessage(q), body: { reason: 'bored' } });
});
test('checkAnswer fits values to items', () => {
  const q = questionMessage(), body = (patch) => answerMessage(q, patch).body;
  checkAnswer(q.body, body());
  checkAnswer(q.body, body({ outcome: 'declined', values: {} }));
  badAnswer(q, body({ outcome: 'declined' }));
  badAnswer(q, body({ values: {} }));
  badAnswer(q, body({ values: { q1: { type: 'choice', optionIds: ['o1', 'o2'] } } }));
  badAnswer(q, body({ values: { q1: { type: 'choice', optionIds: ['o9'] } } }));
  badAnswer(q, body({ values: { q1: { type: 'text', text: 'hi' } } }));
  badAnswer(q, body({ values: { q1: { type: 'choice', optionIds: ['o1'] }, q2: { type: 'boolean', value: true } } }));
  checkAnswer(q.body, body({ values: { q1: { type: 'other', text: 'Hexagon' } } }));
  const closed = questionMessage({ body: { items: [{ ...q.body.items[0], allowOther: false }] } });
  badAnswer(closed, answerMessage(closed, { values: { q1: { type: 'other', text: 'x' } } }).body);
  const multi = questionMessage({ body: { items: [{ ...q.body.items[0], type: 'multi' }] } });
  checkAnswer(multi.body, answerMessage(multi, { values: { q1: { type: 'choice', optionIds: ['o1', 'o2'] } } }).body);
  const text = questionMessage({ body: { items: [{ ...q.body.items[0], type: 'text', options: [], allowOther: false, maxLength: 3 }] } });
  badAnswer(text, answerMessage(text, { values: { q1: { type: 'text', text: 'four' } } }).body);
  const bool = questionMessage({ body: { items: [{ ...q.body.items[0], type: 'boolean', options: [], allowOther: false }] } });
  checkAnswer(bool.body, answerMessage(bool, { values: { q1: { type: 'boolean', value: false } } }).body);
});
test('artifactRevision is present exactly when the question has an artifact', () => {
  const plain = questionMessage(), reviewed = questionMessage({ body: { class: 'artifact-review', artifact: { ref: 'docs/x.md', revision: 'abc' } } });
  badAnswer(plain, answerMessage(plain, { artifactRevision: 'abc' }).body);
  badAnswer(reviewed, answerMessage(reviewed).body);
  checkAnswer(reviewed.body, answerMessage(reviewed, { artifactRevision: 'other' }).body); // a mismatch is STALE, judged by the lifecycle
});
test('the committed JSON Schema agrees with the validator vocabularies', () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/interaction/message.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.properties.kind.enum, MESSAGE_KINDS);
  assert.deepEqual(schema.$defs.question.properties.class.enum, CLASSES);
  assert.deepEqual(schema.$defs.item.properties.type.enum, ITEM_TYPES);
  assert.deepEqual(schema.$defs.surface.enum, SURFACES);
  assert.deepEqual(schema.$defs.withdrawal.properties.reason.enum, WITHDRAWAL_REASONS);
});
```

- [ ] **Step 4: Run it and see it fail**

Run: `just test-one test/interaction-message.test.js`
Expected: FAIL, `Cannot find module '../src/interaction/message.js'`.

- [ ] **Step 5: Write the schema file**

`schemas/interaction/message.schema.json` holds the JSON of spec Appendix A, copied
verbatim. It is pretty-printed with two spaces, and the `withdrawal` reasons include
`"user"`.

- [ ] **Step 6: Write the validator**

`src/interaction/message.js`:

```js
import { relayError } from '../protocol.js';
// Typed interaction messages (spec §4, Appendix A). The JSON Schema in
// schemas/interaction/message.schema.json is the published contract; this module enforces it
// plus the cross-field rules the schema cannot express.
export const MESSAGE_KINDS = Object.freeze(['question', 'answer', 'defer', 'withdrawal', 'notice']);
export const CLASSES = Object.freeze(['clarification', 'artifact-review', 'authorization']);
export const ITEM_TYPES = Object.freeze(['boolean', 'single', 'multi', 'text']);
export const SURFACES = Object.freeze(['phone', 'desktop', 'cli', 'terminal']);
export const LOCAL_SURFACES = Object.freeze(['desktop', 'cli', 'terminal']);
export const WITHDRAWAL_REASONS = Object.freeze(['asker', 'user', 'asker-gone', 'superseded', 'answered-elsewhere']);
const HARNESSES = ['claude-code', 'codex', 'opencode'];
const fail = (message) => { throw relayError('INVALID_MESSAGE', message); };
const bad = (message) => { throw relayError('INVALID_ANSWER', message); };
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const uuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const ms = (v) => Number.isSafeInteger(v) && v >= 0;
const str = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max;
const orNull = (v, check) => v === null || check(v);
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const isId = (v) => typeof v === 'string' && ID.test(v);
const unique = (ids, what) => { if (new Set(ids).size !== ids.length) fail(`duplicate ${what} id`); };

function party(v) {
  if (object(v) && v.kind === 'user') return { kind: 'user' };
  if (object(v) && v.kind === 'agent' && typeof v.agentId === 'string' && /^(claude-code|codex|opencode):.+$/.test(v.agentId)) return { kind: 'agent', agentId: v.agentId };
  return fail('invalid party');
}
function context(v) {
  if (!object(v) || !orNull(v.project, (x) => str(x, 1, 4096)) || !orNull(v.cwd, (x) => str(x, 1, 4096))
    || !orNull(v.taskId, (x) => typeof x === 'string' && /^[a-z0-9-]+-[0-9a-f]{6}$/.test(x))) fail('invalid context');
  return { project: v.project, taskId: v.taskId, cwd: v.cwd };
}
function option(v) {
  if (!object(v) || !isId(v.id) || !str(v.label, 1, 80) || !orNull(v.description, (x) => str(x, 0, 400))) fail('invalid option');
  return { id: v.id, label: v.label, description: v.description };
}
function item(v) {
  if (!object(v) || !isId(v.id) || !str(v.header, 1, 16) || !str(v.prompt, 1, 1000) || !ITEM_TYPES.includes(v.type)
    || !Array.isArray(v.options) || typeof v.allowOther !== 'boolean') fail('invalid item');
  const options = v.options.map(option);
  unique(options.map((o) => o.id), 'option');
  const choice = v.type === 'single' || v.type === 'multi';
  if (choice ? options.length < 2 || options.length > 4 : options.length !== 0) fail('invalid item options');
  if (!choice && (v.recommended !== null || v.allowOther)) fail('recommended and allowOther need options');
  if (v.recommended !== null && !options.some((o) => o.id === v.recommended)) fail('recommended is not an option');
  const length = Number.isInteger(v.maxLength) && v.maxLength >= 1 && v.maxLength <= 2000;
  if (v.type === 'text' ? !(v.maxLength === null || length) : v.maxLength !== null) fail('invalid maxLength');
  return { id: v.id, header: v.header, prompt: v.prompt, type: v.type, options, recommended: v.recommended, allowOther: v.allowOther, maxLength: v.maxLength };
}
function question(v) {
  if (!object(v) || !CLASSES.includes(v.class) || !ms(v.expiresAt) || !Array.isArray(v.items) || v.items.length < 1 || v.items.length > 4) fail('invalid question');
  let native = null, artifact = null;
  if (v.native !== null) {
    if (!object(v.native) || !HARNESSES.includes(v.native.harness) || !str(v.native.sessionId, 1, 4096) || !str(v.native.callId, 1, 4096)) fail('invalid native call');
    native = { harness: v.native.harness, sessionId: v.native.sessionId, callId: v.native.callId };
  }
  if (v.artifact !== null) {
    if (!object(v.artifact) || !str(v.artifact.ref, 1, 4096) || !str(v.artifact.revision, 1, 256)) fail('invalid artifact');
    artifact = { ref: v.artifact.ref, revision: v.artifact.revision };
  }
  if (!orNull(v.supersedes, uuid)) fail('invalid supersedes');
  const items = v.items.map(item);
  unique(items.map((i) => i.id), 'item');
  return { class: v.class, expiresAt: v.expiresAt, native, artifact, supersedes: v.supersedes, items };
}
function value(v) {
  if (!object(v)) fail('invalid value');
  if (v.type === 'boolean' && typeof v.value === 'boolean') return { type: 'boolean', value: v.value };
  if (v.type === 'choice' && Array.isArray(v.optionIds) && v.optionIds.length >= 1 && v.optionIds.length <= 4 && v.optionIds.every(isId)) {
    if (new Set(v.optionIds).size !== v.optionIds.length) fail('duplicate option in value');
    return { type: 'choice', optionIds: [...v.optionIds] };
  }
  if (v.type === 'other' && str(v.text, 1, 2000)) return { type: 'other', text: v.text };
  if (v.type === 'text' && str(v.text, 0, 2000)) return { type: 'text', text: v.text };
  return fail('invalid value');
}
const surface = (v) => SURFACES.includes(v) ? v : fail('invalid surface');
function answer(v) {
  if (!object(v) || !uuid(v.answerId) || !['answered', 'declined'].includes(v.outcome) || !orNull(v.artifactRevision, (x) => str(x, 1, 256)) || !object(v.values)) fail('invalid answer');
  return { answerId: v.answerId, surface: surface(v.surface), outcome: v.outcome, artifactRevision: v.artifactRevision,
    values: Object.fromEntries(Object.entries(v.values).map(([k, x]) => [isId(k) ? k : fail('invalid item id'), value(x)])) };
}
function notice(v) {
  if (!object(v) || !ms(v.expiresAt) || !str(v.title, 1, 80) || !str(v.text, 0, 2000) || !['info', 'warn'].includes(v.level)) fail('invalid notice');
  return { expiresAt: v.expiresAt, title: v.title, text: v.text, level: v.level };
}
const BODY = {
  question, answer, notice,
  defer: (v) => object(v) ? { surface: surface(v.surface) } : fail('invalid defer'),
  withdrawal: (v) => object(v) && WITHDRAWAL_REASONS.includes(v.reason) ? { reason: v.reason } : fail('invalid withdrawal'),
};
export function validateMessage(v) {
  if (!object(v) || v.schema !== 1 || !MESSAGE_KINDS.includes(v.kind) || !uuid(v.id) || !uuid(v.correlationId) || !ms(v.createdAt)) fail('invalid message envelope');
  if ((v.kind === 'question' || v.kind === 'notice') && v.correlationId !== v.id) fail('a question or notice correlates to itself');
  return { schema: 1, id: v.id, kind: v.kind, correlationId: v.correlationId, from: party(v.from), to: party(v.to),
    createdAt: v.createdAt, context: context(v.context), body: BODY[v.kind](v.body) };
}
// The cross-field rules for an answer against its question (spec Appendix A, last list). The
// revision is checked for presence here; a mismatch is the lifecycle's STALE.
export function checkAnswer(q, a) {
  if ((q.artifact === null) !== (a.artifactRevision === null)) bad('artifactRevision must be present exactly when the question has an artifact');
  const keys = Object.keys(a.values);
  if (a.outcome === 'declined') { if (keys.length) bad('a declined answer carries no values'); return; }
  if (keys.length !== q.items.length || !q.items.every((i) => Object.hasOwn(a.values, i.id))) bad('an answer has one value per item');
  for (const item of q.items) {
    const v = a.values[item.id];
    if (item.type === 'boolean') { if (v.type !== 'boolean') bad(`${item.id} takes a boolean`); continue; }
    if (item.type === 'text') { if (v.type !== 'text' || v.text.length > (item.maxLength ?? 2000)) bad(`${item.id} takes text within its limit`); continue; }
    if (v.type === 'other') { if (!item.allowOther) bad(`${item.id} allows no other`); continue; }
    if (v.type !== 'choice' || (item.type === 'single' && v.optionIds.length !== 1)
      || !v.optionIds.every((id) => item.options.some((o) => o.id === id))) bad(`${item.id} takes options of its own`);
  }
}
```

- [ ] **Step 7: Run it and see it pass**

Run: `just test-one test/interaction-message.test.js`
Expected: PASS, all tests.

- [ ] **Step 8: Commit**

```bash
just test-fast && tasks check
git add justfile schemas/interaction/message.schema.json src/interaction/message.js test/helpers/interaction.js test/interaction-message.test.js
git commit -m "feat(interaction): message schema and validators"
```

---

### Task 3: Lifecycle state machine

**Files:**
- Create: `src/interaction/lifecycle.js`
- Test: `test/interaction-lifecycle.test.js`

**Interfaces:**
- Consumes: `validateMessage` and `checkAnswer` from Task 2. `validateHandle(value)` from
  `src/protocol.js`.
- Produces:
  - **Types.** Every `apply*` returns a `Result = { entry, changed: boolean, error: null | { code, answer?, revision?, message? } }`.
    New log rows carry `seq: null`, which the store fills in.
  - **Constants and checks.** `CONFIRM_WINDOW_MS = 60000`, `ANSWER_HOLDING`,
    `QUESTION_STATES`, `isTerminal(entry)`, `validateEntry(value) -> entry` (throws
    `INVALID_ENTRY`).
  - **Constructors.** `createEntry(question, { handback, waiter, now })` and
    `createNotice(notice, { now })`.
  - **Transitions, one per event.**
    - `applyAnswer(entry, message, now)`
    - `applyDefer(entry, message, now)`
    - `applyWithdraw(entry, reason, now)`
    - `applySuperseded(entry, byId, now)`
    - `applyHanded(entry, waiter, now)`
    - `applyConfirm(entry, { matches, observed }, now)`
    - `applyAskerGone(entry, now)`
    - `applyClock(entry, now)`
    - `applySeen(entry, now)`
  - **Supersession and scheduling.** `checkSupersede(predecessor, replacementMessage) -> null | { code, answer? }`
    and `nextDeadline(entry) -> number | null`.

- [ ] **Step 1: Write the failing tests**

`test/interaction-lifecycle.test.js`. There is one test per row of spec §5.2, plus the
order of checks:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/interaction/lifecycle.js';
import { questionMessage, answerMessage, deferMessage, noticeMessage, HANDLE, OTHER_HANDLE, NOW } from './helpers/interaction.js';

const T = NOW + 5000;
const fresh = (opts = {}) => { const q = questionMessage(opts.question); return { q, e: L.createEntry(q, { handback: opts.handback ?? false, waiter: HANDLE, now: NOW }) }; };
const step = (r) => { assert.equal(r.error, null, JSON.stringify(r.error)); return r.entry; };
const refused = (r, code) => { assert.equal(r.changed, false); assert.equal(r.error?.code, code); return r; };
const answered = () => { const { q, e } = fresh(); const a = answerMessage(q); return { q, a, e: step(L.applyAnswer(e, a, T)) }; };
const handed = () => { const s = answered(); return { ...s, e: step(L.applyHanded(s.e, HANDLE, T)) }; };

test('a new entry is pending in the inbox with one log row', () => {
  const { e } = fresh();
  assert.equal(e.state, 'pending'); assert.equal(e.presentation, 'inbox');
  assert.deepEqual(e.log, [{ seq: null, at: NOW, state: 'pending', cause: 'question' }]);
  assert.deepEqual(L.validateEntry({ ...e, seq: 1, log: [{ ...e.log[0], seq: 1 }] }).id, e.id);
});
test('first answer saves; same answerId replays in every answer-holding state', () => {
  const { a, e } = answered();
  assert.equal(e.state, 'answered'); assert.deepEqual(e.answer, a);
  const h = step(L.applyHanded(e, HANDLE, T));
  const later = { consumed: step(L.applyConfirm(h, { matches: true, observed: {} }, T)), unconfirmed: step(L.applyClock(h, T + L.CONFIRM_WINDOW_MS)),
    undeliverable: step(L.applyAskerGone(e, T)), answered: e, handed: h };
  for (const [state, entry] of Object.entries(later)) {
    assert.equal(entry.state, state);
    const r = L.applyAnswer(entry, a, T + 9); assert.equal(r.error, null); assert.equal(r.changed, false);
  }
});
test('a second answerId gets ALREADY_ANSWERED with the winner', () => {
  const { q, a, e } = answered();
  assert.deepEqual(refused(L.applyAnswer(e, answerMessage(q), T), 'ALREADY_ANSWERED').error.answer, a);
  refused(L.applyAnswer(step(L.applyAskerGone(e, T)), answerMessage(q), T), 'ALREADY_ANSWERED');
});
test('answers to closed entries name the closure', () => {
  const { q, e } = fresh({ handback: true });
  refused(L.applyAnswer(step(L.applyDefer(e, deferMessage(q), T)), answerMessage(q), T), 'RELEASED');
  refused(L.applyAnswer(step(L.applyWithdraw(e, 'user', T)), answerMessage(q), T), 'WITHDRAWN');
  refused(L.applyAnswer(step(L.applyClock(e, q.body.expiresAt)), answerMessage(q), T), 'EXPIRED');
});
test('validation and revision run after the state checks, in that order', () => {
  const { q, e } = fresh({ question: { body: { class: 'artifact-review', artifact: { ref: 'a', revision: 'r1' } } } });
  refused(L.applyAnswer(e, answerMessage(q, { values: {} , artifactRevision: 'r0' }), T), 'INVALID_ANSWER');
  assert.equal(refused(L.applyAnswer(e, answerMessage(q, { artifactRevision: 'r0' }), T), 'STALE').error.revision, 'r1');
  assert.equal(step(L.applyAnswer(e, answerMessage(q, { artifactRevision: 'r1' }), T)).state, 'answered');
});
test('authorization questions take an answer only from a local surface', () => {
  const { q, e } = fresh({ question: { body: { class: 'authorization' } } });
  refused(L.applyAnswer(e, answerMessage(q, { surface: 'phone' }), T), 'LOCAL_ONLY');
  assert.equal(step(L.applyAnswer(e, answerMessage(q, { surface: 'phone', outcome: 'declined', values: {} }), T)).state, 'answered');
  assert.equal(step(L.applyAnswer(e, answerMessage(q, { surface: 'desktop' }), T)).state, 'answered');
});
test('defer: release with handback, desktop presentation without', () => {
  const back = fresh({ handback: true }), stay = fresh();
  assert.equal(step(L.applyDefer(back.e, deferMessage(back.q), T)).state, 'released');
  const d = step(L.applyDefer(stay.e, deferMessage(stay.q), T));
  assert.deepEqual([d.state, d.presentation], ['pending', 'desktop']);
  assert.equal(L.applyDefer(d, deferMessage(stay.q), T).changed, false);
  const { q, e } = answered();
  refused(L.applyDefer(e, deferMessage(q), T), 'ALREADY_ANSWERED');
});
test('withdrawal: pending withdraws, answered returns ANSWERED with the answer', () => {
  const { e } = fresh();
  const w = step(L.applyWithdraw(e, 'user', T));
  assert.deepEqual([w.state, w.withdrawal], ['withdrawn', { reason: 'user' }]);
  const s = answered();
  assert.deepEqual(refused(L.applyWithdraw(s.e, 'user', T), 'ANSWERED').error.answer, s.a);
});
test('handed: only the recorded waiter, idempotent, refused before an answer', () => {
  const { e } = fresh();
  refused(L.applyHanded(e, HANDLE, T), 'NOT_ANSWERED');
  const s = answered();
  refused(L.applyHanded(s.e, OTHER_HANDLE, T), 'NOT_WAITER');
  const h = step(L.applyHanded(s.e, HANDLE, T));
  assert.deepEqual([h.state, h.handedAt], ['handed', T]);
  assert.equal(L.applyHanded(h, HANDLE, T + 1).changed, false);
  const u = step(L.applyClock(h, T + L.CONFIRM_WINDOW_MS));
  assert.equal(u.state, 'unconfirmed');
  const again = L.applyHanded(u, HANDLE, T + L.CONFIRM_WINDOW_MS + 1);
  assert.deepEqual([again.changed, again.error], [false, null]);
  refused(L.applyHanded(u, OTHER_HANDLE, T), 'NOT_WAITER');
});
test('confirmation: match consumes, mismatch is unconfirmed, late match still consumes', () => {
  const { e } = handed();
  assert.equal(step(L.applyConfirm(e, { matches: true, observed: { a: 1 } }, T)).state, 'consumed');
  const m = step(L.applyConfirm(e, { matches: false, observed: { a: 2 } }, T));
  assert.deepEqual([m.state, m.observed], ['unconfirmed', { a: 2 }]);
  const late = step(L.applyClock(e, T + L.CONFIRM_WINDOW_MS));
  assert.equal(step(L.applyConfirm(late, { matches: true, observed: {} }, T + 70000)).state, 'consumed');
  refused(L.applyConfirm(answered().e, { matches: true, observed: {} }, T), 'NOT_HANDED');
});
test('a native answer after release or expiry is history only', () => {
  const { q, e } = fresh({ handback: true });
  const r = step(L.applyDefer(e, deferMessage(q), T));
  const c = step(L.applyConfirm(r, { matches: false, observed: { 'Which shape?': 'Circle' } }, T + 1));
  assert.deepEqual([c.state, c.observed], ['released', { 'Which shape?': 'Circle' }]);
});
test('asker gone: pending withdraws, answered is undeliverable, later states keep', () => {
  const p = step(L.applyAskerGone(fresh().e, T));
  assert.deepEqual([p.state, p.withdrawal], ['withdrawn', { reason: 'asker-gone' }]);
  assert.equal(step(L.applyAskerGone(answered().e, T)).state, 'undeliverable');
  assert.equal(L.applyAskerGone(handed().e, T).changed, false);
});
test('supersession checks the asker, the state, and reports an answer', () => {
  const { q, e } = fresh();
  const next = questionMessage({ body: { supersedes: q.id } });
  assert.equal(L.checkSupersede(e, next), null);
  assert.deepEqual(L.checkSupersede(null, next), { code: 'NOT_SUPERSEDABLE' });
  assert.deepEqual(L.checkSupersede(e, { ...next, from: { kind: 'agent', agentId: 'codex:x' } }), { code: 'NOT_SUPERSEDABLE' });
  const s = answered();
  assert.equal(L.checkSupersede(s.e, next).code, 'ANSWERED');
  const w = step(L.applySuperseded(e, next.id, T));
  assert.deepEqual([w.state, w.withdrawal, w.supersededBy], ['withdrawn', { reason: 'superseded' }, next.id]);
});
test('clock: expiry, window, deadlines, notices', () => {
  const { q, e } = fresh();
  assert.equal(L.applyClock(e, q.body.expiresAt - 1).changed, false);
  assert.equal(L.nextDeadline(e), q.body.expiresAt);
  assert.equal(L.nextDeadline(handed().e), T + L.CONFIRM_WINDOW_MS);
  assert.equal(L.nextDeadline(answered().e), null);
  const n = L.createNotice(noticeMessage(), { now: NOW });
  assert.equal(n.state, 'active'); assert.equal(L.isTerminal(n), false);
  const x = step(L.applyClock(n, n.notice.body.expiresAt));
  assert.equal(x.state, 'expired'); assert.equal(L.isTerminal(x), true);
  assert.equal(step(L.applySeen(n, T)).seen, true);
});
test('validateEntry rejects inconsistent entries', () => {
  const { e } = answered();
  const stamped = { ...e, seq: 2, log: e.log.map((l, i) => ({ ...l, seq: i + 1 })) };
  assert.equal(L.validateEntry(stamped).state, 'answered');
  for (const broken of [{ ...stamped, state: 'lost' }, { ...stamped, answer: null }, { ...stamped, seq: 0 }, { ...stamped, schema: 2 }, { ...stamped, id: 'x' }]) {
    assert.throws(() => L.validateEntry(broken), { code: 'INVALID_ENTRY' });
  }
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `just test-one test/interaction-lifecycle.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the lifecycle**

`src/interaction/lifecycle.js`:

```js
import { isDeepStrictEqual } from 'node:util';
import { relayError, validateHandle } from '../protocol.js';
import { checkAnswer, validateMessage, LOCAL_SURFACES } from './message.js';
// The question lifecycle as pure functions (spec §5). Each returns { entry, changed, error };
// new log rows carry seq: null, which the store stamps when it persists the entry.
export const CONFIRM_WINDOW_MS = 60000;
export const QUESTION_STATES = Object.freeze(['pending', 'answered', 'handed', 'consumed', 'unconfirmed', 'undeliverable', 'released', 'withdrawn', 'expired']);
export const ANSWER_HOLDING = Object.freeze(['answered', 'handed', 'consumed', 'unconfirmed', 'undeliverable']);
const TERMINAL = ['consumed', 'unconfirmed', 'undeliverable', 'released', 'withdrawn', 'expired'];
const CLOSED = { withdrawn: 'WITHDRAWN', expired: 'EXPIRED', released: 'RELEASED', undeliverable: 'UNDELIVERABLE' };
export const isTerminal = (entry) => entry.kind === 'notice' ? entry.state === 'expired' : TERMINAL.includes(entry.state);

const keep = (entry) => ({ entry, changed: false, error: null });
const refuse = (entry, code, extra = {}) => ({ entry, changed: false, error: { code, ...extra } });
const row = (entry, now, state, cause) => [...entry.log, { seq: null, at: now, state, cause }];
const move = (entry, now, state, cause, patch = {}) => ({ entry: { ...entry, ...patch, state, updatedAt: now, log: row(entry, now, state, cause) }, changed: true, error: null });
const annotate = (entry, now, cause, patch) => ({ entry: { ...entry, ...patch, updatedAt: now, log: row(entry, now, entry.state, cause) }, changed: true, error: null });
const sameHandle = (a, b) => a !== null && b !== null && isDeepStrictEqual(a, b);
const sameParty = (a, b) => isDeepStrictEqual(a, b);

export function createEntry(question, { handback, waiter, now }) {
  return { schema: 1, id: question.id, kind: 'question', question, state: 'pending', presentation: 'inbox',
    route: { handback, waiter }, answer: null, handedAt: null, observed: null, withdrawal: null, supersededBy: null,
    seq: null, updatedAt: now, log: [{ seq: null, at: now, state: 'pending', cause: 'question' }] };
}
export function createNotice(notice, { now }) {
  return { schema: 1, id: notice.id, kind: 'notice', notice, state: 'active', seen: false,
    seq: null, updatedAt: now, log: [{ seq: null, at: now, state: 'active', cause: 'notice' }] };
}
export function applyAnswer(entry, message, now) {
  const body = message.body, q = entry.question.body;
  if (entry.answer !== null && entry.answer.body.answerId === body.answerId) return keep(entry);
  if (ANSWER_HOLDING.includes(entry.state)) return refuse(entry, 'ALREADY_ANSWERED', { answer: entry.answer });
  if (entry.state !== 'pending') return refuse(entry, CLOSED[entry.state]);
  try { checkAnswer(q, body); } catch (error) { return refuse(entry, 'INVALID_ANSWER', { message: error.message }); }
  if (q.class === 'authorization' && body.outcome === 'answered' && !LOCAL_SURFACES.includes(body.surface)) return refuse(entry, 'LOCAL_ONLY');
  if (q.artifact !== null && body.artifactRevision !== q.artifact.revision) return refuse(entry, 'STALE', { revision: q.artifact.revision });
  return move(entry, now, 'answered', 'answer', { answer: message });
}
export function applyDefer(entry, message, now) {
  if (ANSWER_HOLDING.includes(entry.state)) return refuse(entry, 'ALREADY_ANSWERED', { answer: entry.answer });
  if (entry.state !== 'pending') return refuse(entry, CLOSED[entry.state]);
  if (entry.route.handback) return move(entry, now, 'released', `defer:${message.body.surface}`);
  if (entry.presentation === 'desktop') return keep(entry);
  return annotate(entry, now, `defer:${message.body.surface}`, { presentation: 'desktop' });
}
export function applyWithdraw(entry, reason, now) {
  if (ANSWER_HOLDING.includes(entry.state)) return refuse(entry, 'ANSWERED', { answer: entry.answer });
  if (entry.state !== 'pending') return refuse(entry, CLOSED[entry.state]);
  return move(entry, now, 'withdrawn', `withdrawal:${reason}`, { withdrawal: { reason } });
}
export const applySuperseded = (entry, byId, now) => move(entry, now, 'withdrawn', 'withdrawal:superseded', { withdrawal: { reason: 'superseded' }, supersededBy: byId });
export function checkSupersede(predecessor, replacement) {
  if (!predecessor || predecessor.kind !== 'question') return { code: 'NOT_SUPERSEDABLE' };
  if (ANSWER_HOLDING.includes(predecessor.state)) return { code: 'ANSWERED', answer: predecessor.answer };
  if (predecessor.state !== 'pending' || !sameParty(predecessor.question.from, replacement.from)) return { code: 'NOT_SUPERSEDABLE' };
  return null;
}
export function applyHanded(entry, waiter, now) {
  if (!sameHandle(entry.route.waiter, waiter)) return refuse(entry, 'NOT_WAITER');
  if (['handed', 'unconfirmed', 'consumed'].includes(entry.state)) return keep(entry);
  if (entry.state === 'pending') return refuse(entry, 'NOT_ANSWERED');
  if (entry.state !== 'answered') return refuse(entry, CLOSED[entry.state]);
  return move(entry, now, 'handed', 'handed', { handedAt: now });
}
export function applyConfirm(entry, { matches, observed }, now) {
  if (entry.state === 'handed' || entry.state === 'unconfirmed') {
    if (matches) return move(entry, now, 'consumed', 'confirm', { observed });
    if (entry.state === 'unconfirmed' && isDeepStrictEqual(entry.observed, observed)) return keep(entry);
    return move(entry, now, 'unconfirmed', 'confirm-mismatch', { observed });
  }
  if (entry.state === 'released' || entry.state === 'expired') return annotate(entry, now, 'native-answer', { observed });
  return refuse(entry, 'NOT_HANDED');
}
export function applyAskerGone(entry, now) {
  if (entry.state === 'pending') return move(entry, now, 'withdrawn', 'withdrawal:asker-gone', { withdrawal: { reason: 'asker-gone' } });
  if (entry.state === 'answered') return move(entry, now, 'undeliverable', 'asker-gone');
  return keep(entry);
}
export function applyClock(entry, now) {
  if (entry.kind === 'notice') return entry.state === 'active' && now >= entry.notice.body.expiresAt ? move(entry, now, 'expired', 'expiry') : keep(entry);
  if (entry.state === 'pending' && now >= entry.question.body.expiresAt) return move(entry, now, 'expired', 'expiry');
  if (entry.state === 'handed' && now >= entry.handedAt + CONFIRM_WINDOW_MS) return move(entry, now, 'unconfirmed', 'window');
  return keep(entry);
}
export const applySeen = (entry, now) => entry.kind === 'notice' && !entry.seen ? annotate(entry, now, 'seen', { seen: true }) : keep(entry);
export function nextDeadline(entry) {
  if (entry.kind === 'notice') return entry.state === 'active' ? entry.notice.body.expiresAt : null;
  if (entry.state === 'pending') return entry.question.body.expiresAt;
  if (entry.state === 'handed') return entry.handedAt + CONFIRM_WINDOW_MS;
  return null;
}
const fail = (message) => { throw relayError('INVALID_ENTRY', message); };
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const seqOk = (v) => Number.isSafeInteger(v) && v >= 1;
export function validateEntry(v) {
  if (!object(v) || v.schema !== 1 || !seqOk(v.seq) || !Number.isSafeInteger(v.updatedAt) || !Array.isArray(v.log) || v.log.length === 0
    || !v.log.every((l) => object(l) && seqOk(l.seq) && Number.isSafeInteger(l.at) && typeof l.state === 'string' && typeof l.cause === 'string')) fail('invalid entry frame');
  try {
    if (v.kind === 'notice') {
      if (validateMessage(v.notice).kind !== 'notice' || v.notice.id !== v.id || !['active', 'expired'].includes(v.state) || typeof v.seen !== 'boolean') fail('invalid notice entry');
      return v;
    }
    if (v.kind !== 'question' || validateMessage(v.question).kind !== 'question' || v.question.id !== v.id || !QUESTION_STATES.includes(v.state)) fail('invalid question entry');
    if (!['inbox', 'desktop'].includes(v.presentation) || !object(v.route) || typeof v.route.handback !== 'boolean') fail('invalid route');
    if (v.route.waiter !== null) validateHandle(v.route.waiter);
    if (ANSWER_HOLDING.includes(v.state) !== (v.answer !== null)) fail('answer does not match state');
    if (v.answer !== null && (validateMessage(v.answer).kind !== 'answer' || v.answer.correlationId !== v.id)) fail('invalid answer');
    if (['handed', 'consumed', 'unconfirmed'].includes(v.state) && !Number.isSafeInteger(v.handedAt)) fail('handed entry lacks handedAt');
    return v;
  } catch (error) { if (error.code === 'INVALID_ENTRY') throw error; return fail(error.message); }
}
```

`consumed` and `unconfirmed` reached only through `handed` always carry `handedAt`. A
`released` or `expired` entry that later receives a native answer keeps `handedAt: null`.

- [ ] **Step 4: Run it and see it pass**

Run: `just test-one test/interaction-lifecycle.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
just test-fast && tasks check
git add src/interaction/lifecycle.js test/interaction-lifecycle.test.js
git commit -m "feat(interaction): question lifecycle state machine"
```

---

### Task 4: Durable inbox store

**Files:**
- Create: `src/interaction/store.js`
- Test: `test/interaction-store.test.js`

**Interfaces:**
- Consumes: from Task 3, `validateEntry`, `isTerminal`, `applySuperseded` and
  `ANSWER_HOLDING`. From `src/bus/store.js`, `ensurePrivateDir` and `checkPrivate`.
- Produces:
  - `RETENTION_MS` and `inboxPaths(stateDir) -> { root, seqPath, entriesDir, rejectedDir }`.
  - `writeDurable(path, text, { io }) -> Promise<void>`.
  - `loadStore(stateDir, { io, now }) -> Promise<{ store, rejected: Array<{ name, reason }> }>`.
  - The store object:
    - `get(id) -> entry | null`, `all() -> entry[]`, and `seq() -> number`, the highest
      committed sequence number, never one allocated to a write still in flight
    - `put(entry) -> Promise<stamped entry>`
    - `supersede(replacement, withdrawnPredecessor) -> Promise<[n, x]>`
    - `prune(now) -> Promise<string[]>`, which returns the pruned ids.

- [ ] **Step 1: Write the failing tests**

`test/interaction-store.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tempState } from './helpers/fixture.js';
import { loadStore, inboxPaths, RETENTION_MS } from '../src/interaction/store.js';
import * as L from '../src/interaction/lifecycle.js';
import { questionMessage, answerMessage, HANDLE, NOW } from './helpers/interaction.js';

const entry = (q = questionMessage()) => L.createEntry(q, { handback: false, waiter: HANDLE, now: NOW });
// An io wrapper whose rename fails once for a path matching `when`: a crash between two writes.
const crashOn = (when) => { let armed = true; return { ...fs, rename: async (from, to) => { if (armed && when(to)) { armed = false; throw Object.assign(new Error('crash'), { code: 'EIO' }); } return fs.rename(from, to); } }; };

test('put stamps a sequence, persists privately, and reloads', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  const a = await store.put(entry()), b = await store.put(entry());
  assert.deepEqual([a.seq, b.seq, a.log[0].seq], [1, 2, 1]);
  const ip = inboxPaths(p.stateDir);
  assert.equal((await fs.stat(join(ip.entriesDir, `${a.id}.json`))).mode & 0o777, 0o600);
  assert.equal((await fs.readFile(ip.seqPath, 'utf8')).trim(), '2');
  const reloaded = (await loadStore(p.stateDir, { now: NOW })).store;
  assert.deepEqual(reloaded.get(a.id), a); assert.equal(reloaded.seq(), 2);
});
test('a crash between seq and entry never reuses a number', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  const first = await store.put(entry());
  const io = crashOn((to) => to.endsWith('.json'));
  const broken = (await loadStore(p.stateDir, { io, now: NOW })).store;
  await assert.rejects(broken.put(entry()), { code: 'IO_ERROR' });
  const { store: after } = await loadStore(p.stateDir, { now: NOW });
  assert.equal(after.seq(), first.seq + 1);
  assert.equal((await after.put(entry())).seq, first.seq + 2);
});
test('seq() exposes only committed numbers while a write is paused', async (t) => {
  const p = await tempState(t);
  let release, reached;
  const hit = new Promise((r) => { reached = r; }), gate = new Promise((r) => { release = r; });
  const io = { ...fs, rename: async (from, to) => { if (to.endsWith('.json')) { reached(); await gate; } return fs.rename(from, to); } };
  const { store } = await loadStore(p.stateDir, { io, now: NOW });
  const writing = store.put(entry());
  await hit;
  assert.equal(store.seq(), 0);
  release(); const stamped = await writing;
  assert.equal(store.seq(), stamped.seq);
});
test('pruning the highest entry then restarting keeps the counter', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  const e = await store.put(entry());
  const gone = await store.put(L.applyWithdraw(e, 'user', NOW).entry);
  assert.deepEqual(await store.prune(NOW + RETENTION_MS), [e.id]);
  const { store: after } = await loadStore(p.stateDir, { now: NOW });
  assert.equal(after.get(e.id), null);
  assert.equal((await after.put(entry())).seq, gone.seq + 1);
});
test('supersession interrupted between the writes is completed on load', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  const x = await store.put(entry());
  const nq = questionMessage({ body: { supersedes: x.id } }), n = entry(nq);
  const io = crashOn((to) => to.endsWith(`${x.id}.json`));
  const broken = (await loadStore(p.stateDir, { io, now: NOW })).store;
  await assert.rejects(broken.supersede(n, L.applySuperseded(broken.get(x.id), n.id, NOW).entry), { code: 'IO_ERROR' });
  const { store: after, rejected } = await loadStore(p.stateDir, { now: NOW + 1 });
  assert.deepEqual(rejected, []);
  assert.deepEqual([after.get(x.id).state, after.get(x.id).supersededBy], ['withdrawn', n.id]);
  assert.equal(after.get(n.id).state, 'pending');
});
test('a replacement whose predecessor is missing or unreachable is quarantined', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  const orphan = await store.put(entry(questionMessage({ body: { supersedes: '00000000-0000-4000-8000-000000000000' } })));
  const { store: after, rejected } = await loadStore(p.stateDir, { now: NOW });
  assert.equal(after.get(orphan.id), null);
  assert.equal(rejected[0].name, `${orphan.id}.json`);
  await fs.access(join(inboxPaths(p.stateDir).rejectedDir, `${orphan.id}.json`));
});
test('pruning keeps a predecessor while its replacement is non-terminal', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  const x = await store.put(entry());
  const nq = questionMessage({ body: { supersedes: x.id } });
  const [n] = await store.supersede(entry(nq), L.applySuperseded(x, nq.id, NOW).entry);
  const answered = await store.put(L.applyAnswer(n, answerMessage(nq), NOW).entry);
  assert.deepEqual(await store.prune(NOW + RETENTION_MS + 1), []);
  const { store: reloaded, rejected } = await loadStore(p.stateDir, { now: NOW + RETENTION_MS + 2 });
  assert.deepEqual(rejected, []); assert.ok(reloaded.get(x.id));
  const done = await reloaded.put(L.applyAskerGone(answered, NOW + RETENTION_MS + 3).entry);
  assert.deepEqual((await reloaded.prune(done.updatedAt + RETENTION_MS)).sort(), [n.id, x.id].sort());
});
test('invalid and stray files are quarantined, temporary files removed', async (t) => {
  const p = await tempState(t), ip = inboxPaths(p.stateDir);
  await loadStore(p.stateDir, { now: NOW });
  await fs.writeFile(join(ip.entriesDir, 'junk.json'), '{', { mode: 0o600 });
  await fs.writeFile(join(ip.entriesDir, 'x.json.tmp.1.abc'), '{}', { mode: 0o600 });
  const { rejected } = await loadStore(p.stateDir, { now: NOW });
  assert.deepEqual(rejected.map((r) => r.name), ['junk.json']);
  assert.deepEqual(await fs.readdir(ip.entriesDir), []);
});
test('a corrupt seq file is an error, not a reset', async (t) => {
  const p = await tempState(t);
  await loadStore(p.stateDir, { now: NOW });
  await fs.writeFile(inboxPaths(p.stateDir).seqPath, 'seven\n', { mode: 0o600 });
  await assert.rejects(loadStore(p.stateDir, { now: NOW }), { code: 'CORRUPT_STATE' });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `just test-one test/interaction-store.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the store**

`src/interaction/store.js`:

```js
import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { relayError } from '../protocol.js';
import { ensurePrivateDir, checkPrivate } from '../bus/store.js';
import { validateEntry, isTerminal, applySuperseded } from './lifecycle.js';
// The inbox's durable store (spec §6). relay serve is its only writer. Each change allocates a
// sequence number, writes seq, then the entry; both writes are fsynced files renamed into place
// followed by a directory fsync.
export const RETENTION_MS = 30 * 24 * 3600 * 1000;
export function inboxPaths(stateDir) {
  const root = join(stateDir, 'inbox');
  return { root, seqPath: join(root, 'seq'), entriesDir: join(root, 'entries'), rejectedDir: join(root, 'rejected') };
}
async function syncDir(path, io) { const dir = await io.open(path, 'r'); try { await dir.sync(); } finally { await dir.close(); } }
export async function writeDurable(path, text, { io = fs } = {}) {
  await checkPrivate(path, false, { io });
  const temp = `${path}.tmp.${process.pid}.${randomUUID()}`;
  let error;
  try {
    const handle = await io.open(temp, 'wx', 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    await io.rename(temp, path);
    await syncDir(dirname(path), io);
    return;
  } catch (cause) { error = relayError('IO_ERROR', 'cannot publish inbox file', cause); }
  try { await io.unlink(temp); }
  catch (cause) { if (cause.code !== 'ENOENT') throw new AggregateError([error, relayError('IO_ERROR', 'cannot clean temporary inbox file', cause)], 'inbox write and cleanup failed'); }
  throw error;
}
async function readSeq(path, io) {
  let text;
  try { if (!await checkPrivate(path, false, { io })) return 0; text = await io.readFile(path, 'utf8'); }
  catch (cause) { if (cause.code === 'ENOENT') return 0; throw cause; }
  if (!/^(0|[1-9][0-9]{0,15})\n?$/.test(text)) throw relayError('CORRUPT_STATE', 'inbox seq is not a decimal integer');
  return Number(text.trim());
}
export async function loadStore(stateDir, { io = fs, now = Date.now() } = {}) {
  const p = inboxPaths(stateDir);
  for (const dir of [stateDir, p.root, p.entriesDir, p.rejectedDir]) await ensurePrivateDir(dir, { io });
  const persisted = await readSeq(p.seqPath, io);
  const entries = new Map(), rejected = [];
  const quarantine = async (name, reason) => { await io.rename(join(p.entriesDir, name), join(p.rejectedDir, name)); await syncDir(p.entriesDir, io); rejected.push({ name, reason }); };
  for (const name of (await io.readdir(p.entriesDir)).sort()) {
    if (name.includes('.tmp.')) { await io.unlink(join(p.entriesDir, name)); continue; }
    let entry;
    try {
      if (!await checkPrivate(join(p.entriesDir, name), false, { io })) continue;
      entry = validateEntry(JSON.parse(await io.readFile(join(p.entriesDir, name), 'utf8')));
      if (`${entry.id}.json` !== name) throw relayError('INVALID_ENTRY', 'entry id does not match its file');
    } catch (error) { if (error.code === 'IO_ERROR') throw error; await quarantine(name, error.message); continue; }
    entries.set(entry.id, entry);
  }
  const store = makeStore(p, entries, Math.max(persisted, 0, ...[...entries.values()].map((e) => e.seq)), io);
  // Supersession reconciliation (spec §5.5): finish an interrupted replacement before any request.
  for (const n of store.all()) {
    const x = n.kind === 'question' && !isTerminal(n) ? n.question.body.supersedes : null;
    if (x === null) continue;
    const predecessor = store.get(x);
    if (predecessor?.state === 'withdrawn' && predecessor.supersededBy === n.id) continue;
    if (predecessor?.state === 'pending') { await store.put(applySuperseded(predecessor, n.id, now).entry); continue; }
    entries.delete(n.id);
    await quarantine(`${n.id}.json`, predecessor ? `predecessor ${x} is ${predecessor.state}` : `predecessor ${x} is missing`);
  }
  return { store, rejected };
}
function makeStore(p, entries, start, io) {
  // allocated runs ahead of committed while a write is in flight; only committed is ever
  // exposed, so a cursor never names a change that is not yet readable.
  let allocated = start, committed = start;
  async function put(entry) {
    allocated += 1;
    const seq = allocated, stamped = { ...entry, seq, log: entry.log.map((l) => l.seq === null ? { ...l, seq } : l) };
    await writeDurable(p.seqPath, `${seq}\n`, { io });
    await writeDurable(join(p.entriesDir, `${stamped.id}.json`), `${JSON.stringify(stamped)}\n`, { io });
    entries.set(stamped.id, stamped);
    committed = seq;
    return stamped;
  }
  return {
    get: (id) => entries.get(id) ?? null,
    all: () => [...entries.values()].sort((a, b) => a.seq - b.seq),
    seq: () => committed,
    put,
    // Fixed order (spec §5.5): the replacement first, then the predecessor's withdrawal.
    async supersede(replacement, withdrawnPredecessor) { const n = await put(replacement); const x = await put(withdrawnPredecessor); return [n, x]; },
    async prune(now) {
      const kept = new Set([...entries.values()].filter((e) => e.kind === 'question' && !isTerminal(e) && e.question.body.supersedes).map((e) => e.question.body.supersedes));
      const pruned = [];
      for (const e of [...entries.values()]) {
        if (!isTerminal(e) || now - e.updatedAt < RETENTION_MS || kept.has(e.id)) continue;
        await io.unlink(join(p.entriesDir, `${e.id}.json`));
        entries.delete(e.id); pruned.push(e.id);
      }
      if (pruned.length) await syncDir(p.entriesDir, io);
      return pruned;
    },
  };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `just test-one test/interaction-store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
just test-fast && tasks check
git add src/interaction/store.js test/interaction-store.test.js
git commit -m "feat(interaction): durable inbox store with recovery"
```

---

### Task 5: The inbox: serialized operations, supersession, presence, clock

**Files:**
- Create: `src/serve/inbox.js`
- Test: `test/serve-inbox.test.js`

**Interfaces:**
- Consumes: Task 3 lifecycle and Task 4 `loadStore` and `writeDurable`.
- Produces:
  - `openInbox({ stateDir, clock, io, expectAnswers, onCommit }) -> Promise<{ inbox, rejected }>`.
    `expectAnswers(entry) -> object` gives the native answers a confirmation must equal.
    `onCommit(entry)` is called after every persisted change, before listeners; the test
    seam for crash injection.
  - The `inbox` object:
    - **Questions:** `ask(message, { handback, waiter }) -> Promise<Result | { passthrough: true }>`.
    - **Responses:** `answer(id, message)`, `defer(id, message)`, `withdraw(id, reason)`,
      `handed(id, waiter)`.
    - **Route events:** `confirm({ harness, callId, observed })`, `askerGone(id)`,
      `notify(message)`, `seen(id)`. Each returns `Promise<Result>`, where
      `Result = { entry, error }`.
    - **Clock and retention:** `sweep() -> Promise<void>`,
      `nextDeadline() -> number | null`, `prune() -> Promise<string[]>`.
    - **Reads:** `list({ since?, states? }) -> entry[]`, `get(id)` and `seq()`, which are
      unserialized and for internal checks only.
    - **Cursor reads:** `snapshot({ since?, states? }) -> Promise<{ seq, entries }>` and
      `watch(since, fn) -> Promise<{ seq, unsubscribe }>`. Both are queued with the
      writes. Every surface that hands a client a sequence number uses them.
    - **Failure:** `halted: Promise<Error>` resolves with `STORE_FAILED` after a failed
      write. Every later operation rejects with that error.
    - **Diagnostic:** `subscribers() -> number`, the live listener count, for tests.
    - **Presence:** `presence() -> { mode, updatedAt }` and `setPresence(mode) -> Promise<presence>`.
    - **Events:** `subscribe(fn) -> unsubscribe`, where fn receives
      `{ type: 'entry', entry } | { type: 'presence', presence }`.
    - **Shutdown:** `idle() -> Promise<void>` resolves when queued work is done.

- [ ] **Step 1: Write the failing tests**

`test/serve-inbox.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tempState } from './helpers/fixture.js';
import { openInbox } from '../src/serve/inbox.js';
import { CONFIRM_WINDOW_MS } from '../src/interaction/lifecycle.js';
import { questionMessage, answerMessage, deferMessage, noticeMessage, HANDLE, NOW } from './helpers/interaction.js';

async function setup(t, { mode = 'away' } = {}) {
  const p = await tempState(t); let now = NOW;
  const clock = () => now, open = () => openInbox({ stateDir: p.stateDir, clock, expectAnswers: () => ({ 'Which shape?': 'Square' }) });
  const { inbox } = await open();
  if (mode) await inbox.setPresence(mode);
  return { p, inbox, open, advance: (ms) => { now += ms; }, at: () => now };
}
const ask = (inbox, q = questionMessage(), handback = false) => inbox.ask(q, { handback, waiter: HANDLE });

test('presence here passes through and creates nothing; default presence is here', async (t) => {
  const { inbox } = await setup(t, { mode: null });
  assert.equal(inbox.presence().mode, 'here');
  assert.deepEqual(await ask(inbox), { passthrough: true });
  assert.deepEqual(inbox.list(), []);
});
test('ask is idempotent by id and refuses a different body under the same id', async (t) => {
  const { inbox } = await setup(t), q = questionMessage();
  const first = await ask(inbox, q), again = await ask(inbox, q);
  assert.equal(first.entry.seq, again.entry.seq);
  assert.equal((await ask(inbox, { ...q, createdAt: q.createdAt + 1 })).error.code, 'ID_CONFLICT');
});
test('a reattach still finds its entry after presence moves to here', async (t) => {
  const { inbox } = await setup(t), q = questionMessage();
  await ask(inbox, q); await inbox.setPresence('here');
  assert.equal((await ask(inbox, q)).entry.id, q.id);
});
test('expiry applies before an answer that arrives late', async (t) => {
  const { inbox, advance } = await setup(t), q = questionMessage();
  await ask(inbox, q); advance(3_600_000);
  const r = await inbox.answer(q.id, answerMessage(q));
  assert.equal(r.error.code, 'EXPIRED'); assert.equal(inbox.get(q.id).state, 'expired');
});
test('concurrent answers: exactly one wins', async (t) => {
  const { inbox } = await setup(t), q = questionMessage();
  await ask(inbox, q);
  const results = await Promise.all([inbox.answer(q.id, answerMessage(q)), inbox.answer(q.id, answerMessage(q))]);
  assert.deepEqual(results.map((r) => r.error?.code ?? 'ok').sort(), ['ALREADY_ANSWERED', 'ok']);
});
test('supersession withdraws the predecessor and publishes both after both writes', async (t) => {
  const { inbox } = await setup(t), x = questionMessage(); await ask(inbox, x);
  const seen = []; inbox.subscribe((e) => seen.push(e.entry.id));
  const n = questionMessage({ body: { supersedes: x.id } });
  const r = await ask(inbox, n);
  assert.equal(r.entry.state, 'pending');
  assert.deepEqual([inbox.get(x.id).state, inbox.get(x.id).supersededBy], ['withdrawn', n.id]);
  assert.deepEqual(seen, [n.id, x.id]);
  assert.equal((await inbox.answer(x.id, answerMessage(x))).error.code, 'WITHDRAWN');
});
test('supersession is refused for an answered predecessor or another asker', async (t) => {
  const { inbox } = await setup(t), x = questionMessage(); await ask(inbox, x);
  await inbox.answer(x.id, answerMessage(x));
  const r = await ask(inbox, questionMessage({ body: { supersedes: x.id } }));
  assert.equal(r.error.code, 'ANSWERED'); assert.ok(r.error.answer);
  const y = questionMessage(); await ask(inbox, y);
  assert.equal((await ask(inbox, questionMessage({ from: { kind: 'agent', agentId: 'codex:z' }, body: { supersedes: y.id } }))).error.code, 'NOT_SUPERSEDABLE');
});
test('confirm finds the entry by native call and compares with expectAnswers', async (t) => {
  const { inbox } = await setup(t), q = questionMessage();
  await ask(inbox, q); await inbox.answer(q.id, answerMessage(q)); await inbox.handed(q.id, HANDLE);
  assert.equal((await inbox.confirm({ harness: 'claude-code', callId: 'toolu_1', observed: { 'Which shape?': 'Square' } })).entry.state, 'consumed');
  assert.equal((await inbox.confirm({ harness: 'claude-code', callId: 'nope', observed: {} })).error.code, 'NOT_FOUND');
});
test('sweep moves handed to unconfirmed after the window; nextDeadline follows', async (t) => {
  const { inbox, advance, at } = await setup(t), q = questionMessage();
  await ask(inbox, q); await inbox.answer(q.id, answerMessage(q)); await inbox.handed(q.id, HANDLE);
  assert.equal(inbox.nextDeadline(), at() + CONFIRM_WINDOW_MS);
  advance(CONFIRM_WINDOW_MS); await inbox.sweep();
  assert.equal(inbox.get(q.id).state, 'unconfirmed'); assert.equal(inbox.nextDeadline(), null);
});
test('reopen recovers entries and presence, and sweeps overdue entries at once', async (t) => {
  const { inbox, open, advance } = await setup(t), q = questionMessage();
  await ask(inbox, q); advance(3_600_000);
  const { inbox: again } = await open();
  assert.equal(again.get(q.id).state, 'expired'); assert.equal(again.presence().mode, 'away');
});
test('list: non-terminal by default, terminal ones changed since a seq; notices', async (t) => {
  const { inbox } = await setup(t), a = questionMessage(), b = questionMessage();
  await ask(inbox, a); await ask(inbox, b);
  const mark = inbox.seq();
  await inbox.withdraw(a.id, 'user');
  assert.deepEqual(inbox.list().map((e) => e.id), [b.id]);
  assert.deepEqual(inbox.list({ since: mark }).map((e) => e.id).sort(), [a.id, b.id].sort());
  const n = noticeMessage(); await inbox.notify(n);
  assert.equal((await inbox.seen(n.id)).entry.seen, true);
});
test('a failed replacement write stops the inbox; reopening reconciles', async (t) => {
  const p = await tempState(t), arm = { fail: null };
  const io = { ...fs, rename: async (from, to) => { if (arm.fail?.(to)) { arm.fail = null; throw Object.assign(new Error('disk'), { code: 'EIO' }); } return fs.rename(from, to); } };
  const open = () => openInbox({ stateDir: p.stateDir, io, expectAnswers: () => ({}) });
  const { inbox } = await open(); await inbox.setPresence('away');
  const x = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000 } });
  await ask(inbox, x);
  const n = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000, supersedes: x.id } });
  arm.fail = (to) => to.endsWith(`${x.id}.json`);
  await assert.rejects(ask(inbox, n), { code: 'STORE_FAILED' });
  for (const id of [n.id, x.id]) await assert.rejects(inbox.answer(id, answerMessage(id === n.id ? n : x)), { code: 'STORE_FAILED' });
  await assert.rejects(inbox.snapshot(), { code: 'STORE_FAILED' });
  assert.equal((await inbox.halted).code, 'STORE_FAILED');
  const { inbox: again, rejected } = await open();
  assert.deepEqual(rejected, []);
  assert.deepEqual([again.get(x.id).state, again.get(x.id).supersededBy, again.get(n.id).state], ['withdrawn', n.id, 'pending']);
});
test('snapshot and watch wait for a write in flight and never skip it', async (t) => {
  const p = await tempState(t);
  let release, reached = null;
  const io = { ...fs, rename: async (from, to) => { if (reached && to.endsWith('.json')) { const r = reached; reached = null; r(); await new Promise((g) => { release = g; }); } return fs.rename(from, to); } };
  const { inbox } = await openInbox({ stateDir: p.stateDir, io, expectAnswers: () => ({}) });
  await inbox.setPresence('away');
  const q = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000 } });
  const asked = (await ask(inbox, q)).entry;
  const hit = new Promise((r) => { reached = r; });
  const answering = inbox.answer(q.id, answerMessage(q));
  await hit;
  const snap = inbox.snapshot(), seen = [], watching = inbox.watch(asked.seq, (e) => seen.push(e));
  assert.equal(inbox.seq(), asked.seq);
  release();
  const [answered, s] = await Promise.all([answering, snap]);
  assert.equal(s.seq, answered.entry.seq);
  assert.equal(s.entries.find((e) => e.id === q.id).state, 'answered');
  const w = await watching;
  assert.equal(w.seq, answered.entry.seq);
  assert.deepEqual(seen.map((e) => e.entry.state), ['answered']);
});
test('defer on a handback route releases', async (t) => {
  const { inbox } = await setup(t), q = questionMessage();
  await ask(inbox, q, true);
  assert.equal((await inbox.defer(q.id, deferMessage(q))).entry.state, 'released');
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `just test-one test/serve-inbox.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the inbox**

`src/serve/inbox.js`:

```js
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { relayError } from '../protocol.js';
import { readJson } from '../bus/store.js';
import { loadStore, writeDurable } from '../interaction/store.js';
import * as L from '../interaction/lifecycle.js';
// The service's inbox (spec §5-§6, §8): every operation runs one at a time on a promise chain,
// the clock is applied to an entry before any write to it, and listeners hear each persisted
// change after the store has it.
const MODES = ['here', 'away'];
export async function openInbox({ stateDir, clock = Date.now, io = fs, expectAnswers, onCommit = () => {} }) {
  const { store, rejected } = await loadStore(stateDir, { io, now: clock() });
  const presencePath = join(stateDir, 'presence.json');
  const saved = await readJson(presencePath, { io });
  if (saved !== undefined && !(saved?.schema === 1 && MODES.includes(saved.mode) && Number.isSafeInteger(saved.updatedAt))) throw relayError('CORRUPT_STATE', 'invalid presence file');
  let presence = saved ? { mode: saved.mode, updatedAt: saved.updatedAt } : { mode: 'here', updatedAt: 0 };
  const listeners = new Set();
  // Fail-stop: after any failed write the in-memory state may disagree with the disk (a
  // replacement saved, its predecessor not yet withdrawn). Nothing more is served; the service
  // exits on `halted`, and the next start reconciles from disk before accepting a request.
  let failure = null;
  const halted = Promise.withResolvers();
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(() => { if (failure) throw failure; return fn(); });
    chain = run.catch(() => {});
    return run;
  };
  async function persist(write) {
    try { return await write(); }
    catch (cause) { failure = relayError('STORE_FAILED', 'an inbox write failed; relay serve must restart', cause); halted.resolve(failure); throw failure; }
  }
  const publish = (event) => { for (const fn of listeners) fn(event); };
  async function commit(result) {
    if (!result.changed) return { entry: result.entry, error: result.error };
    const entry = await persist(() => store.put(result.entry));
    onCommit(entry); publish({ type: 'entry', entry });
    return { entry, error: result.error };
  }
  const list = ({ since, states } = {}) => store.all().filter((e) => (!L.isTerminal(e) || (since !== undefined && e.seq > since)) && (!states || states.includes(e.state)));
  async function current(id) {
    const entry = store.get(id);
    return entry ? (await commit(L.applyClock(entry, clock()))).entry : null;
  }
  const on = (id, fn) => serial(async () => {
    const entry = await current(id);
    return entry ? commit(fn(entry, clock())) : { entry: null, error: { code: 'NOT_FOUND' } };
  });
  const inbox = {
    ask: (message, { handback, waiter }) => serial(async () => {
      const existing = await current(message.id);
      if (existing) return existing.kind === 'question' && isDeepStrictEqual(existing.question, message)
        ? { entry: existing, error: null } : { entry: existing, error: { code: 'ID_CONFLICT' } };
      if (presence.mode === 'here') return { passthrough: true };
      const now = clock(), entry = L.createEntry(message, { handback, waiter, now });
      const x = message.body.supersedes;
      if (x === null) return commit({ entry, changed: true, error: null });
      const predecessor = await current(x), refusal = L.checkSupersede(predecessor, message);
      if (refusal) return { entry: null, error: refusal };
      const [n, w] = await persist(() => store.supersede(entry, L.applySuperseded(predecessor, entry.id, now).entry));
      for (const e of [n, w]) { onCommit(e); publish({ type: 'entry', entry: e }); }
      return { entry: n, error: null };
    }),
    answer: (id, message) => on(id, (e, now) => e.kind === 'question' ? L.applyAnswer(e, message, now) : { entry: e, changed: false, error: { code: 'NOT_A_QUESTION' } }),
    defer: (id, message) => on(id, (e, now) => e.kind === 'question' ? L.applyDefer(e, message, now) : { entry: e, changed: false, error: { code: 'NOT_A_QUESTION' } }),
    withdraw: (id, reason) => on(id, (e, now) => e.kind === 'question' ? L.applyWithdraw(e, reason, now) : { entry: e, changed: false, error: { code: 'NOT_A_QUESTION' } }),
    handed: (id, waiter) => on(id, (e, now) => L.applyHanded(e, waiter, now)),
    askerGone: (id) => on(id, (e, now) => L.applyAskerGone(e, now)),
    seen: (id) => on(id, (e, now) => L.applySeen(e, now)),
    confirm: ({ harness, callId, observed }) => serial(async () => {
      const found = store.all().find((e) => e.kind === 'question' && e.question.body.native?.harness === harness && e.question.body.native.callId === callId);
      if (!found) return { entry: null, error: { code: 'NOT_FOUND' } };
      const e = await current(found.id);
      const matches = e.answer !== null && isDeepStrictEqual(expectAnswers(e), observed);
      return commit(L.applyConfirm(e, { matches, observed }, clock()));
    }),
    notify: (message) => serial(async () => store.get(message.id) ? { entry: store.get(message.id), error: null } : commit({ entry: L.createNotice(message, { now: clock() }), changed: true, error: null })),
    sweep: () => serial(async () => { for (const e of store.all()) await commit(L.applyClock(e, clock())); }),
    prune: () => serial(() => persist(() => store.prune(clock()))),
    nextDeadline: () => { const due = store.all().map(L.nextDeadline).filter((d) => d !== null); return due.length ? Math.min(...due) : null; },
    // Unserialized reads for internal checks; anything that hands a client a cursor uses
    // snapshot or watch, which run in the queue so no write is half done.
    list,
    get: (id) => store.get(id),
    seq: () => store.seq(),
    snapshot: ({ since, states } = {}) => serial(() => ({ seq: store.seq(), entries: list({ since, states }) })),
    // Replays the entries changed after `since` through fn, then subscribes fn, in one queued
    // step: nothing published in between is lost or reordered.
    watch: (since, fn) => serial(() => {
      for (const entry of list({ since }).filter((e) => e.seq > since)) fn({ type: 'entry', entry });
      listeners.add(fn);
      return { seq: store.seq(), unsubscribe: () => listeners.delete(fn) };
    }),
    halted: halted.promise,
    subscribers: () => listeners.size, // diagnostic: tests assert no listener outlives its client
    presence: () => presence,
    setPresence: (mode) => serial(async () => {
      if (!MODES.includes(mode)) throw relayError('INVALID_INPUT', `presence must be here or away, got ${JSON.stringify(mode)}`);
      const next = { mode, updatedAt: clock() };
      await persist(() => writeDurable(presencePath, `${JSON.stringify({ schema: 1, ...next })}\n`, { io }));
      presence = next; publish({ type: 'presence', presence });
      return presence;
    }),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    idle: () => serial(async () => {}),
  };
  await inbox.sweep();
  return { inbox, rejected };
}
```

Both comparisons use `isDeepStrictEqual`, so the order of keys never matters. Claude's
`tool_response.answers` need not list questions in the order relay does.

- [ ] **Step 4: Run it and see it pass**

Run: `just test-one test/serve-inbox.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
just test-fast && tasks check
git add src/serve/inbox.js test/serve-inbox.test.js
git commit -m "feat(serve): serialized inbox with supersession, presence and clock"
```

---
### Task 6: Claude Code route translation

**Files:**
- Create: `src/routes/claude-code.js`
- Create: `src/routes/index.js`
- Test: `test/routes-claude-code.test.js`

**Interfaces:**
- Consumes: `validateMessage` (Task 2). The fixture
  `test/fixtures/claude-askuserquestion-post.json` (Task 1).
- Produces:
  - `EXPIRY_MS` and `DECLINED`.
  - `toQuestion(payload, { now, id }) -> Message`. It throws `INVALID_INPUT` or
    `INVALID_MESSAGE`.
  - `nativeAnswers(question, answerBody) -> Record<questionText, string>`.
  - `allowReply(payload, question, answerBody) -> object` and
    `denyReply(reason) -> object`.
  - `observedAnswers(postPayload) -> Record<string, string>`. It throws `INVALID_INPUT`.
  - In `src/routes/index.js`: `expectAnswers(entry) -> Record<string, string>`. It throws
    `UNSUPPORTED_ROUTE`.

- [ ] **Step 1: Write the failing tests**

`test/routes-claude-code.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toQuestion, nativeAnswers, allowReply, denyReply, observedAnswers, EXPIRY_MS, DECLINED } from '../src/routes/claude-code.js';
import { expectAnswers } from '../src/routes/index.js';
import { createEntry, applyAnswer } from '../src/interaction/lifecycle.js';
import { uuid, HANDLE, NOW } from './helpers/interaction.js';

const prePayload = (questions) => ({ session_id: 's-test', transcript_path: '/tmp/t.jsonl', cwd: '/tmp/ws', hook_event_name: 'PreToolUse',
  tool_name: 'AskUserQuestion', tool_use_id: 'toolu_test',
  tool_input: { questions: questions ?? [{ question: 'Which shape?', header: 'Shape', multiSelect: false,
    options: [{ label: 'Circle', description: 'Round' }, { label: 'Square', description: 'Four sides' }] }] } });
const answer = (patch) => ({ answerId: uuid(), surface: 'phone', outcome: 'answered', artifactRevision: null, values: { q1: { type: 'choice', optionIds: ['o2'] } }, ...patch });

test('a Claude call becomes a validated clarification keyed to its tool_use_id', () => {
  const id = uuid(), q = toQuestion(prePayload(), { now: NOW, id });
  assert.equal(q.id, id); assert.equal(q.from.agentId, 'claude-code:s-test');
  assert.deepEqual(q.body.native, { harness: 'claude-code', sessionId: 's-test', callId: 'toolu_test' });
  assert.equal(q.body.expiresAt, NOW + EXPIRY_MS); assert.equal(q.context.cwd, '/tmp/ws');
  assert.deepEqual(q.body.items[0], { id: 'q1', header: 'Shape', prompt: 'Which shape?', type: 'single',
    options: [{ id: 'o1', label: 'Circle', description: 'Round' }, { id: 'o2', label: 'Square', description: 'Four sides' }],
    recommended: null, allowOther: true, maxLength: null });
});
test('out-of-schema calls are refused, never trimmed', () => {
  const one = prePayload().tool_input.questions[0];
  assert.throws(() => toQuestion(prePayload([one, one, one, one, one].map((q, i) => ({ ...q, question: `Q${i}` }))), { now: NOW, id: uuid() }), { code: 'INVALID_MESSAGE' });
  assert.throws(() => toQuestion(prePayload([{ ...one, header: 'x'.repeat(17) }]), { now: NOW, id: uuid() }), { code: 'INVALID_MESSAGE' });
  assert.throws(() => toQuestion({ ...prePayload(), tool_name: 'Bash' }, { now: NOW, id: uuid() }), { code: 'INVALID_INPUT' });
  assert.throws(() => toQuestion({ ...prePayload(), tool_use_id: undefined }, { now: NOW, id: uuid() }), { code: 'INVALID_INPUT' });
});
test('answers map back to labels: single, multi joined with comma-space, other, declined', () => {
  const multi = prePayload([{ ...prePayload().tool_input.questions[0], multiSelect: true }]);
  const q = toQuestion(prePayload(), { now: NOW, id: uuid() }), m = toQuestion(multi, { now: NOW, id: uuid() });
  assert.deepEqual(nativeAnswers(q, answer()), { 'Which shape?': 'Square' });
  assert.deepEqual(nativeAnswers(m, answer({ values: { q1: { type: 'choice', optionIds: ['o1', 'o2'] } } })), { 'Which shape?': 'Circle, Square' });
  assert.deepEqual(nativeAnswers(q, answer({ values: { q1: { type: 'other', text: 'Hexagon' } } })), { 'Which shape?': 'Hexagon' });
  assert.deepEqual(nativeAnswers(q, answer({ outcome: 'declined', values: {} })), { 'Which shape?': DECLINED });
});
test('allow echoes the original input plus answers; declined adds context; deny names the reason', () => {
  const p = prePayload(), q = toQuestion(p, { now: NOW, id: uuid() });
  assert.deepEqual(allowReply(p, q, answer()), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow',
    updatedInput: { questions: p.tool_input.questions, answers: { 'Which shape?': 'Square' } } } });
  assert.match(allowReply(p, q, answer({ outcome: 'declined', values: {} })).hookSpecificOutput.additionalContext, /chose not to answer/);
  assert.deepEqual(denyReply('gone'), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'gone' } });
});
test('observed answers come from the probed PostToolUse shape', () => {
  const post = JSON.parse(readFileSync(new URL('./fixtures/claude-askuserquestion-post.json', import.meta.url), 'utf8'));
  assert.deepEqual(observedAnswers(post), { [post.tool_input.questions[0].question]: 'Square' });
  assert.throws(() => observedAnswers({ ...post, tool_response: {} }), { code: 'INVALID_INPUT' });
});
test('expectAnswers dispatches by harness', () => {
  const q = toQuestion(prePayload(), { now: NOW, id: uuid() });
  const e = applyAnswer(createEntry(q, { handback: false, waiter: HANDLE, now: NOW }), { schema: 1, id: uuid(), kind: 'answer', correlationId: q.id,
    from: { kind: 'user' }, to: q.from, createdAt: NOW, context: q.context, body: answer() }, NOW).entry;
  assert.deepEqual(expectAnswers(e), { 'Which shape?': 'Square' });
  assert.throws(() => expectAnswers({ ...e, question: { ...q, body: { ...q.body, native: { ...q.body.native, harness: 'codex' } } } }), { code: 'UNSUPPORTED_ROUTE' });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `just test-one test/routes-claude-code.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the translation**

`src/routes/claude-code.js`:

```js
import { relayError } from '../protocol.js';
import { validateMessage } from '../interaction/message.js';
// The Claude Code terminal question route's translation (spec §9.1). Item and option ids are
// assigned by position in the asker's call; the question is immutable, so they stay stable.
// A call outside the schema's limits is refused, and the hook passes it through to the native
// question rather than trimming it.
export const EXPIRY_MS = 23 * 3600 * 1000;
export const DECLINED = '(declined)';
export function toQuestion(payload, { now, id }) {
  if (payload.tool_name !== 'AskUserQuestion' || typeof payload.tool_use_id !== 'string' || !payload.tool_use_id) throw relayError('INVALID_INPUT', 'not an AskUserQuestion call');
  const questions = payload.tool_input?.questions;
  if (!Array.isArray(questions)) throw relayError('INVALID_INPUT', 'AskUserQuestion carries no questions');
  const items = questions.map((q, i) => ({ id: `q${i + 1}`, header: q?.header, prompt: q?.question,
    type: q?.multiSelect === true ? 'multi' : 'single',
    options: Array.isArray(q?.options) ? q.options.map((o, j) => ({ id: `o${j + 1}`, label: o?.label, description: o?.description ?? null })) : null,
    recommended: null, allowOther: true, maxLength: null }));
  return validateMessage({ schema: 1, id, kind: 'question', correlationId: id,
    from: { kind: 'agent', agentId: `claude-code:${payload.session_id}` }, to: { kind: 'user' }, createdAt: now,
    context: { project: null, taskId: null, cwd: payload.cwd },
    body: { class: 'clarification', expiresAt: now + EXPIRY_MS,
      native: { harness: 'claude-code', sessionId: payload.session_id, callId: payload.tool_use_id },
      artifact: null, supersedes: null, items } });
}
export function nativeAnswers(question, answer) {
  return Object.fromEntries(question.body.items.map((item) => {
    if (answer.outcome === 'declined') return [item.prompt, DECLINED];
    const v = answer.values[item.id];
    if (v.type === 'choice') return [item.prompt, v.optionIds.map((id) => item.options.find((o) => o.id === id).label).join(', ')];
    return [item.prompt, v.type === 'boolean' ? String(v.value) : v.text];
  }));
}
export function allowReply(payload, question, answer) {
  const output = { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...payload.tool_input, answers: nativeAnswers(question, answer) } };
  if (answer.outcome === 'declined') output.additionalContext = 'The user chose not to answer these questions.';
  return { hookSpecificOutput: output };
}
export const denyReply = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
// Where Claude puts the answers in PostToolUse, as probed (test/fixtures/claude-askuserquestion-post.json).
export function observedAnswers(payload) {
  const answers = payload.tool_response?.answers;
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers) || !Object.values(answers).every((v) => typeof v === 'string')) {
    throw relayError('INVALID_INPUT', 'PostToolUse carries no answers map');
  }
  return { ...answers };
}
```

If Task 1 found the answers somewhere other than `tool_response.answers`, read them from
the recorded path here, and change nothing else.

`src/routes/index.js`:

```js
import { relayError } from '../protocol.js';
import * as claudeCode from './claude-code.js';
// The answer routes by harness. Only the Claude Code terminal route exists in v1 (spec §9).
const ROUTES = Object.freeze({ 'claude-code': claudeCode });
export function expectAnswers(entry) {
  const route = ROUTES[entry.question.body.native?.harness];
  if (!route) throw relayError('UNSUPPORTED_ROUTE', 'no answer route for this question');
  return route.nativeAnswers(entry.question, entry.answer.body);
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `just test-one test/routes-claude-code.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
just test-fast && tasks check
git add src/routes test/routes-claude-code.test.js
git commit -m "feat(routes): Claude Code question translation"
```

---

### Task 7: Local socket, client, and the service process

**Files:**
- Create: `src/serve/lines.js`
- Create: `src/serve/socket.js`
- Create: `src/serve/client.js`
- Create: `src/serve/serve.js`
- Create: `test/fixtures/serve-worker.js`
- Create: `test/fixtures/socket-waiter.js`
- Create: `test/helpers/spawn-lines.js`
- Test: `test/serve-socket.test.js`
- Test: `test/serve-process.test.js`

**Interfaces:**
- Consumes: `openInbox` (Task 5), `expectAnswers` (Task 6), `validateMessage` (Task 2),
  `validateHandle` (`src/protocol.js`), and `withLock` (`src/bus/lock.js`), which holds the
  lock while its callback runs; its deadline bounds acquisition only.
- Produces:
  - In `lines.js`: `lineReader(socket, onLine)` and `LINE_LIMIT`.
  - In `socket.js`: `serveSocket({ inbox, socketPath, processOps, reattachMs, log }) -> Promise<{ close() }>`.
  - In `client.js`: `connectSocket(socketPath) -> Promise<{ request(op, fields), onPush(fn), closed: Promise<void>, close() }>`.
    It rejects with `SERVE_UNAVAILABLE`.
  - In `serve.js`: `servePaths(stateDir) -> { socketPath, lockPath }` and
    `runServe({ env, signal, clock, processOps, log, onCommit, reattachMs, ready }) -> Promise<void>`.
    Its `ready` callback receives `{ socketPath, httpPort }`. It rejects with
    `SERVE_RUNNING`.

**The socket protocol (spec §7.2), exactly.** A request line is
`{ reqId, op, ...fields }`. A response line is either:

- `{ reqId, ok: true, ...result }`
- `{ reqId, ok: false, error: { code, message }, entry, answer?, revision? }`

A push line is `{ type: 'state', entry }` to the entry's waiter. A watcher receives
`{ type: 'entry', entry }` and `{ type: 'presence', presence }`. Ops:

| Op | Fields | Result |
| --- | --- | --- |
| `ask` | `message`, `waiter`, `handback` | `{ entry }` or `{ passthrough: true }` |
| `handed` | `id`, `waiter` | `{ entry }` |
| `confirm` | `harness`, `callId`, `observed` | `{ entry }` |
| `answer` / `defer` / `withdraw` | `message` | `{ entry }` |
| `notify` | `message` | `{ entry }` |
| `list` | `since?`, `states?` | `{ entries, seq }`, read in the queue with the writes |
| `get` | `id` | `{ entry }` |
| `presence.get` | none | `{ presence }` |
| `presence.set` | `mode` | `{ presence }` |
| `watch` | `since?` | the entries changed after `since` as pushes, then `{ seq }`, then live pushes |

- [ ] **Step 1: Write the shared test helper and fixtures**

`test/helpers/spawn-lines.js`:

```js
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
// A child that speaks JSON lines on stdout; next(match) waits for the first unclaimed line that
// matches. Every child is SIGKILLed at test end if still running.
export function spawnLines(t, file, args = [], { env = {}, input } = {}) {
  const child = spawn(process.execPath, [file, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const unclaimed = [], waiters = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    let value; try { value = JSON.parse(line); } catch { value = { type: 'raw', line }; }
    const w = waiters.find((x) => x.match(value));
    if (w) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(value); } else unclaimed.push(value);
  });
  if (input !== undefined) child.stdin.end(input);
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  return {
    child, exited, stderr: () => stderr,
    send: (line) => child.stdin.write(`${line}\n`),
    next(match, ms = 15000) {
      const i = unclaimed.findIndex(match);
      if (i !== -1) return Promise.resolve(unclaimed.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { match, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timed out in ${file}; stderr: ${stderr}`)); }, ms) };
        waiters.push(w);
      });
    },
  };
}
```

`test/fixtures/serve-worker.js`:

```js
// relay serve in a child, for process tests. Env: RELAY_STATE_DIR (required), CLOCK_OFFSET_MS,
// REATTACH_MS, CRASH_ON (an entry state: SIGKILL right after that state is persisted).
import { runServe } from '../../src/serve/serve.js';
const offset = Number(process.env.CLOCK_OFFSET_MS ?? 0);
const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
await runServe({ env: process.env, signal: controller.signal, clock: () => Date.now() + offset,
  reattachMs: Number(process.env.REATTACH_MS ?? 10000),
  onCommit: (entry) => { if (process.env.CRASH_ON === entry.state) process.kill(process.pid, 'SIGKILL'); },
  ready: (info) => process.stdout.write(`${JSON.stringify({ type: 'ready', ...info })}\n`) });
process.stdout.write(`${JSON.stringify({ type: 'stopped' })}\n`);
```

`test/fixtures/socket-waiter.js`:

```js
// A stand-in for a hook: asks one question and echoes every line it receives. stdin commands:
// "handed" sends handed for its own entry; "reattach" reconnects and asks again with the same id.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { connectSocket } from '../../src/serve/client.js';
import { createProcessOps } from '../../src/bus/proc.js';
import { validateHandle } from '../../src/protocol.js';
const [socketPath, messagePath, handback = 'false'] = process.argv.slice(2);
const message = JSON.parse(readFileSync(messagePath, 'utf8'));
const waiter = validateHandle(createProcessOps().handleOf(process.pid));
const out = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
let conn;
async function attach() {
  conn = await connectSocket(socketPath);
  conn.onPush(out); conn.closed.then(() => out({ type: 'closed' }));
  out({ type: 'response', op: 'ask', ...(await conn.request('ask', { message, waiter, handback: handback === 'true' })) });
}
await attach();
for await (const line of createInterface({ input: process.stdin })) {
  if (line === 'handed') conn.request('handed', { id: message.id, waiter }).then((r) => out({ type: 'response', op: 'handed', ...r }), (e) => out({ type: 'error', op: 'handed', code: e.code }));
  if (line === 'reattach') await attach().catch((e) => out({ type: 'error', op: 'ask', code: e.code }));
}
```

- [ ] **Step 2: Write the failing socket tests**

`test/serve-socket.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';
import { tempState } from './helpers/fixture.js';
import { spawnLines } from './helpers/spawn-lines.js';
import { openInbox } from '../src/serve/inbox.js';
import { serveSocket } from '../src/serve/socket.js';
import { connectSocket } from '../src/serve/client.js';
import { expectAnswers } from '../src/routes/index.js';
import { createProcessOps } from '../src/bus/proc.js';
import { questionMessage, answerMessage, deferMessage, OTHER_HANDLE } from './helpers/interaction.js';

const waiterFile = new URL('./fixtures/socket-waiter.js', import.meta.url).pathname;
async function setup(t, { io } = {}) {
  const p = await tempState(t), socketPath = join(p.stateDir, 'serve.sock');
  const { inbox } = await openInbox({ stateDir: p.stateDir, expectAnswers, ...(io ? { io } : {}) });
  await inbox.setPresence('away');
  const server = await serveSocket({ inbox, socketPath, processOps: createProcessOps(), reattachMs: 60000, log: () => {} });
  t.after(() => server.close());
  const client = await connectSocket(socketPath); t.after(() => client.close());
  return { p, inbox, socketPath, client };
}
async function waiter(t, ctx, handback = false) {
  const q = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000 } });
  const file = join(ctx.p.stateDir, `${q.id}.msg.json`); await fs.writeFile(file, JSON.stringify(q));
  const w = spawnLines(t, waiterFile, [ctx.socketPath, file, String(handback)]);
  const r = await w.next((m) => m.op === 'ask');
  assert.equal(r.ok, true, JSON.stringify(r));
  return { q, w };
}

test('the socket is private and answers unknown ops and bad JSON with errors', async (t) => {
  const { socketPath, client } = await setup(t);
  assert.equal((await fs.stat(socketPath)).mode & 0o777, 0o600);
  assert.equal((await client.request('fly')).error.code, 'UNKNOWN_OP');
  assert.equal((await client.request('answer', { message: { nope: 1 } })).error.code, 'INVALID_MESSAGE');
});
test('a waiter receives state lines: answered, then its own handed', async (t) => {
  const ctx = await setup(t), { q, w } = await waiter(t, ctx);
  assert.equal((await ctx.client.request('answer', { message: answerMessage(q) })).ok, true);
  assert.equal((await w.next((m) => m.type === 'state' && m.entry.state === 'answered')).entry.id, q.id);
  w.send('handed');
  assert.equal((await w.next((m) => m.op === 'handed')).entry.state, 'handed');
});
test('a waiter killed while pending withdraws its question (asker-gone)', async (t) => {
  const ctx = await setup(t), { q, w } = await waiter(t, ctx);
  w.child.kill('SIGKILL'); await w.exited;
  await ctx.inbox.idle(); await new Promise((r) => setTimeout(r, 50)); await ctx.inbox.idle();
  assert.deepEqual([ctx.inbox.get(q.id).state, ctx.inbox.get(q.id).withdrawal], ['withdrawn', { reason: 'asker-gone' }]);
});
test('a waiter killed after an answer leaves it undeliverable; a replay still returns it', async (t) => {
  const ctx = await setup(t), { q, w } = await waiter(t, ctx), a = answerMessage(q);
  await ctx.client.request('answer', { message: a });
  await w.next((m) => m.type === 'state' && m.entry.state === 'answered');
  w.child.kill('SIGKILL'); await w.exited;
  await new Promise((r) => setTimeout(r, 50)); await ctx.inbox.idle();
  assert.equal(ctx.inbox.get(q.id).state, 'undeliverable');
  const replay = await ctx.client.request('answer', { message: a });
  assert.deepEqual([replay.ok, replay.entry.state], [true, 'undeliverable']);
});
test('handed from another process is NOT_WAITER', async (t) => {
  const ctx = await setup(t), { q } = await waiter(t, ctx);
  await ctx.client.request('answer', { message: answerMessage(q) });
  assert.equal((await ctx.client.request('handed', { id: q.id, waiter: OTHER_HANDLE })).error.code, 'NOT_WAITER');
});
test('a defer on a handback route reaches the waiter as released', async (t) => {
  const ctx = await setup(t), { q, w } = await waiter(t, ctx, true);
  await ctx.client.request('defer', { message: deferMessage(q) });
  assert.equal((await w.next((m) => m.type === 'state' && m.entry.state === 'released')).entry.id, q.id);
});
test('watch replays since a seq and then pushes changes and presence', async (t) => {
  const ctx = await setup(t), { q } = await waiter(t, ctx);
  const watcher = await connectSocket(ctx.socketPath); t.after(() => watcher.close());
  const pushes = []; watcher.onPush((m) => pushes.push(m));
  const first = await watcher.request('watch', { since: 0 });
  assert.equal(typeof first.seq, 'number');
  assert.ok(pushes.some((m) => m.type === 'entry' && m.entry.id === q.id));
  pushes.length = 0;
  await ctx.client.request('presence.set', { mode: 'here' });
  await ctx.client.request('withdraw', { message: { ...answerMessage(q), kind: 'withdrawal', body: { reason: 'user' } } });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(pushes.map((m) => m.type), ['presence', 'entry']);
});
test('a watcher that disconnects while its registration is queued leaves no listener', async (t) => {
  let release, reached = null;
  const io = { ...fs, rename: async (from, to) => { if (reached && to.endsWith('.json')) { const r = reached; reached = null; r(); await new Promise((g) => { release = g; }); } return fs.rename(from, to); } };
  const ctx = await setup(t, { io }), { q } = await waiter(t, ctx);
  const baseline = ctx.inbox.subscribers();
  const hit = new Promise((r) => { reached = r; });
  const answering = ctx.client.request('answer', { message: answerMessage(q) });
  await hit; // the answer's write is paused, so the watch below waits in the queue
  const raw = net.createConnection(ctx.socketPath);
  await new Promise((r) => raw.once('connect', r));
  raw.write(`${JSON.stringify({ reqId: 1, op: 'watch', since: 0 })}\n`);
  await new Promise((r) => setTimeout(r, 50));
  raw.destroy();
  await new Promise((r) => setTimeout(r, 50)); // the server has seen the close
  release(); await answering; await ctx.inbox.idle();
  assert.equal(ctx.inbox.subscribers(), baseline);
});
test('withdraw over the socket accepts only user and asker reasons', async (t) => {
  const ctx = await setup(t), { q } = await waiter(t, ctx);
  const msg = { ...answerMessage(q), kind: 'withdrawal', body: { reason: 'asker-gone' } };
  assert.equal((await ctx.client.request('withdraw', { message: msg })).error.code, 'INVALID_MESSAGE');
});
test('an over-long line closes the connection', async (t) => {
  const { socketPath } = await setup(t);
  const raw = net.createConnection(socketPath);
  await new Promise((r) => raw.once('connect', r));
  raw.write('x'.repeat(1024 * 1024 + 10));
  await new Promise((r) => raw.once('close', r));
});
```

- [ ] **Step 3: Write the failing process tests**

`test/serve-process.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tempState } from './helpers/fixture.js';
import { spawnLines } from './helpers/spawn-lines.js';
import { connectSocket } from '../src/serve/client.js';
import { runServe } from '../src/serve/serve.js';
import { inboxPaths } from '../src/interaction/store.js';
import { questionMessage, answerMessage } from './helpers/interaction.js';

const worker = new URL('./fixtures/serve-worker.js', import.meta.url).pathname;
const waiterFile = new URL('./fixtures/socket-waiter.js', import.meta.url).pathname;
async function start(t, p, env = {}) {
  const w = spawnLines(t, worker, [], { env: { RELAY_STATE_DIR: p.stateDir, ...env } });
  const ready = await w.next((m) => m.type === 'ready');
  const client = await connectSocket(ready.socketPath); t.after(() => client.close());
  return { w, client, socketPath: ready.socketPath };
}
async function ask(t, p, socketPath) {
  const q = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000 } });
  const file = join(p.stateDir, `${q.id}.msg.json`); await fs.writeFile(file, JSON.stringify(q));
  const w = spawnLines(t, waiterFile, [socketPath, file]);
  assert.equal((await w.next((m) => m.op === 'ask')).ok, true);
  return { q, w };
}
const onDisk = async (p, id) => JSON.parse(await fs.readFile(join(inboxPaths(p.stateDir).entriesDir, `${id}.json`), 'utf8'));

test('a second service is refused with SERVE_RUNNING', { timeout: 30000 }, async (t) => {
  const p = await tempState(t); await start(t, p);
  await assert.rejects(runServe({ env: { RELAY_STATE_DIR: p.stateDir }, signal: new AbortController().signal }), { code: 'SERVE_RUNNING' });
});
test('SIGTERM stops the service cleanly and a restart reclaims nothing stale', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), a = await start(t, p);
  a.w.child.kill('SIGTERM'); await a.w.next((m) => m.type === 'stopped');
  await start(t, p);
});
for (const late of [false, true]) {
  test(`a crash between persisting handed and its ack is finished on reattach (${late ? 'after' : 'inside'} the window)`, { timeout: 60000 }, async (t) => {
    const p = await tempState(t), a = await start(t, p, { CRASH_ON: 'handed' });
    await a.client.request('presence.set', { mode: 'away' });
    const { q, w } = await ask(t, p, a.socketPath);
    await a.client.request('answer', { message: answerMessage(q) });
    await w.next((m) => m.type === 'state' && m.entry.state === 'answered');
    w.send('handed');
    await a.w.exited;
    assert.equal((await w.next((m) => m.op === 'handed' && m.type === 'error')).code, 'SERVE_UNAVAILABLE');
    assert.equal((await onDisk(p, q.id)).state, 'handed');
    const b = await start(t, p, { CLOCK_OFFSET_MS: late ? '61000' : '0' });
    w.send('reattach');
    const reattached = await w.next((m) => m.op === 'ask' && m.ok);
    assert.equal(reattached.entry.state, late ? 'unconfirmed' : 'handed');
    w.send('handed');
    const ack = await w.next((m) => m.op === 'handed' && m.type === 'response');
    assert.deepEqual([ack.ok, ack.entry.state], [true, late ? 'unconfirmed' : 'handed']);
    const confirmed = await b.client.request('confirm', { harness: 'claude-code', callId: 'toolu_1', observed: { 'Which shape?': 'Square' } });
    assert.equal(confirmed.entry.state, 'consumed');
  });
}
test('after a restart, a live waiter keeps its question and a dead one is withdrawn', { timeout: 60000 }, async (t) => {
  const p = await tempState(t), a = await start(t, p);
  await a.client.request('presence.set', { mode: 'away' });
  const live = await ask(t, p, a.socketPath), dead = await ask(t, p, a.socketPath);
  a.w.child.kill('SIGKILL'); await a.w.exited;
  dead.w.child.kill('SIGKILL'); await dead.w.exited;
  const b = await start(t, p, { REATTACH_MS: '200' });
  await new Promise((r) => setTimeout(r, 800));
  assert.equal((await b.client.request('get', { id: live.q.id })).entry.state, 'pending');
  const gone = (await b.client.request('get', { id: dead.q.id })).entry;
  assert.deepEqual([gone.state, gone.withdrawal], ['withdrawn', { reason: 'asker-gone' }]);
});
```

- [ ] **Step 4: Run both files and see them fail**

Run: `just test-one test/serve-socket.test.js test/serve-process.test.js`
Expected: FAIL, module not found.

- [ ] **Step 5: Write the line reader and client**

`src/serve/lines.js`:

```js
// Newline-delimited JSON framing shared by the socket server and its clients.
export const LINE_LIMIT = 1024 * 1024;
export function lineReader(socket, onLine) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i !== -1; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      if (line.trim()) onLine(line);
    }
    if (buffer.length > LINE_LIMIT) socket.destroy();
  });
}
```

`src/serve/client.js`:

```js
import net from 'node:net';
import { relayError } from '../protocol.js';
import { lineReader } from './lines.js';
// A client of relay serve's local socket: request/response by reqId, everything else a push.
export function connectSocket(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once('error', (cause) => reject(relayError('SERVE_UNAVAILABLE', 'relay serve is not running', cause)));
    socket.once('connect', () => { socket.removeAllListeners('error'); resolve(wrap(socket)); });
  });
}
function wrap(socket) {
  let next = 1, closed = false;
  const pending = new Map(), pushes = new Set();
  // A socket error is always followed by close, which rejects what is pending.
  socket.on('error', () => {});
  lineReader(socket, (line) => {
    let message;
    try { message = JSON.parse(line); } catch { socket.destroy(); return; }
    const waiting = message.reqId != null ? pending.get(message.reqId) : undefined;
    if (waiting) { pending.delete(message.reqId); waiting.resolve(message); return; }
    for (const fn of pushes) fn(message);
  });
  const closedPromise = new Promise((resolve) => socket.once('close', () => {
    closed = true;
    for (const { reject } of pending.values()) reject(relayError('SERVE_UNAVAILABLE', 'connection to relay serve closed'));
    pending.clear(); resolve();
  }));
  return {
    request(op, fields = {}) {
      if (closed) return Promise.reject(relayError('SERVE_UNAVAILABLE', 'connection to relay serve closed'));
      const reqId = next++;
      return new Promise((resolve, reject) => { pending.set(reqId, { resolve, reject }); socket.write(`${JSON.stringify({ reqId, op, ...fields })}\n`); });
    },
    onPush(fn) { pushes.add(fn); return () => pushes.delete(fn); },
    closed: closedPromise,
    close() { socket.end(); },
  };
}
```

- [ ] **Step 6: Write the socket server**

`src/serve/socket.js`:

```js
import net from 'node:net';
import * as fs from 'node:fs/promises';
import { relayError, validateHandle } from '../protocol.js';
import { validateMessage } from '../interaction/message.js';
import { lineReader } from './lines.js';
// relay serve's local socket (spec §7.2, §9.1 step 5). A connection that asked a question is that
// question's waiter: it receives a state line on every transition, and its close is the asker's
// death unless the service itself is closing.
const send = (socket, value) => { if (!socket.destroyed) socket.write(`${JSON.stringify(value)}\n`); };
const kind = (message, expected) => { if (message.kind !== expected) throw relayError('INVALID_MESSAGE', `expected a ${expected} message`); return message; };
export async function serveSocket({ inbox, socketPath, processOps, reattachMs = 10000, log }) {
  const waiters = new Map(), sockets = new Set();
  let closing = false;
  const report = (error) => log(`${error.code ?? 'ERROR'}: ${error.message}`);
  const unsubscribe = inbox.subscribe((event) => {
    if (event.type === 'entry') { const w = waiters.get(event.entry.id); if (w) send(w, { type: 'state', entry: event.entry }); }
  });
  const handlers = {
    async ask(req, socket) {
      const message = kind(validateMessage(req.message), 'question');
      if (typeof req.handback !== 'boolean') throw relayError('INVALID_MESSAGE', 'ask needs a boolean handback');
      const waiter = validateHandle(req.waiter), previous = waiters.get(message.id);
      waiters.set(message.id, socket); socket.waiting.add(message.id);
      const result = await inbox.ask(message, { handback: req.handback, waiter });
      if (result.passthrough || result.error) {
        socket.waiting.delete(message.id);
        if (previous) waiters.set(message.id, previous); else waiters.delete(message.id);
      }
      return result.passthrough ? { passthrough: true } : result;
    },
    handed: (req) => inbox.handed(req.id, validateHandle(req.waiter)),
    confirm: (req) => {
      if (typeof req.harness !== 'string' || typeof req.callId !== 'string' || req.observed === null || typeof req.observed !== 'object') throw relayError('INVALID_MESSAGE', 'confirm needs harness, callId and observed');
      return inbox.confirm({ harness: req.harness, callId: req.callId, observed: req.observed });
    },
    answer: (req) => { const m = kind(validateMessage(req.message), 'answer'); return inbox.answer(m.correlationId, m); },
    defer: (req) => { const m = kind(validateMessage(req.message), 'defer'); return inbox.defer(m.correlationId, m); },
    withdraw: (req) => {
      const m = kind(validateMessage(req.message), 'withdrawal');
      if (!['user', 'asker'].includes(m.body.reason)) throw relayError('INVALID_MESSAGE', 'only user or asker may withdraw over the socket');
      return inbox.withdraw(m.correlationId, m.body.reason);
    },
    notify: (req) => inbox.notify(kind(validateMessage(req.message), 'notice')),
    list: (req) => inbox.snapshot({ since: req.since, states: req.states }),
    get: (req) => { const entry = inbox.get(req.id); return entry ? { entry } : { entry: null, error: { code: 'NOT_FOUND' } }; },
    'presence.get': () => ({ presence: inbox.presence() }),
    'presence.set': async (req) => ({ presence: await inbox.setPresence(req.mode) }),
    // Replayed entries arrive as pushes before this response; then live changes follow.
    // Ownership is reserved before the queued registration; a socket that closed while it
    // waited is unsubscribed as soon as registration resolves, so no listener outlives it.
    watch: async (req, socket) => {
      if (socket.watching) throw relayError('INVALID_REQUEST', 'this connection already watches');
      socket.watching = true;
      const { seq, unsubscribe } = await inbox.watch(Number.isSafeInteger(req.since) ? req.since : 0, (event) => send(socket, event));
      if (socket.destroyed) { unsubscribe(); return { seq }; }
      socket.unwatch = unsubscribe;
      return { seq };
    },
  };
  async function handle(socket, line) {
    let req;
    try { req = JSON.parse(line); } catch { return send(socket, { reqId: null, ok: false, error: { code: 'INVALID_REQUEST', message: 'request is not JSON' } }); }
    const reqId = req?.reqId ?? null, handler = typeof req?.op === 'string' && Object.hasOwn(handlers, req.op) ? handlers[req.op] : null;
    if (!handler) return send(socket, { reqId, ok: false, error: { code: 'UNKNOWN_OP', message: `unknown op ${JSON.stringify(req?.op)}` } });
    try {
      const { error, ...result } = await handler(req, socket);
      if (!error) return send(socket, { reqId, ok: true, ...result });
      const { code, message, ...detail } = error;
      return send(socket, { reqId, ok: false, error: { code, message: message ?? code }, entry: result.entry ?? null, ...detail });
    } catch (error) {
      if (!error.code) report(error);
      return send(socket, { reqId, ok: false, error: { code: error.code ?? 'INTERNAL', message: error.code ? error.message : 'internal error' } });
    }
  }
  await fs.rm(socketPath, { force: true }); // the caller holds the service lock: no live server owns this path
  const server = net.createServer((socket) => {
    socket.waiting = new Set(); sockets.add(socket);
    socket.on('error', () => {}); // always followed by close
    lineReader(socket, (line) => { handle(socket, line); });
    socket.on('close', () => {
      sockets.delete(socket); socket.unwatch?.(); // a registration still queued cleans up after itself
      if (closing) return;
      for (const id of socket.waiting) if (waiters.get(id) === socket) { waiters.delete(id); inbox.askerGone(id).catch(report); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await fs.chmod(socketPath, 0o600);
  // Waiters recorded before a restart get reattachMs to come back; only a confirmed death withdraws.
  const recheck = setTimeout(() => {
    for (const e of inbox.list({ states: ['pending', 'answered'] })) {
      if (e.kind === 'question' && e.route.waiter && !waiters.has(e.id) && processOps.probe(e.route.waiter).status === 'dead') inbox.askerGone(e.id).catch(report);
    }
  }, reattachMs);
  recheck.unref();
  return {
    async close() {
      closing = true; clearTimeout(recheck); unsubscribe();
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
```

- [ ] **Step 7: Write the service process**

`src/serve/serve.js`:

```js
import { join } from 'node:path';
import { paths } from '../bus/paths.js';
import { withLock } from '../bus/lock.js';
import { ensurePrivateDir } from '../bus/store.js';
import { createProcessOps } from '../bus/proc.js';
import { relayError } from '../protocol.js';
import { expectAnswers } from '../routes/index.js';
import { openInbox } from './inbox.js';
import { serveSocket } from './socket.js';
// relay serve (spec §7.1): holds the registry's lock primitive on serve.lock for its whole life,
// so a second instance fails and a dead holder's lock is reclaimed by the reviewed path.
export function servePaths(stateDir) { return { socketPath: join(stateDir, 'serve.sock'), lockPath: join(stateDir, 'serve.lock') }; }
const DAY_MS = 24 * 3600 * 1000;
export async function runServe({ env = process.env, signal, clock = Date.now, processOps = createProcessOps(),
  log = (line) => process.stderr.write(`relay serve: ${line}\n`), onCommit = () => {}, reattachMs = 10000, ready = () => {} } = {}) {
  const { stateDir } = paths(env), sp = servePaths(stateDir);
  await ensurePrivateDir(stateDir);
  const report = (error) => log(`${error.code ?? 'ERROR'}: ${error.message}`);
  async function serveUntilAborted() {
    let inbox = null, timer = null;
    const arm = () => {
      if (!inbox) return;
      clearTimeout(timer);
      const at = inbox.nextDeadline();
      if (at !== null) timer = setTimeout(() => inbox.sweep().then(arm, report), Math.min(Math.max(0, at - clock()), 2 ** 31 - 1));
    };
    const opened = await openInbox({ stateDir, clock, expectAnswers, onCommit: (entry) => { onCommit(entry); queueMicrotask(arm); } });
    inbox = opened.inbox;
    for (const r of opened.rejected) log(`INVALID_ENTRY: quarantined ${r.name}: ${r.reason}`);
    await inbox.prune(); arm();
    const daily = setInterval(() => inbox.prune().catch(report), DAY_MS);
    const socket = await serveSocket({ inbox, socketPath: sp.socketPath, processOps, reattachMs, log });
    ready({ socketPath: sp.socketPath, httpPort: null });
    const stopped = new Promise((resolve) => { if (signal.aborted) resolve(null); else signal.addEventListener('abort', () => resolve(null), { once: true }); });
    const failure = await Promise.race([stopped, inbox.halted]);
    clearTimeout(timer); clearInterval(daily);
    await socket.close();
    if (failure) throw failure; // exit nonzero: the unit restarts us and startup reconciles
    await inbox.idle();
  }
  let held;
  try { held = await withLock(sp.lockPath, serveUntilAborted, { deadline: performance.now() + 2000, processOps }); }
  catch (error) { if (error.code === 'LOCK_TIMEOUT') throw relayError('SERVE_RUNNING', 'relay serve is already running'); throw error; }
  if (held.cleanupError) report(held.cleanupError);
}
```

- [ ] **Step 8: Run both files and see them pass**

Run: `just test-one test/serve-socket.test.js test/serve-process.test.js`
Expected: PASS. The process tests take up to about 15 s.

- [ ] **Step 9: Commit**

```bash
just test-fast && tasks check
git add src/serve test/fixtures/serve-worker.js test/fixtures/socket-waiter.js test/helpers/spawn-lines.js test/serve-socket.test.js test/serve-process.test.js
git commit -m "feat(serve): local socket, client and the relay serve process"
```

---

### Task 8: HTTP surface, tailnet guard and event stream

**Files:**
- Create: `src/serve/config.js`
- Create: `src/serve/guard.js`
- Create: `src/serve/http.js`
- Modify: `src/serve/serve.js`, to start HTTP when configured
- Test: `test/serve-http.test.js`

**Interfaces:**
- Consumes: `inbox` (Task 5), `validateMessage` (Task 2), `readSnapshot`
  (`src/bus/transaction.js`).
- Produces:
  - `serveConfig(env) -> { http: null | { port, serveHost, serveLogin, clientDir } }`. It
    throws `INVALID_CONFIG`.
  - `classify(headers, { port, serveHost, serveLogin }) -> { allowed: false } | { allowed: true, surface, origin }`.
  - `serveHttp({ inbox, http, readAgents, clock, log }) -> Promise<{ port, close() }>`.
  - Change to `runServe`: its `ready` reports `httpPort`, and its `env` is read for the
    `RELAY_HTTP_PORT`, `RELAY_SERVE_HOST`, `RELAY_SERVE_LOGIN` and `RELAY_CLIENT_DIR`
    variables.

- [ ] **Step 1: Write the failing tests**

`test/serve-http.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tempState } from './helpers/fixture.js';
import { openInbox } from '../src/serve/inbox.js';
import { serveHttp } from '../src/serve/http.js';
import { classify } from '../src/serve/guard.js';
import { serveConfig } from '../src/serve/config.js';
import { expectAnswers } from '../src/routes/index.js';
import { questionMessage, HANDLE, uuid } from './helpers/interaction.js';

const LOGIN = 'me@example.com', HOST = 'desk.tail1234.ts.net';
async function setup(t, { clientDir = null, now = Date.now, io } = {}) {
  const p = await tempState(t);
  const { inbox } = await openInbox({ stateDir: p.stateDir, clock: now, expectAnswers, ...(io ? { io } : {}) });
  await inbox.setPresence('away');
  const srv = await serveHttp({ inbox, http: { port: 0, serveHost: HOST, serveLogin: LOGIN, clientDir }, readAgents: async () => ({ agents: {} }), clock: now, log: () => {} });
  t.after(() => srv.close());
  const q = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000 } });
  await inbox.ask(q, { handback: false, waiter: HANDLE });
  return { p, inbox, port: srv.port, q };
}
const local = (port) => ({ host: `127.0.0.1:${port}` });
const phone = { host: HOST, 'tailscale-user-login': LOGIN, 'x-forwarded-for': '100.64.0.2' };
function call(port, { method = 'GET', path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const text = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { ...(text ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: data && res.headers['content-type']?.startsWith('application/json') ? JSON.parse(data) : null, text: data }));
    });
    req.on('error', reject); if (text) req.write(text); req.end();
  });
}
const answerBody = (patch = {}) => ({ answerId: uuid(), surface: 'cli', outcome: 'answered', artifactRevision: null, values: { q1: { type: 'choice', optionIds: ['o2'] } }, ...patch });

test('config: off without a port; host and login together; port and paths checked', () => {
  assert.deepEqual(serveConfig({}), { http: null });
  assert.throws(() => serveConfig({ RELAY_SERVE_HOST: HOST, RELAY_SERVE_LOGIN: LOGIN }), { code: 'INVALID_CONFIG' });
  assert.throws(() => serveConfig({ RELAY_HTTP_PORT: '3340', RELAY_SERVE_HOST: HOST }), { code: 'INVALID_CONFIG', message: /RELAY_SERVE_LOGIN/ });
  assert.throws(() => serveConfig({ RELAY_HTTP_PORT: '3340', RELAY_SERVE_LOGIN: LOGIN }), { code: 'INVALID_CONFIG', message: /RELAY_SERVE_HOST/ });
  assert.throws(() => serveConfig({ RELAY_HTTP_PORT: '70000' }), { code: 'INVALID_CONFIG' });
  assert.throws(() => serveConfig({ RELAY_HTTP_PORT: '3340', RELAY_CLIENT_DIR: 'rel' }), { code: 'INVALID_CONFIG' });
  assert.deepEqual(serveConfig({ RELAY_HTTP_PORT: '3340' }), { http: { port: 3340, serveHost: null, serveLogin: null, clientDir: null } });
});
test('guard: proxied needs exact login and host and no Funnel; local needs loopback host on the port', () => {
  const cfg = { port: 3340, serveHost: HOST, serveLogin: LOGIN };
  assert.deepEqual(classify(phone, cfg), { allowed: true, surface: 'phone', origin: `https://${HOST}` });
  for (const h of [{ ...phone, 'tailscale-user-login': 'Me@example.com' }, { ...phone, host: `${HOST}:443` }, { ...phone, host: HOST.toUpperCase() },
    { ...phone, 'tailscale-funnel-request': '?1' }, { 'x-forwarded-host': 'x', host: '127.0.0.1:3340' }]) assert.equal(classify(h, cfg).allowed, false, JSON.stringify(h));
  assert.equal(classify(phone, { ...cfg, serveHost: null, serveLogin: null }).allowed, false);
  // tailscale serve on a port other than 443 keeps the port in Host; the configured authority carries it.
  const on8443 = { ...cfg, serveHost: `${HOST}:8443` };
  assert.deepEqual(classify({ ...phone, host: `${HOST}:8443` }, on8443), { allowed: true, surface: 'phone', origin: `https://${HOST}:8443` });
  assert.equal(classify(phone, on8443).allowed, false);
  assert.deepEqual(classify({ host: '127.0.0.1:3340' }, cfg), { allowed: true, surface: 'desktop', origin: 'http://127.0.0.1:3340' });
  for (const host of ['localhost:3340', '[::1]:3340']) assert.equal(classify({ host }, cfg).allowed, true);
  for (const host of ['127.0.0.1:9999', '192.168.1.2:3340', '127.0.0.1', undefined]) assert.equal(classify(host ? { host } : {}, cfg).allowed, false);
});
test('every path, static included, is 403 for a refused request', async (t) => {
  const dir = await fs.mkdtemp(join((await tempState(t)).stateDir, 'client-'));
  await fs.writeFile(join(dir, 'index.html'), '<p>inbox</p>');
  const { port } = await setup(t, { clientDir: dir });
  for (const path of ['/', '/index.html', '/v1/inbox', '/v1/events']) assert.equal((await call(port, { path, headers: { ...phone, 'tailscale-funnel-request': '?1' } })).status, 403, path);
  const ok = await call(port, { path: '/', headers: phone });
  assert.deepEqual([ok.status, ok.text], [200, '<p>inbox</p>']);
  assert.equal((await call(port, { path: '/../../etc/passwd', headers: phone })).status, 404);
});
test('answer from the phone: surface set by the guard, retry replays, second device refused', async (t) => {
  const { port, q, inbox } = await setup(t), body = answerBody();
  const post = (b) => call(port, { method: 'POST', path: `/v1/inbox/${q.id}/answer`, headers: { ...phone, origin: `https://${HOST}` }, body: b });
  const first = await post(body);
  assert.equal(first.status, 200); assert.equal(first.json.entry.answer.body.surface, 'phone');
  const retry = await post(body);
  assert.deepEqual([retry.status, retry.json.entry.seq], [200, first.json.entry.seq]);
  const other = await post(answerBody());
  assert.equal(other.status, 409); assert.equal(other.json.error.code, 'ALREADY_ANSWERED');
  assert.equal(inbox.get(q.id).answer.body.answerId, body.answerId);
});
test('POST needs the matching origin and JSON, under 64 KiB', async (t) => {
  const { port, q } = await setup(t), path = `/v1/inbox/${q.id}/answer`;
  assert.equal((await call(port, { method: 'POST', path, headers: phone, body: answerBody() })).status, 403);
  assert.equal((await call(port, { method: 'POST', path, headers: { ...phone, origin: 'https://evil.example' }, body: answerBody() })).status, 403);
  assert.equal((await call(port, { method: 'POST', path, headers: { ...phone, origin: `https://${HOST}`, 'content-type': 'text/plain' }, body: answerBody() })).status, 415);
  assert.equal((await call(port, { method: 'POST', path, headers: { ...phone, origin: `https://${HOST}` }, body: { pad: 'x'.repeat(70000) } })).status, 413);
  assert.equal((await call(port, { method: 'POST', path, headers: { ...phone, origin: `https://${HOST}` }, body: { nope: 1 } })).status, 400);
});
test('a queued answer to a question that expired while the host slept gets EXPIRED', async (t) => {
  let now = Date.now();
  const { port, q } = await setup(t, { now: () => now });
  now = q.body.expiresAt + 1; // the expiry setup computed, not the clock captured before it
  const r = await call(port, { method: 'POST', path: `/v1/inbox/${q.id}/answer`, headers: { ...phone, origin: `https://${HOST}` }, body: answerBody() });
  assert.deepEqual([r.status, r.json.error.code, r.json.entry.state], [409, 'EXPIRED', 'expired']);
});
test('inbox listing, one entry, defer, presence, agents', async (t) => {
  const { port, q } = await setup(t), h = { ...local(port), origin: `http://127.0.0.1:${port}` };
  const list = await call(port, { path: '/v1/inbox', headers: h });
  assert.deepEqual(list.json.entries.map((e) => e.id), [q.id]); assert.equal(typeof list.json.seq, 'number');
  assert.equal((await call(port, { path: `/v1/inbox/${q.id}`, headers: h })).json.entry.id, q.id);
  assert.equal((await call(port, { path: `/v1/inbox/${uuid()}`, headers: h })).status, 404);
  const d = await call(port, { method: 'POST', path: `/v1/inbox/${q.id}/defer`, headers: h, body: {} });
  assert.deepEqual([d.status, d.json.entry.presentation], [200, 'desktop']);
  assert.equal((await call(port, { method: 'PUT', path: '/v1/presence', headers: h, body: { mode: 'here' } })).json.presence.mode, 'here');
  assert.equal((await call(port, { path: '/v1/presence', headers: h })).json.presence.mode, 'here');
  assert.deepEqual((await call(port, { path: '/v1/agents', headers: h })).json, { agents: [] });
});
test('an event stream closed while its registration is queued leaves no listener', async (t) => {
  let release, reached = null;
  const io = { ...fs, rename: async (from, to) => { if (reached && to.endsWith('.json')) { const r = reached; reached = null; r(); await new Promise((g) => { release = g; }); } return fs.rename(from, to); } };
  const { port, q, inbox } = await setup(t, { io }), baseline = inbox.subscribers();
  const hit = new Promise((r) => { reached = r; });
  const withdrawing = inbox.withdraw(q.id, 'user');
  await hit; // the withdrawal's write is paused, so the stream's watch waits in the queue
  const req = http.request({ host: '127.0.0.1', port, path: '/v1/events', headers: phone });
  req.on('error', () => {}); req.end();
  await new Promise((r) => setTimeout(r, 50));
  req.destroy();
  await new Promise((r) => setTimeout(r, 50));
  release(); await withdrawing; await inbox.idle();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(inbox.subscribers(), baseline);
});
test('events: Last-Event-ID replays newer entries, then streams', async (t) => {
  const { port, q, inbox } = await setup(t), mark = inbox.seq();
  const events = [];
  const req = http.request({ host: '127.0.0.1', port, path: '/v1/events', headers: { ...phone, 'last-event-id': String(mark - 1) } });
  const done = new Promise((resolve) => req.on('response', (res) => {
    assert.equal(res.headers['content-type'], 'text/event-stream');
    res.setEncoding('utf8');
    res.on('data', (chunk) => { for (const block of chunk.split('\n\n').filter((b) => b.startsWith('id:'))) events.push(Number(/^id: (\d+)/.exec(block)[1])); if (events.length >= 2) { req.destroy(); resolve(); } });
  }));
  req.end();
  await new Promise((r) => setTimeout(r, 100));
  await inbox.withdraw(q.id, 'user');
  await done;
  assert.deepEqual(events, [mark, mark + 1]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `just test-one test/serve-http.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the config and the guard**

`src/serve/config.js`:

```js
import { isAbsolute } from 'node:path';
import { relayError } from '../protocol.js';
// The HTTP surface is off unless RELAY_HTTP_PORT is set (spec §7.3).
const invalid = (message) => { throw relayError('INVALID_CONFIG', message); };
export function serveConfig(env) {
  const { RELAY_HTTP_PORT: port, RELAY_SERVE_HOST: host, RELAY_SERVE_LOGIN: login, RELAY_CLIENT_DIR: clientDir } = env;
  if (port === undefined) {
    if (host !== undefined || login !== undefined || clientDir !== undefined) invalid('RELAY_SERVE_HOST, RELAY_SERVE_LOGIN and RELAY_CLIENT_DIR need RELAY_HTTP_PORT');
    return { http: null };
  }
  if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) invalid('RELAY_HTTP_PORT must be a port number');
  if ((host === undefined) !== (login === undefined)) invalid(`${host === undefined ? 'RELAY_SERVE_HOST' : 'RELAY_SERVE_LOGIN'} is required when ${host === undefined ? 'RELAY_SERVE_LOGIN' : 'RELAY_SERVE_HOST'} is set`);
  if (clientDir !== undefined && !isAbsolute(clientDir)) invalid('RELAY_CLIENT_DIR must be absolute');
  return { http: { port: Number(port), serveHost: host ?? null, serveLogin: login ?? null, clientDir: clientDir ?? null } };
}
```

`src/serve/guard.js`:

```js
// The request guard (spec §7.3, after mind6's). A request carrying any proxy header is proxied
// and must come through tailscale serve from the configured login to the configured host;
// anything else is local and must name a loopback host on the service's port.
const PROXY = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'tailscale-user-login', 'tailscale-funnel-request'];
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/;
export function classify(headers, { port, serveHost, serveLogin }) {
  if (PROXY.some((name) => headers[name] !== undefined)) {
    if (serveHost === null || headers['tailscale-funnel-request'] !== undefined
      || headers['tailscale-user-login'] !== serveLogin || headers.host !== serveHost) return { allowed: false };
    return { allowed: true, surface: 'phone', origin: `https://${serveHost}` };
  }
  const m = LOOPBACK.exec(headers.host ?? '');
  if (!m || Number(m[2]) !== port) return { allowed: false };
  return { allowed: true, surface: 'desktop', origin: `http://${headers.host}` };
}
```

- [ ] **Step 4: Write the HTTP surface**

`src/serve/http.js`:

```js
import http from 'node:http';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { relayError } from '../protocol.js';
import { validateMessage } from '../interaction/message.js';
import { classify } from './guard.js';
// The remote surface (spec §7.3): loopback only, behind tailscale serve. The guard runs before
// every path, static files included; it, not the client, decides the surface of a response.
const BODY_LIMIT = 64 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const STATUS = { NOT_FOUND: 404, INVALID_MESSAGE: 400, INVALID_INPUT: 400, INVALID_ANSWER: 409 };
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
const fail = (res, status, code, message, extra = {}) => json(res, status, { error: { code, message }, ...extra });
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > BODY_LIMIT) throw relayError('TOO_LARGE', 'body over 64 KiB'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (cause) { throw relayError('INVALID_INPUT', 'body is not JSON', cause); }
}
const reply = (res, result) => result.error
  ? fail(res, STATUS[result.error.code] ?? 409, result.error.code, result.error.message ?? result.error.code, { entry: result.entry ?? null, ...(result.error.answer ? { answer: result.error.answer } : {}), ...(result.error.revision ? { revision: result.error.revision } : {}) })
  : json(res, 200, { entry: result.entry });
export async function serveHttp({ inbox, http: cfg, readAgents, clock = Date.now, log }) {
  let port = cfg.port;
  const message = (entry, kind, body) => validateMessage({ schema: 1, id: randomUUID(), kind, correlationId: entry.id, from: { kind: 'user' },
    to: entry.question.from, createdAt: clock(), context: entry.question.context, body });
  const question = (res, id) => { const e = inbox.get(id); if (!e || e.kind !== 'question') { fail(res, 404, 'NOT_FOUND', 'no such question'); return null; } return e; };
  async function staticFile(res, pathname) {
    if (!cfg.clientDir) return fail(res, 404, 'NOT_FOUND', 'not found');
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return fail(res, 404, 'NOT_FOUND', 'not found'); }
    const file = normalize(join(cfg.clientDir, decoded === '/' ? 'index.html' : decoded));
    if (!file.startsWith(cfg.clientDir.endsWith(sep) ? cfg.clientDir : cfg.clientDir + sep)) return fail(res, 404, 'NOT_FOUND', 'not found');
    let data;
    try { data = await fs.readFile(file); } catch { return fail(res, 404, 'NOT_FOUND', 'not found'); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(data);
  }
  async function events(req, res, url) {
    const raw = Number(req.headers['last-event-id'] ?? url.searchParams.get('since') ?? 0), since = Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    const write = (event) => {
      if (event.type === 'entry') res.write(`id: ${event.entry.seq}\nevent: entry\ndata: ${JSON.stringify(event.entry)}\n\n`);
      else res.write(`event: presence\ndata: ${JSON.stringify(event.presence)}\n\n`);
    };
    const { unsubscribe } = await inbox.watch(since, write);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    const stop = () => { clearInterval(ping); unsubscribe(); };
    if (res.destroyed) stop(); else res.on('close', stop);
  }
  async function route(req, res) {
    const verdict = classify(req.headers, { port, serveHost: cfg.serveHost, serveLogin: cfg.serveLogin });
    if (!verdict.allowed) return fail(res, 403, 'FORBIDDEN', 'forbidden');
    const url = new URL(req.url, 'http://relay'), parts = url.pathname.split('/').filter(Boolean);
    if (req.method === 'POST' || req.method === 'PUT') {
      if (req.headers.origin !== verdict.origin) return fail(res, 403, 'FORBIDDEN', 'origin mismatch');
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return fail(res, 415, 'UNSUPPORTED_MEDIA', 'JSON only');
    }
    if (parts[0] !== 'v1') return req.method === 'GET' ? staticFile(res, url.pathname) : fail(res, 404, 'NOT_FOUND', 'not found');
    const [, area, id, action] = parts;
    if (req.method === 'GET' && area === 'inbox' && !id) {
      const since = url.searchParams.has('since') ? Number(url.searchParams.get('since')) : undefined;
      return json(res, 200, await inbox.snapshot({ since }));
    }
    if (req.method === 'GET' && area === 'inbox' && id && !action) { const e = inbox.get(id); return e ? json(res, 200, { entry: e }) : fail(res, 404, 'NOT_FOUND', 'no such entry'); }
    if (req.method === 'GET' && area === 'events' && !id) return events(req, res, url);
    if (req.method === 'GET' && area === 'presence' && !id) return json(res, 200, { presence: inbox.presence() });
    if (req.method === 'GET' && area === 'agents' && !id) {
      const snapshot = await readAgents();
      return json(res, 200, { agents: Object.values(snapshot?.agents ?? {}).map((a) => ({ id: a.id, harness: a.harness, project: a.project, state: a.state })) });
    }
    if (req.method === 'PUT' && area === 'presence' && !id) return json(res, 200, { presence: await inbox.setPresence((await readBody(req)).mode) });
    if (req.method === 'POST' && area === 'inbox' && id && action === 'answer') {
      const e = question(res, id); if (!e) return;
      const body = await readBody(req);
      return reply(res, await inbox.answer(id, message(e, 'answer', { ...body, surface: verdict.surface })));
    }
    if (req.method === 'POST' && area === 'inbox' && id && action === 'defer') {
      const e = question(res, id); if (!e) return;
      await readBody(req);
      return reply(res, await inbox.defer(id, message(e, 'defer', { surface: verdict.surface })));
    }
    if (req.method === 'POST' && area === 'inbox' && id && action === 'seen') { await readBody(req); return reply(res, await inbox.seen(id)); }
    return fail(res, 404, 'NOT_FOUND', 'not found');
  }
  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      if (res.headersSent) return res.destroy();
      if (error.code === 'TOO_LARGE') return fail(res, 413, error.code, error.message);
      if (STATUS[error.code]) return fail(res, STATUS[error.code], error.code, error.message);
      log(`${error.code ?? 'ERROR'}: ${error.message}`);
      return fail(res, 500, 'INTERNAL', 'internal error');
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  port = server.address().port;
  return { port, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
```

- [ ] **Step 5: Start HTTP from the service when configured**

In `src/serve/serve.js`:

- Import `serveConfig` from `./config.js`, `serveHttp` from `./http.js` and `readSnapshot`
  from `../bus/transaction.js`.
- At the top of `runServe`, before `ensurePrivateDir`, read the configuration so that a
  bad one stops the service at start: `const config = serveConfig(env);`.
- In `serveUntilAborted`, after `serveSocket`:

```js
    const web = config.http ? await serveHttp({ inbox, http: config.http, readAgents: () => readSnapshot({ paths: registryPaths }), clock, log }) : null;
    ready({ socketPath: sp.socketPath, httpPort: web?.port ?? null });
```

Replace the earlier `ready(...)` line with this, and close `web` before the socket on
shutdown: `if (web) await web.close();`. In `runServe`, keep the whole paths object:
`const registryPaths = paths(env), { stateDir } = registryPaths;`. `readSnapshot` reads
`given.paths.agentsPath`.

- [ ] **Step 6: Run it and see it pass**

Run: `just test-one test/serve-http.test.js test/serve-process.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
just test-fast && tasks check
git add src/serve test/serve-http.test.js
git commit -m "feat(serve): tailnet HTTP surface, guard and event stream"
```

---

### Task 9: The `relay ask` hook runner

**Files:**
- Create: `src/routes/ask.js`
- Create: `test/fixtures/ask-hook.js`
- Test: `test/routes-ask.test.js`

**Interfaces:**
- Consumes: `connectSocket` (Task 7), `toQuestion`, `allowReply`, `denyReply` and
  `observedAnswers` (Task 6), `parsePayload` and `readNativeInput`
  (`src/adapters/payload.js`), and `servePaths` (Task 7).
- Produces: `runAsk({ nativeEvent, handback, stdin, socketPath, connect, processOps, clock, sleep, newId }) -> Promise<{ stdout, stderr, exitCode }>`.
  It always resolves and never rejects; `exitCode` is always 0. Task 12 wires it to
  `relay ask`.

- [ ] **Step 1: Write the fixture**

`test/fixtures/ask-hook.js`:

```js
// relay ask without the CLI wiring (Task 12 adds it): argv EVENT [--handback]; stdin is the
// native payload; RELAY_STATE_DIR names the service.
import { runAsk } from '../../src/routes/ask.js';
import { servePaths } from '../../src/serve/serve.js';
import { paths } from '../../src/bus/paths.js';
const [nativeEvent, flag] = process.argv.slice(2);
const r = await runAsk({ nativeEvent, handback: flag === '--handback', stdin: process.stdin, socketPath: servePaths(paths().stateDir).socketPath });
process.stdout.write(r.stdout); process.stderr.write(r.stderr);
process.exitCode = r.exitCode;
```

- [ ] **Step 2: Write the failing tests**

`test/routes-ask.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempState } from './helpers/fixture.js';
import { spawnLines } from './helpers/spawn-lines.js';
import { connectSocket } from '../src/serve/client.js';
import { uuid } from './helpers/interaction.js';

const worker = new URL('./fixtures/serve-worker.js', import.meta.url).pathname;
const hook = new URL('./fixtures/ask-hook.js', import.meta.url).pathname;
const pre = (patch = {}) => JSON.stringify({ session_id: 's-test', transcript_path: '/tmp/t.jsonl', cwd: '/tmp', hook_event_name: 'PreToolUse',
  tool_name: 'AskUserQuestion', tool_use_id: 'toolu_test', tool_input: { questions: [{ question: 'Which shape?', header: 'Shape', multiSelect: false,
    options: [{ label: 'Circle', description: 'Round' }, { label: 'Square', description: 'Four sides' }] }] }, ...patch });
const post = (answers) => JSON.stringify({ session_id: 's-test', transcript_path: '/tmp/t.jsonl', cwd: '/tmp', hook_event_name: 'PostToolUse',
  tool_name: 'AskUserQuestion', tool_use_id: 'toolu_test', tool_input: {}, tool_response: { answers } });
async function service(t, p, env = {}) {
  const w = spawnLines(t, worker, [], { env: { RELAY_STATE_DIR: p.stateDir, ...env } });
  const ready = await w.next((m) => m.type === 'ready');
  const client = await connectSocket(ready.socketPath); t.after(() => client.close());
  return { w, client };
}
const runHook = (t, p, event, input, flags = []) => spawnLines(t, hook, [event, ...flags], { env: { RELAY_STATE_DIR: p.stateDir }, input });
async function entryFor(client, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const found = (await client.request('list', { since: 0 })).entries.find((e) => e.question?.body.native?.callId === 'toolu_test');
    if (found) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('no entry');
}
const answer = (e) => ({ schema: 1, id: uuid(), kind: 'answer', correlationId: e.id, from: { kind: 'user' }, to: e.question.from, createdAt: Date.now(), context: e.question.context,
  body: { answerId: uuid(), surface: 'cli', outcome: 'answered', artifactRevision: null, values: { q1: { type: 'choice', optionIds: ['o2'] } } } });
const msg = (e, kind, body) => ({ ...answer(e), kind, body });

test('presence here: passes through at once, creates nothing', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  const h = runHook(t, p, 'PreToolUse', pre());
  assert.equal((await h.exited).code, 0); assert.equal(h.stderr(), '');
  assert.deepEqual((await client.request('list', { since: 0 })).entries, []);
});
test('service down: passes through with a diagnostic', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), h = runHook(t, p, 'PreToolUse', pre());
  assert.equal((await h.exited).code, 0); assert.match(h.stderr(), /SERVE_UNAVAILABLE/);
});
test('an out-of-schema question passes through with a diagnostic', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  await client.request('presence.set', { mode: 'away' });
  const bad = pre({ tool_input: { questions: [{ question: 'Q', header: 'x'.repeat(17), options: [{ label: 'A' }, { label: 'B' }] }] } });
  const h = runHook(t, p, 'PreToolUse', bad);
  assert.equal((await h.exited).code, 0); assert.match(h.stderr(), /INVALID_MESSAGE/);
});
test('away: answer, allow reply once, then PostToolUse confirms consumed', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  await client.request('presence.set', { mode: 'away' });
  const h = runHook(t, p, 'PreToolUse', pre()), e = await entryFor(client);
  await client.request('answer', { message: answer(e) });
  const reply = await h.next((m) => m.hookSpecificOutput);
  assert.deepEqual(reply.hookSpecificOutput.updatedInput.answers, { 'Which shape?': 'Square' });
  assert.equal((await h.exited).code, 0);
  assert.equal((await client.request('get', { id: e.id })).entry.state, 'handed');
  const c = runHook(t, p, 'PostToolUse', post({ 'Which shape?': 'Square' }));
  assert.equal((await c.exited).code, 0);
  assert.equal((await client.request('get', { id: e.id })).entry.state, 'consumed');
});
test('defer with --handback releases: no output', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  await client.request('presence.set', { mode: 'away' });
  const h = runHook(t, p, 'PreToolUse', pre(), ['--handback']), e = await entryFor(client);
  await client.request('defer', { message: msg(e, 'defer', { surface: 'cli' }) });
  assert.equal((await h.exited).code, 0);
  assert.equal((await client.request('get', { id: e.id })).entry.state, 'released');
});
test('withdrawal denies with the reason', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  await client.request('presence.set', { mode: 'away' });
  const h = runHook(t, p, 'PreToolUse', pre()), e = await entryFor(client);
  await client.request('withdraw', { message: msg(e, 'withdrawal', { reason: 'user' }) });
  const reply = await h.next((m) => m.hookSpecificOutput);
  assert.deepEqual([reply.hookSpecificOutput.permissionDecision, reply.hookSpecificOutput.permissionDecisionReason], ['deny', 'question withdrawn by the user; do not wait for an answer']);
});
for (const handback of [true, false]) {
  test(`expiry seen after a service restart ${handback ? 'releases' : 'denies'}`, { timeout: 40000 }, async (t) => {
    const p = await tempState(t), a = await service(t, p);
    await a.client.request('presence.set', { mode: 'away' });
    const h = runHook(t, p, 'PreToolUse', pre(), handback ? ['--handback'] : []); await entryFor(a.client);
    a.w.child.kill('SIGKILL'); await a.w.exited;
    await service(t, p, { CLOCK_OFFSET_MS: String(24 * 3600 * 1000) });
    assert.equal((await h.exited).code, 0);
    if (!handback) assert.match((await h.next((m) => m.hookSpecificOutput)).hookSpecificOutput.permissionDecisionReason, /expired/);
  });
}
test('a hook killed mid-wait withdraws its question', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  await client.request('presence.set', { mode: 'away' });
  const h = runHook(t, p, 'PreToolUse', pre()), e = await entryFor(client);
  h.child.kill('SIGKILL'); await h.exited;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await client.request('get', { id: e.id })).entry.withdrawal.reason, 'asker-gone');
});
for (const late of [false, true]) {
  test(`service crash between handed and its ack: the hook replies once after reattach (${late ? 'late' : 'early'})`, { timeout: 60000 }, async (t) => {
    const p = await tempState(t), a = await service(t, p, { CRASH_ON: 'handed' });
    await a.client.request('presence.set', { mode: 'away' });
    const h = runHook(t, p, 'PreToolUse', pre()), e = await entryFor(a.client);
    await a.client.request('answer', { message: answer(e) });
    await a.w.exited;
    const b = await service(t, p, { CLOCK_OFFSET_MS: late ? '61000' : '0' });
    const reply = await h.next((m) => m.hookSpecificOutput, 20000);
    assert.equal(reply.hookSpecificOutput.permissionDecision, 'allow');
    assert.equal((await h.exited).code, 0);
    await assert.rejects(h.next((m) => m.hookSpecificOutput, 200)); // exactly one reply
    assert.equal((await b.client.request('get', { id: e.id })).entry.state, late ? 'unconfirmed' : 'handed');
    runHook(t, p, 'PostToolUse', post({ 'Which shape?': 'Square' }));
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal((await b.client.request('get', { id: e.id })).entry.state, 'consumed');
  });
}
```

- [ ] **Step 3: Run it and see it fail**

Run: `just test-one test/routes-ask.test.js`
Expected: FAIL, module not found.

- [ ] **Step 4: Write the runner**

`src/routes/ask.js`:

```js
import { randomUUID } from 'node:crypto';
import { relayError, validateHandle } from '../protocol.js';
import { createProcessOps } from '../bus/proc.js';
import { parsePayload, readNativeInput } from '../adapters/payload.js';
import { connectSocket } from '../serve/client.js';
import { toQuestion, allowReply, denyReply, observedAnswers } from './claude-code.js';
// relay ask: the Claude Code terminal question route's hook (spec §9.1). It never blocks the
// user on its own failure: anything unexpected passes the call through to the native question
// with a diagnostic on stderr. It writes its reply at most once and then exits.
const DELAYS = [250, 500, 1000, 2000, 5000];
const quiet = Object.freeze({ stdout: '', stderr: '', exitCode: 0 });
const passthrough = (error) => ({ stdout: '', stderr: `relay ask: ${error.code ?? 'ERROR'}: ${error.message}\n`, exitCode: 0 });
const reply = (value) => ({ stdout: `${JSON.stringify(value)}\n`, stderr: '', exitCode: 0 });
const WITHDRAWN = 'question withdrawn by the user; do not wait for an answer';
const EXPIRED = 'question expired before an answer arrived; do not wait for an answer';
export async function runAsk({ nativeEvent, handback = false, stdin, socketPath, connect = connectSocket, processOps = createProcessOps(),
  clock = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), newId = randomUUID }) {
  try {
    if (nativeEvent === 'PostToolUse') return await confirm({ stdin, socketPath, connect });
    const payload = parsePayload(await readNativeInput(stdin), 'PreToolUse');
    const question = toQuestion(payload, { now: clock(), id: newId() });
    const waiter = validateHandle(processOps.handleOf(process.pid));
    let conn = await connect(socketPath);
    for (let attempt = 0; ;) {
      const outcome = await attend(conn, { question, waiter, handback, payload });
      if (outcome) return outcome;
      // The connection closed under a live hook: the service restarted. Reattach with the same
      // id until it is back; Claude's outer timeout bounds this loop.
      for (;;) {
        await sleep(DELAYS[Math.min(attempt++, DELAYS.length - 1)]);
        try { conn = await connect(socketPath); attempt = 0; break; } catch { /* still down */ }
      }
    }
  } catch (error) { return passthrough(error); }
}
// Resolves with the hook's result, or null when the connection was lost before a reply.
function attend(conn, { question, waiter, handback, payload }) {
  return new Promise((resolve) => {
    let busy = false, finished = false;
    const finish = (result) => { if (finished) return; finished = true; stop(); conn.close(); resolve(result); };
    const lost = () => { if (finished) return; finished = true; stop(); resolve(null); };
    async function act(entry) {
      if (finished || busy || entry?.id !== question.id) return;
      switch (entry.state) {
        case 'pending': return undefined;
        case 'answered': case 'handed': case 'unconfirmed': case 'consumed': {
          busy = true;
          let r;
          try { r = await conn.request('handed', { id: entry.id, waiter }); } catch { return lost(); }
          if (!r.ok) return finish(passthrough(relayError(r.error.code, r.error.message)));
          return finish(reply(allowReply(payload, question, r.entry.answer.body)));
        }
        case 'released': return finish(quiet);
        case 'expired': return finish(handback ? quiet : reply(denyReply(EXPIRED)));
        case 'withdrawn': return finish(reply(denyReply(WITHDRAWN)));
        default: return finish(passthrough(relayError('UNEXPECTED_STATE', `question is ${entry.state}`)));
      }
    }
    const stop = conn.onPush((message) => { if (message.type === 'state') act(message.entry); });
    conn.closed.then(lost);
    conn.request('ask', { message: question, waiter, handback }).then((r) => {
      if (r.passthrough) return finish(quiet);
      if (!r.ok) return finish(passthrough(relayError(r.error.code, r.error.message)));
      return act(r.entry);
    }, lost);
  });
}
async function confirm({ stdin, socketPath, connect }) {
  const payload = parsePayload(await readNativeInput(stdin), 'PostToolUse');
  if (typeof payload.tool_use_id !== 'string') throw relayError('INVALID_INPUT', 'PostToolUse carries no tool_use_id');
  const observed = observedAnswers(payload), conn = await connect(socketPath);
  try {
    const r = await conn.request('confirm', { harness: 'claude-code', callId: payload.tool_use_id, observed });
    // NOT_FOUND is the ordinary case of a question asked while presence was here.
    return r.ok || r.error.code === 'NOT_FOUND' ? quiet : passthrough(relayError(r.error.code, r.error.message));
  } finally { conn.close(); }
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `just test-one test/routes-ask.test.js`
Expected: PASS. The restart tests take a few seconds each because of the reconnect
backoff.

- [ ] **Step 6: Commit**

```bash
just test-fast && tasks check
git add src/routes/ask.js test/fixtures/ask-hook.js test/routes-ask.test.js
git commit -m "feat(routes): relay ask hook runner with handoff retry"
```

---

### Task 10: Desk commands: inbox and presence

**Files:**
- Create: `src/cli/desk.js`
- Test: `test/cli-desk.test.js`

**Interfaces:**
- Consumes: `connectSocket` (Task 7) and `servePaths` (Task 7).
- Produces:
  - `parseValues(entry, tokens) -> values`. It throws `USAGE`.
  - `runInbox({ action, args, decline, since, socketPath, clock, newId }) -> Promise<{ json, text }>`.
  - `runPresence({ mode, socketPath }) -> Promise<{ json, text }>`.

  Both runners throw `relayError(code, message)` on a service refusal. Task 12 wires them
  to the CLI.

**The value grammar** for `inbox answer <id> <item>=<value>...` takes one token per item:

| Item type | Token | Example |
| --- | --- | --- |
| single | `<item>=<optionId>` | `q1=o2` |
| multi | `<item>=<optionId>,<optionId>` | `q1=o1,o3` |
| other text, where allowed | `<item>=other:<text>` | `q1=other:Hexagon` |
| text | `<item>=text:<text>` | `q1=text:hello` |
| boolean | `<item>=true` or `<item>=false` | `q1=true` |

`--decline` takes no tokens.

- [ ] **Step 1: Write the failing tests**

`test/cli-desk.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tempState } from './helpers/fixture.js';
import { spawnLines } from './helpers/spawn-lines.js';
import { connectSocket } from '../src/serve/client.js';
import { parseValues, runInbox, runPresence } from '../src/cli/desk.js';
import { questionMessage } from './helpers/interaction.js';

const worker = new URL('./fixtures/serve-worker.js', import.meta.url).pathname;
const waiterFile = new URL('./fixtures/socket-waiter.js', import.meta.url).pathname;
async function setup(t) {
  const p = await tempState(t), w = spawnLines(t, worker, [], { env: { RELAY_STATE_DIR: p.stateDir } });
  const { socketPath } = await w.next((m) => m.type === 'ready');
  await runPresence({ mode: 'away', socketPath });
  const q = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000 } });
  const file = join(p.stateDir, 'q.json'); await fs.writeFile(file, JSON.stringify(q));
  const asker = spawnLines(t, waiterFile, [socketPath, file]); await asker.next((m) => m.op === 'ask');
  return { socketPath, q, asker };
}
test('parseValues follows the grammar and refuses what does not fit', () => {
  const q = questionMessage(), entry = { question: q };
  assert.deepEqual(parseValues(entry, ['q1=o2']), { q1: { type: 'choice', optionIds: ['o2'] } });
  assert.deepEqual(parseValues(entry, ['q1=other:Hexagon']), { q1: { type: 'other', text: 'Hexagon' } });
  for (const bad of [[], ['q1'], ['q9=o1'], ['q1=o1', 'q1=o2'], ['q1=text:x']]) assert.throws(() => parseValues(entry, bad), { code: 'USAGE' }, JSON.stringify(bad));
  const bool = { question: questionMessage({ body: { items: [{ ...q.body.items[0], type: 'boolean', options: [], allowOther: false }] } }) };
  assert.deepEqual(parseValues(bool, ['q1=false']), { q1: { type: 'boolean', value: false } });
});
test('list, show, answer, and the waiter hears it', { timeout: 30000 }, async (t) => {
  const { socketPath, q, asker } = await setup(t);
  const list = await runInbox({ action: 'list', args: [], socketPath });
  assert.deepEqual(list.json.entries.map((e) => e.id), [q.id]);
  assert.match(list.text, new RegExp(`^${q.id} pending claude-code:s1 Which shape\\?$`, 'm'));
  assert.equal((await runInbox({ action: 'show', args: [q.id], socketPath })).json.entry.id, q.id);
  const a = await runInbox({ action: 'answer', args: [q.id, 'q1=o2'], socketPath });
  assert.equal(a.json.entry.answer.body.surface, 'cli');
  await asker.next((m) => m.type === 'state' && m.entry.state === 'answered');
  await assert.rejects(runInbox({ action: 'answer', args: [q.id, 'q1=o1'], socketPath }), { code: 'ALREADY_ANSWERED' });
});
test('defer, withdraw, decline, and presence', { timeout: 30000 }, async (t) => {
  const { socketPath, q } = await setup(t);
  assert.equal((await runInbox({ action: 'defer', args: [q.id], socketPath })).json.entry.presentation, 'desktop');
  assert.equal((await runInbox({ action: 'answer', args: [q.id], decline: true, socketPath })).json.entry.answer.body.outcome, 'declined');
  await assert.rejects(runInbox({ action: 'withdraw', args: [q.id], socketPath }), { code: 'ANSWERED' });
  assert.equal((await runPresence({ mode: null, socketPath })).json.presence.mode, 'away');
  assert.equal((await runPresence({ mode: 'here', socketPath })).text, 'here\n');
});
test('no service is SERVE_UNAVAILABLE', async (t) => {
  const p = await tempState(t);
  await assert.rejects(runPresence({ mode: null, socketPath: join(p.stateDir, 'serve.sock') }), { code: 'SERVE_UNAVAILABLE' });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `just test-one test/cli-desk.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the desk commands**

`src/cli/desk.js`:

```js
import { randomUUID } from 'node:crypto';
import { relayError } from '../protocol.js';
import { connectSocket } from '../serve/client.js';
// The minimal desktop surface (spec §7.4): relay inbox and relay presence over the local socket.
const usage = (message) => relayError('USAGE', message);
export function parseValues(entry, tokens) {
  const items = entry.question.body.items, values = {};
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq < 1) throw usage(`expected <item>=<value>, got ${JSON.stringify(token)}`);
    const id = token.slice(0, eq), raw = token.slice(eq + 1), item = items.find((i) => i.id === id);
    if (!item) throw usage(`no item ${JSON.stringify(id)} in this question`);
    if (Object.hasOwn(values, id)) throw usage(`item ${id} given twice`);
    if (item.type === 'boolean') { if (raw !== 'true' && raw !== 'false') throw usage(`${id} takes true or false`); values[id] = { type: 'boolean', value: raw === 'true' }; continue; }
    if (item.type === 'text') { if (!raw.startsWith('text:')) throw usage(`${id} takes text:<text>`); values[id] = { type: 'text', text: raw.slice(5) }; continue; }
    if (raw.startsWith('other:')) { if (!item.allowOther) throw usage(`${id} allows no other`); values[id] = { type: 'other', text: raw.slice(6) }; continue; }
    if (raw.startsWith('text:')) throw usage(`${id} takes option ids`);
    values[id] = { type: 'choice', optionIds: raw.split(',') };
  }
  const missing = items.filter((i) => !Object.hasOwn(values, i.id)).map((i) => i.id);
  if (missing.length) throw usage(`missing a value for ${missing.join(', ')}`);
  return values;
}
async function withSocket(socketPath, fn) {
  const conn = await connectSocket(socketPath);
  try { return await fn(conn); } finally { conn.close(); }
}
const ok = (r) => { if (!r.ok) throw Object.assign(relayError(r.error.code, r.error.message), { entry: r.entry }); return r; };
const line = (e) => e.kind === 'notice' ? `${e.id} ${e.state} notice ${e.notice.body.title}`
  : `${e.id} ${e.state}${e.presentation === 'desktop' ? ' (desktop)' : ''} ${e.question.from.agentId ?? 'user'} ${e.question.body.items[0].prompt}`;
const reply = (entry, kind, body, clock, newId) => ({ schema: 1, id: newId(), kind, correlationId: entry.id, from: { kind: 'user' }, to: entry.question.from,
  createdAt: clock(), context: entry.question.context, body });
export function runInbox({ action, args = [], decline = false, since, socketPath, clock = Date.now, newId = randomUUID }) {
  return withSocket(socketPath, async (conn) => {
    if (action === 'list') {
      if (args.length) throw usage('inbox list takes no arguments');
      const r = ok(await conn.request('list', since === undefined ? {} : { since }));
      return { json: { seq: r.seq, entries: r.entries }, text: r.entries.map((e) => `${line(e)}\n`).join('') };
    }
    const [id, ...rest] = args;
    if (!id) throw usage(`inbox ${action} needs an id`);
    const entry = ok(await conn.request('get', { id })).entry;
    if (action === 'show') { if (rest.length) throw usage('inbox show takes only an id'); return { json: { entry }, text: `${JSON.stringify(entry, null, 2)}\n` }; }
    if (entry.kind !== 'question') throw usage(`${id} is not a question`);
    let r;
    if (action === 'answer') {
      if (decline && rest.length) throw usage('--decline takes no values');
      const values = decline ? {} : parseValues(entry, rest);
      r = ok(await conn.request('answer', { message: reply(entry, 'answer', { answerId: newId(), surface: 'cli', outcome: decline ? 'declined' : 'answered',
        artifactRevision: entry.question.body.artifact?.revision ?? null, values }, clock, newId) }));
    } else if (action === 'defer') {
      if (rest.length) throw usage('inbox defer takes only an id');
      r = ok(await conn.request('defer', { message: reply(entry, 'defer', { surface: 'cli' }, clock, newId) }));
    } else if (action === 'withdraw') {
      if (rest.length) throw usage('inbox withdraw takes only an id');
      r = ok(await conn.request('withdraw', { message: reply(entry, 'withdrawal', { reason: 'user' }, clock, newId) }));
    } else throw usage(`unknown inbox action ${JSON.stringify(action)}`);
    return { json: { entry: r.entry }, text: `${r.entry.id} ${r.entry.state}\n` };
  });
}
export function runPresence({ mode, socketPath }) {
  return withSocket(socketPath, async (conn) => {
    const r = ok(mode ? await conn.request('presence.set', { mode }) : await conn.request('presence.get'));
    return { json: { presence: r.presence }, text: `${r.presence.mode}\n` };
  });
}
```

`artifactRevision` echoes the question's own revision. A desk answer is given against
the question as shown, and a superseded question is refused as `WITHDRAWN` before the
revision is ever compared.

- [ ] **Step 4: Run it and see it pass**

Run: `just test-one test/cli-desk.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
just test-fast && tasks check
git add src/cli/desk.js test/cli-desk.test.js
git commit -m "feat(cli): desk inbox and presence commands over the socket"
```

---

### Task 11: Installer: the ask route's bindings behind its evidence

**Files:**
- Modify: `src/install/capabilities.js`, so `parseEvidence` accepts `routes`
- Modify: `src/install/hooks.js`, to add `ROUTE_EVIDENCE`, `routeBindings` and `planRouteHooks`
- Modify: `src/install/claude-code.js`, for the `withAsk` option
- Test: `test/install-routes.test.js`

**Interfaces:**
- Consumes: the evidence record shape from Task 1.
- Produces:
  - `parseEvidence(text)`, which now also returns `routes: Array<{ name, passed, note }>`.
    A record without `routes` still parses.
  - `routeBindings(harness, evidence, installedVersion) -> Array<{ event, matcher, outerMs, handback? }>`.
    It throws `UNSUPPORTED_BINDING` when the evidence's `version` is not the installed
    harness version, or when a required row has not passed.
  - `planRouteHooks({ text, harness, relayBin, nodeBin, rows }) -> text`. It reconciles
    both of the route's events (`ROUTE_EVENTS`): it removes every relay-owned `ask` entry
    whose event has no row, and writes one entry per row.
  - `planClaudeCode({ ..., withAsk, installedVersion })`. With `withAsk: true` it
    reconciles the route's entries, which is the CLI's `--with ask`. `installedVersion`
    is required then. Without `withAsk`, existing `ask` entries are left untouched.

The installed commands are:

- `'<node>' '<relay.js>' ask --harness claude-code [--handback] PreToolUse`, with matcher
  `AskUserQuestion` and timeout 86400.
- `'<node>' '<relay.js>' ask --harness claude-code PostToolUse`, with matcher
  `AskUserQuestion` and timeout 10.

- [ ] **Step 1: Write the failing tests**

`test/install-routes.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvidence } from '../src/install/capabilities.js';
import { routeBindings, planRouteHooks } from '../src/install/hooks.js';
import { planClaudeCode } from '../src/install/claude-code.js';

const record = (routes) => JSON.stringify({ schema: 1, harness: 'claude-code', version: '2.1.296', probes: [], ...(routes ? { routes } : {}) });
const row = (name, passed = true) => ({ name, passed, note: 'probe' });
const all = ['answer-hook-terminal', 'answer-hook-deny-stops', 'answer-release-native', 'answer-receipt-observed', 'answer-hook-under-denial'].map((n) => row(n));

test('evidence routes are optional, named from the closed set, and unique', () => {
  assert.deepEqual(parseEvidence(record()).routes ?? [], []);
  assert.equal(parseEvidence(record(all)).routes.length, 5);
  for (const bad of [[row('made-up')], [row('answer-hook-terminal'), row('answer-hook-terminal')], [{ name: 'answer-hook-terminal', passed: 'yes', note: '' }], [{ ...row('answer-hook-terminal'), extra: 1 }]]) {
    assert.throws(() => parseEvidence(record(bad)), { code: 'INVALID_EVIDENCE' }, JSON.stringify(bad));
  }
});
test('route evidence must be for the installed version', () => {
  const ev = parseEvidence(record(all));
  assert.throws(() => routeBindings('claude-code', ev, '2.1.300'), { code: 'UNSUPPORTED_BINDING', message: /2\.1\.296.*2\.1\.300/ });
  assert.throws(() => routeBindings('claude-code', ev, undefined), { code: 'UNSUPPORTED_BINDING' });
  assert.equal(routeBindings('claude-code', ev, '2.1.296').length, 2);
});
test('route bindings follow the evidence', () => {
  const ev = (rows) => parseEvidence(record(rows));
  const bind = (h, e) => routeBindings(h, e, '2.1.296');
  assert.deepEqual(bind('claude-code', ev(all)), [
    { event: 'PreToolUse', matcher: 'AskUserQuestion', outerMs: 86400000, handback: true },
    { event: 'PostToolUse', matcher: 'AskUserQuestion', outerMs: 10000 }]);
  const noRelease = all.map((r) => r.name === 'answer-release-native' ? { ...r, passed: false } : r);
  assert.equal(bind('claude-code', ev(noRelease))[0].handback, false);
  const noReceipt = all.filter((r) => r.name !== 'answer-receipt-observed');
  assert.equal(bind('claude-code', ev(noReceipt)).length, 1);
  for (const missing of ['answer-hook-terminal', 'answer-hook-deny-stops']) {
    assert.throws(() => bind('claude-code', ev(all.filter((r) => r.name !== missing))), { code: 'UNSUPPORTED_BINDING', message: new RegExp(missing) });
  }
  assert.throws(() => bind('claude-code', null), { code: 'UNSUPPORTED_BINDING' });
  assert.throws(() => bind('codex', ev(all)), { code: 'UNSUPPORTED_BINDING' });
});
test('replanning without P2 removes the confirmation hook it installed before', () => {
  const args = { harness: 'claude-code', relayBin: '/r/bin/relay.js', nodeBin: '/n/node' };
  const full = routeBindings('claude-code', parseEvidence(record(all)), '2.1.296');
  const once = planRouteHooks({ ...args, text: '{"hooks":{}}', rows: full });
  assert.equal(JSON.parse(once).hooks.PostToolUse.length, 1);
  const theirs = { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: '/x/their-post', timeout: 5 }] };
  const mixed = JSON.stringify({ hooks: { ...JSON.parse(once).hooks, PostToolUse: [...JSON.parse(once).hooks.PostToolUse, theirs] } });
  const again = planRouteHooks({ ...args, text: mixed, rows: full.filter((r) => r.event === 'PreToolUse') });
  assert.deepEqual(JSON.parse(again).hooks.PostToolUse, [theirs]);
  assert.equal(JSON.parse(again).hooks.PreToolUse.length, 1);
  assert.equal(planRouteHooks({ ...args, text: '{"hooks":{}}', rows: [] }), '{"hooks":{}}'); // nothing owned, nothing requested: untouched
});
test('planRouteHooks writes and replaces only relay ask entries, idempotently', () => {
  const rows = routeBindings('claude-code', parseEvidence(record(all)), '2.1.296');
  const theirs = { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: '/x/other-hook', timeout: 5 }] };
  const text = JSON.stringify({ hooks: { PreToolUse: [theirs] } });
  const once = planRouteHooks({ text, harness: 'claude-code', relayBin: '/r/bin/relay.js', nodeBin: '/n/node', rows });
  const parsed = JSON.parse(once);
  assert.deepEqual(parsed.hooks.PreToolUse[0], theirs);
  assert.deepEqual(parsed.hooks.PreToolUse[1], { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: "'/n/node' '/r/bin/relay.js' ask --harness claude-code --handback PreToolUse", timeout: 86400 }] });
  assert.deepEqual(parsed.hooks.PostToolUse[0].hooks[0], { type: 'command', command: "'/n/node' '/r/bin/relay.js' ask --harness claude-code PostToolUse", timeout: 10 });
  assert.equal(planRouteHooks({ text: once, harness: 'claude-code', relayBin: '/r/bin/relay.js', nodeBin: '/n/node', rows }), once);
  const without = planRouteHooks({ text: once, harness: 'claude-code', relayBin: '/r/bin/relay.js', nodeBin: '/n/node', rows: [{ ...rows[0], handback: false }] });
  assert.equal(JSON.parse(without).hooks.PreToolUse[1].hooks[0].command, "'/n/node' '/r/bin/relay.js' ask --harness claude-code PreToolUse");
});
test('planClaudeCode adds the route only with withAsk', () => {
  const base = { target: '/t/settings.json', text: '{}', relayBin: '/r/bin/relay.js', nodeBin: '/n/node', subscribersPath: '/c/subscribers.json',
    subscribers: { schema: 1, subscribers: [] }, evidence: parseEvidence(record(all)) };
  assert.doesNotMatch(planClaudeCode(base).changes[0].after, / ask --harness/);
  assert.match(planClaudeCode({ ...base, withAsk: true, installedVersion: '2.1.296' }).changes[0].after, / ask --harness claude-code --handback PreToolUse/);
  assert.throws(() => planClaudeCode({ ...base, withAsk: true, installedVersion: '2.2.0' }), { code: 'UNSUPPORTED_BINDING' });
});
```

Check `test/install-claude-code.test.js` for how `subscribers` must be shaped when passed
to `planClaudeCode` (it is the validated config object). Shape `base.subscribers` the
same way.

- [ ] **Step 2: Run it and see it fail**

Run: `just test-one test/install-routes.test.js`
Expected: FAIL, `routeBindings` is not exported.

- [ ] **Step 3: Accept routes in the evidence**

In `src/install/capabilities.js`, make three changes:

1. Import `ROUTE_EVIDENCE` from `./hooks.js`.
2. Widen the record field check to
   `fields(value, ['schema', 'harness', 'version', 'probes', 'routes'])`.
3. After the probes loop, add:

```js
  if (value.routes !== undefined) {
    if (!Array.isArray(value.routes)) fail('routes must be an array');
    const names = new Set();
    for (const route of value.routes) {
      if (!object(route) || !ROUTE_EVIDENCE.includes(route.name) || typeof route.passed !== 'boolean' || typeof route.note !== 'string'
        || !fields(route, ['name', 'passed', 'note'])) fail('invalid route evidence');
      if (names.has(route.name)) fail('duplicate route evidence');
      names.add(route.name);
    }
  }
```

- [ ] **Step 4: Add the route rows to the hook planner**

In `src/install/hooks.js`, add a `relayError` import from `../protocol.js` and append:

```js
// The ask route (spec §9.1, §11): its own entries, gated on route evidence, not on the
// event/reply probes the dispatch bindings use.
export const ROUTE_EVIDENCE = Object.freeze(['answer-hook-terminal', 'answer-hook-deny-stops', 'answer-release-native', 'answer-receipt-observed', 'answer-hook-under-denial']);
export const ROUTE_EVENTS = Object.freeze(['PreToolUse', 'PostToolUse']);
// Route evidence holds only for the harness version it was probed on (spec §11): after an
// upgrade the probes run again before the route is installed.
export function routeBindings(harness, evidence, installedVersion) {
  if (harness !== 'claude-code') throw relayError('UNSUPPORTED_BINDING', 'the ask route exists only for claude-code');
  if (!evidence) throw relayError('UNSUPPORTED_BINDING', 'the ask route needs route evidence (--evidence)');
  if (typeof installedVersion !== 'string' || evidence.version !== installedVersion) {
    throw relayError('UNSUPPORTED_BINDING', `route evidence is for ${harness} ${evidence.version}, installed is ${installedVersion ?? 'unknown'}; rerun the answer route probes`);
  }
  const passed = (name) => evidence.routes?.some((r) => r.name === name && r.passed) ?? false;
  for (const name of ['answer-hook-terminal', 'answer-hook-deny-stops']) {
    if (!passed(name)) throw relayError('UNSUPPORTED_BINDING', `missing route evidence (${harness},${name})`);
  }
  const rows = [{ event: 'PreToolUse', matcher: 'AskUserQuestion', outerMs: 86400000, handback: passed('answer-release-native') }];
  if (passed('answer-receipt-observed')) rows.push({ event: 'PostToolUse', matcher: 'AskUserQuestion', outerMs: 10000 });
  return rows;
}
const askCommand = (node, bin, harness, event, handback) => `${shellQuote(node)} ${shellQuote(bin)} ask --harness ${harness}${handback ? ' --handback' : ''} ${event}`;
const askOwned = (value, harness, event) => new RegExp(`^(?:${executable} )?${executable} ask --harness ${esc(harness)}(?: --handback)? ${esc(event)}$`).test(value);
// Reconciles both route events: an owned entry whose event has no row is removed, so evidence
// that no longer supports a binding takes it out on the next plan.
export function planRouteHooks({ text, harness, relayBin, nodeBin = process.execPath, rows }) {
  if (typeof nodeBin !== 'string' || !isAbsolute(nodeBin) || !isAbsolute(relayBin)) throw new Error('node and relay paths must be absolute');
  let output = text;
  for (const event of ROUTE_EVENTS) {
    const row = rows.find((r) => r.event === event) ?? null;
    const existing = parse(output).hooks?.[event] ?? [];
    if (!Array.isArray(existing)) throw new Error(`hooks.${event} must be an array`);
    const owned = existing.filter((item) => Array.isArray(item?.hooks) && item.hooks.length === 1
      && typeof item.hooks[0]?.command === 'string' && askOwned(item.hooks[0].command, harness, event));
    if (owned.length > 1) throw new Error(`duplicate relay ask writer for ${event}`);
    if (!row && owned.length === 0) continue;
    const next = existing.filter((item) => item !== owned[0]);
    if (row) next.push(entry(askCommand(nodeBin, relayBin, harness, event, row.handback === true), row.matcher, row.outerMs));
    output = applyEdits(output, modify(output, ['hooks', event], next, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  }
  return output;
}
```

The replaced entry keeps the position of the entries around it, but its own position
moves to the end of the list. The existing `planHooks` behaves the same way for relay's
own entries.

- [ ] **Step 5: Add `withAsk` to the Claude planner**

In `src/install/claude-code.js`:

```js
import { bindingsFor, planHooks, planRouteHooks, routeBindings } from './hooks.js';
// ...
export function planClaudeCode({ target, text, relayBin, nodeBin = process.execPath, subscribersPath, subscribers, evidence = null, retireFamiliar = false, withAsk = false, installedVersion }) {
  // ...existing checks and capability validation...
  let after = planHooks({ text, harness: 'claude-code', relayBin, nodeBin, subscribersPath, retireFamiliar });
  if (withAsk) after = planRouteHooks({ text: after, harness: 'claude-code', relayBin, nodeBin, rows: routeBindings('claude-code', evidence, installedVersion) });
  return { schema: 1, harness: 'claude-code', changes: after === text ? [] : [{ path: target, before: text, after }], evidence: capability.evidence };
}
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `just test-one test/install-routes.test.js test/install-capabilities.test.js test/install-claude-code.test.js test/install-hooks.test.js`
Expected: PASS. The existing installer tests are unchanged.

- [ ] **Step 7: Commit**

```bash
just test-fast && tasks check
git add src/install test/install-routes.test.js
git commit -m "feat(install): ask route bindings gated on route evidence"
```

---

### Task 12: The CLI surface: rows in ops, adoption, and wiring

**Files:**
- Modify, in ops: `cli.toml`, in an ops task worktree
- Modify: `tools/cli.toml`, `tools/cli_surface.py`, adopted with `vendored adopt`
- Modify: `src/commands.js`
- Modify: `bin/relay.js`
- Modify: `test/cli-surface.test.js`
- Test: `test/cli-interaction.test.js`

**Interfaces:**
- Consumes: `runServe` (Tasks 7 and 8), `runAsk` (Task 9), `runInbox` and `runPresence`
  (Task 10), and `planClaudeCode({ withAsk })` (Task 11).
- Produces: these commands:
  - `relay serve`
  - `relay ask --harness NAME [--handback] EVENT`
  - `relay inbox list [--since N]`
  - `relay inbox show ID`
  - `relay inbox answer ID [VALUE...] [--decline]`
  - `relay inbox defer ID`
  - `relay inbox withdraw ID`
  - `relay presence [here|away]`
  - `relay install ... --with ask`

The vendoring rule (ops `docs/specs/2026-10-01-vendoring-rollout-order-design.md`) has
two parts. `cli.toml` is an adopted file: relay may hold only a version that has landed
on ops's default branch. And it must adopt that version in the same commit as the
implementation of the rows it adds, because `test/cli-surface.test.js` asserts set
equality. So the rows land in ops first, and the adoption and every new command come
together in this task's one relay commit.

- [ ] **Step 1: Land the rows in ops**

1. File and start an ops piece:

   ```bash
   tasks add "Declare relay serve, ask, inbox and presence in cli.toml" --project ops -p 2 --size xs --complexity low --process direct -b "relay-f58531's plan Task 12: the table rows for relay's new interaction commands, adopted by relay with their implementation." --tag cross-project
   ```

   Then `tasks dep relay-<this step's id> --on ops-<new id>`.
2. In the ops checkout, create its worktree. Follow ops's own AGENTS.md: `work-link`,
   `git worktree add .worktrees/relay-cli-rows -b feat/relay-cli-rows`, lock it, then
   `just setup`, then `tasks start ops-<id>` there.
3. In ops `cli.toml`, after the relay `rollback` row, add the rows below. Add the
   `--with` option to relay's `install` row.

```toml
[[cli.relay.commands]]
path = ["serve"]
output = "none"
summary = "Run the interaction service: inbox, local socket and optional HTTP surface"

[[cli.relay.commands]]
path = ["ask"]
protocol = "harness hook: stdout is the reply; always exits 0"
summary = "Route one harness question through the inbox"
args = [{ name = "event", value = "enum", values = ["PreToolUse", "PostToolUse"], required = true }]
options = [
  { shared = "harness", role = "select", value = "enum", values = ["claude-code", "codex", "opencode"], required = true, repeatable = false },
  { names = ["--handback"], value = "none" },
]

[[cli.relay.commands]]
path = ["inbox", "list"]
verb = "list"
summary = "Questions and notices in the inbox"
options = [
  { names = ["--since"], value = "int" },
]

[[cli.relay.commands]]
path = ["inbox", "show"]
verb = "show"
summary = "One inbox entry in full"
args = [{ name = "id", value = "string", required = true }]

[[cli.relay.commands]]
path = ["inbox", "answer"]
summary = "Answer a pending question from this desk"
args = [{ name = "id", value = "string", required = true }, { name = "value", value = "string", required = false, variadic = true }]
options = [
  { names = ["--decline"], value = "none" },
]

[[cli.relay.commands]]
path = ["inbox", "defer"]
summary = "Defer a pending question to the desktop"
args = [{ name = "id", value = "string", required = true }]

[[cli.relay.commands]]
path = ["inbox", "withdraw"]
summary = "Withdraw a pending question"
args = [{ name = "id", value = "string", required = true }]

[[cli.relay.commands]]
path = ["presence"]
summary = "Show or set whether questions go to the inbox"
args = [{ name = "mode", value = "enum", values = ["here", "away"], required = false }]
```

   Add this to relay's `install` options:
   `{ names = ["--with"], value = "enum", values = ["ask"] },`.
4. Run ops's gate in that worktree (`just gate`). Its table validator rejects a
   malformed row; fix any row it names. Commit with
   `feat(cli): declare relay interaction commands`, close the ops piece
   (`tasks done ops-<id> "relay interaction rows declared"`), and merge it to ops's
   default branch by local merge. ops is a personal-profile checkout, so this merge is
   in scope. Then remove the ops worktree by its convention (unlock, `tt-report`,
   remove).

- [ ] **Step 2: Adopt the landed table into this worktree**

Run from the ops checkout:

`bin/vendored adopt --into <absolute path of .worktrees/typed-messages> cli.toml cli_surface.py`

Expected: both files are written into `tools/`. `git diff --stat tools/` shows the new
relay rows, plus any other projects' rows landed since relay's last adoption.

- [ ] **Step 3: Write the failing CLI tests**

`test/cli-interaction.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tempState } from './helpers/fixture.js';

const BIN = new URL('../bin/relay.js', import.meta.url).pathname;
const run = (p, args, input) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', input, env: { ...process.env, RELAY_STATE_DIR: p.stateDir } });
async function serve(t, p) {
  const child = spawn(process.execPath, [BIN, 'serve'], { env: { ...process.env, RELAY_STATE_DIR: p.stateDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGTERM'));
  for (let i = 0; i < 100; i++) { if (run(p, ['presence']).status === 0) return child; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('relay serve did not start');
}
test('serve, presence, and the inbox through the CLI', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), child = await serve(t, p);
  assert.equal(run(p, ['presence']).stdout, 'here\n');
  assert.deepEqual(JSON.parse(run(p, ['--json', 'presence', 'away']).stdout).presence.mode, 'away');
  const hook = spawn(process.execPath, [BIN, 'ask', '--harness', 'claude-code', 'PreToolUse'], { env: { ...process.env, RELAY_STATE_DIR: p.stateDir } });
  hook.stdin.end(JSON.stringify({ session_id: 's', cwd: '/tmp', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'toolu_cli',
    tool_input: { questions: [{ question: 'Which?', header: 'Pick', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }] } }));
  let id;
  for (let i = 0; i < 100 && !id; i++) { id = JSON.parse(run(p, ['--json', 'inbox', 'list']).stdout).entries[0]?.id; await new Promise((r) => setTimeout(r, 50)); }
  assert.equal(run(p, ['inbox', 'answer', id, 'q1=o2']).status, 0);
  const [line] = await Promise.all([new Promise((r) => createInterface({ input: hook.stdout }).once('line', r)), new Promise((r) => hook.once('exit', r))]);
  assert.deepEqual(JSON.parse(line).hookSpecificOutput.updatedInput.answers, { 'Which?': 'B' });
  assert.equal(run(p, ['inbox', 'show', id, '--json']).status, 0);
  child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r));
  const down = run(p, ['--json', 'presence']);
  assert.equal(down.status, 1); assert.match(JSON.parse(down.stderr).error.detail, /^SERVE_UNAVAILABLE/);
});
test('usage errors exit 2', async (t) => {
  const p = await tempState(t);
  for (const args of [['inbox'], ['inbox', 'bogus'], ['ask', '--harness', 'claude-code', 'Stop'], ['ask', '--harness', 'codex', 'PreToolUse'], ['presence', 'gone'], ['serve', 'extra']]) {
    assert.equal(run(p, args).status, 2, args.join(' '));
  }
});
```

- [ ] **Step 4: Run the CLI tests and see them fail**

Run: `just test-one test/cli-interaction.test.js test/cli-surface.test.js`
Expected: FAIL. The new commands are unknown, and the declared-surface test reports the
adopted rows as `tableOnly`.

- [ ] **Step 5: Declare the commands**

In `src/commands.js`, add rows that mirror the table exactly (same summaries, args and
options), after `rollback`:

```js
  { path: ['serve'], summary: 'Run the interaction service: inbox, local socket and optional HTTP surface', output: 'none' },
  { path: ['ask'], summary: 'Route one harness question through the inbox', protocol: 'harness hook: stdout is the reply; always exits 0',
    args: [{ name: 'event', value: 'enum', values: ['PreToolUse', 'PostToolUse'], required: true }],
    options: [{ names: ['--harness'], value: 'enum', values: HARNESSES, required: true }, { names: ['--handback'], value: 'none' }] },
  { path: ['inbox', 'list'], summary: 'Questions and notices in the inbox', options: [{ names: ['--since'], value: 'int' }] },
  { path: ['inbox', 'show'], summary: 'One inbox entry in full', args: [{ name: 'id', value: 'string', required: true }] },
  { path: ['inbox', 'answer'], summary: 'Answer a pending question from this desk',
    args: [{ name: 'id', value: 'string', required: true }, { name: 'value', value: 'string', required: false, variadic: true }],
    options: [{ names: ['--decline'], value: 'none' }] },
  { path: ['inbox', 'defer'], summary: 'Defer a pending question to the desktop', args: [{ name: 'id', value: 'string', required: true }] },
  { path: ['inbox', 'withdraw'], summary: 'Withdraw a pending question', args: [{ name: 'id', value: 'string', required: true }] },
  { path: ['presence'], summary: 'Show or set whether questions go to the inbox', args: [{ name: 'mode', value: 'enum', values: ['here', 'away'], required: false }] },
```

Add `{ names: ['--with'], value: 'enum', values: ['ask'] }` to `install`'s options.
Replace `commandAt` with longest-path matching, and keep `commandAt` for the `help`
lookup of one word:

```js
/** The command whose path is the longest prefix of argv; rest is what follows it. */
export function commandFor(argv) {
  const matches = COMMANDS.filter((c) => c.path.every((w, i) => argv[i] === w)).sort((a, b) => b.path.length - a.path.length);
  return matches.length ? { cmd: matches[0], rest: argv.slice(matches[0].path.length) } : null;
}
export function commandAt(...words) {
  return COMMANDS.find((c) => c.path.length === words.length && c.path.every((w, i) => w === words[i])) ?? null;
}
```

In `rootHelp`, list each command by `c.path.join(' ')`, padded to 15.

- [ ] **Step 6: Wire the commands in `bin/relay.js`**

- **Routing.** Route with `commandFor(argv)` in place of `commandAt(argv[0])`, and set
  `cmdName = cmd.path.join('-')`. The `help` branch uses `commandAt(...rest)`. A bare
  `relay inbox`, or `relay inbox` followed by an unknown word, is a usage error (exit 2)
  naming `list, show, answer, defer, withdraw`.
- **`serve`.** It takes no arguments. Create an `AbortController`, abort it on SIGTERM
  and SIGINT, and `await runServe({ signal })`. Return 0.
- **`ask`.** Parse strictly: `--harness NAME` first, an optional `--handback`, then one
  `EVENT` in `PreToolUse|PostToolUse`. A harness outside the set fails with the hook
  parser's message, `--harness must be one of claude-code, codex, opencode, got "<value>"`.
  The enum-baseline test requires both the flag and the value in stderr. A known harness
  other than `claude-code` is a usage error: `the ask route exists only for claude-code`. Call
  `runAsk({ nativeEvent, handback, stdin, socketPath: servePaths(paths().stateDir).socketPath })`,
  emit its stdout and stderr, and return its exit code.
- **`inbox <action>`.** Parse `--since N` (list) and `--decline` (answer) with the
  existing `flags` helper. Positional arguments go to `args`. Call `runInbox`, then print
  `json` under `--json` or `text` otherwise.
- **`presence [mode]`.** A mode outside `here|away` is a usage error. Call `runPresence`
  and print the same way as `inbox`.
- **`install`.** Pass `withAsk: f['--with'] === 'ask'` to `planClaudeCode`. With it,
  also pass `installedVersion`, the first word of
  `execFileSync('claude', ['--version'], { encoding: 'utf8' })`. A missing `claude` is an
  error (`HARNESS_UNAVAILABLE`), never a skipped check. `--with ask` on another harness
  is a usage error. Tests replace `claude` with a stub script on `PATH` that prints the
  evidence's version.

Errors with `code` print through the existing JSON or pretty error path (exit 1).
`USAGE` exits 2.

- [ ] **Step 7: Extend the surface tests**

In `test/cli-surface.test.js`:

- **Enum baselines.** Add these two to the `baselines` array, with the `--with` baseline
  using a claude-code target fixture that has an evidence file holding all five route
  rows passed:
  - `[['ask'], '--harness', ['ask', '--harness', 'claude-code', 'PostToolUse']]`. With
    no service running, the hook passes through and exits 0.
  - `[['install'], '--with', ['install', '--harness', 'claude-code', '--subscribers', subscribers, '--target', target, '--evidence', evidencePath, '--with', 'ask']]`.
- **The JSON-candidates test.** `inbox list` and `presence` need a running service; the
  other `inbox` actions need an id. Start `relay serve` for this test, as
  `test/cli-interaction.test.js` does, and give it an argument map:

  ```js
  const ARGS = { 'inbox show': [id], 'inbox answer': [id, 'q1=o1'], 'inbox defer': [id], 'inbox withdraw': [id] };
  ```

  Here `id` is a question created before the loop by a `relay ask` child with presence
  `away`. Order the loop so `defer` runs before `answer` and `withdraw` after it; the
  `withdraw` then exits 1 with `ANSWERED`. Exclude `inbox withdraw` from the candidates
  and assert its error envelope separately.

- [ ] **Step 8: Run the CLI suites and see them pass**

Run: `just test-one test/cli-interaction.test.js test/cli-surface.test.js test/cli.test.js test/install-cli.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
just test-fast && tasks check
git add tools/cli.toml tools/cli_surface.py src/commands.js bin/relay.js test/cli-surface.test.js test/cli-interaction.test.js
git commit -m "feat(cli): relay serve, ask, inbox and presence"
```

---

### Task 13: Documentation, packaging and the Node 22 floor

**Files:**
- Modify: `docs/api.md`, adding a section "Interaction messages and relay serve"
- Modify: `README.md`
- Create: `docs/runbooks/inbox-service.md`
- Modify: `package.json` (`files`)
- Modify: `test/pack.test.js`

- [ ] **Step 1: Document the contract**

Add a section to `docs/api.md` that states, in the style of the existing sections:

- the message and entry types, in TypeScript notation copied from spec §4;
- the states and transitions, summarized from spec §5.1 and §5.2, with a link to the
  spec for the full table;
- the socket protocol table from Task 7;
- the HTTP table and guard from Task 8;
- the CLI commands from Task 12;
- the error codes (`ALREADY_ANSWERED`, `ANSWERED`, `WITHDRAWN`, `EXPIRED`, `RELEASED`,
  `UNDELIVERABLE`, `STALE`, `INVALID_ANSWER`, `LOCAL_ONLY`, `NOT_WAITER`,
  `NOT_ANSWERED`, `NOT_HANDED`, `NOT_SUPERSEDABLE`, `ID_CONFLICT`, `NOT_FOUND`,
  `SERVE_RUNNING`, `SERVE_UNAVAILABLE`, `STORE_FAILED`, `INVALID_CONFIG`, `INVALID_ENTRY`,
  `HARNESS_UNAVAILABLE`);
- that no root package export is added in v1. The interaction modules are reached
  through the CLI and the socket, not through a library API.

In `README.md`, replace "no installer, remote publication or consumer migration in R2"
with a sentence naming `relay serve` and the inbox and linking the new runbook. Keep the
line that no live hook is installed by this package.

- [ ] **Step 2: Write the operator runbook**

`docs/runbooks/inbox-service.md` must cover:

1. **The user unit.** Write it out in full, with paths written as `%h` placeholders:

```ini
[Unit]
Description=relay serve: interaction inbox

[Service]
ExecStart=/usr/bin/env node %h/<relay checkout>/bin/relay.js serve
Environment=RELAY_HTTP_PORT=3340
Environment=RELAY_SERVE_HOST=<host>.<tailnet>.ts.net
Environment=RELAY_SERVE_LOGIN=<tailscale login>
Restart=on-failure

[Install]
WantedBy=default.target
```

2. **Phone access.** `tailscale serve --bg --https=443 http://127.0.0.1:3340`, its
   prerequisites (MagicDNS and HTTPS certificates), and how to remove it
   (`tailscale serve --https=443 off`). On any port other than 443, `RELAY_SERVE_HOST`
   includes the port (`<host>.<tailnet>.ts.net:8443`), because Tailscale passes the
   incoming `Host` through. The phone's `Origin` then carries the same port.
3. **Installing the route.** First run the probes (`docs/runbooks/answer-route-probes.md`).
   Then plan with `relay install --harness claude-code --subscribers ... --target ... --evidence docs/evidence/claude-code-answer-routes.json --with ask`,
   inspect the artifact, and apply with `--apply --artifact FILE`. Roll back with
   `relay rollback --artifact FILE`.
4. **Presence.** `relay presence away` before leaving the desk and `relay presence here`
   on return. The phone can do the same through `PUT /v1/presence`.
5. **Recovery.** What `inbox/rejected/` holds and that it is never cleaned
   automatically, what `SERVE_RUNNING` means, and what a stale `serve.lock` after a
   crash means: it is reclaimed on the next start when its holder is dead. Point to
   `docs/runbooks/registry-lock-repair.md` for `LOCK_REPAIR_REQUIRED`.

- [ ] **Step 3: Ship the schema in the package**

Add `"schemas/"` and `"docs/runbooks/inbox-service.md"` to `package.json` `files`. In
`test/pack.test.js`, add `'schemas/interaction/message.schema.json'` to the expected
names list.

- [ ] **Step 4: Run the gate on both runtimes**

Run: `just gate`
Then: `PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH just gate`
Expected: both PASS. Record both test counts in the commit body.

- [ ] **Step 5: Commit**

```bash
tasks check
git add docs/api.md README.md docs/runbooks/inbox-service.md package.json test/pack.test.js
git commit -m "docs: interaction messages, relay serve runbook and packaging"
```

---

### Task 14: Live end to end, with the user present (acceptance 7)

**Files:**
- Create: `docs/runbooks/inbox-e2e-2026-10.md`, the record of the run

This task needs the user: a second tailnet device (the phone) and a live Claude Code
session. Park it with `--waiting-on user --reason review` until they are ready. Nothing
here touches the user's real Claude settings or relay's real state directory.

- [ ] **Step 1: Prepare an isolated run**

1. Create a scratch directory S (`mktemp -d`) holding `state/` (mode 0700) and
   `settings.json`.
2. Generate the settings. Run `relay install --harness claude-code` from the worktree's
   `bin/relay.js` with `--target S/settings.json` (seeded as `{}`), an empty subscribers
   file, `--evidence docs/evidence/claude-code-answer-routes.json` and `--with ask`.
   Then remove every non-`ask` entry from the generated `S/settings.json`, so only the
   route's two hooks remain.
3. Start the service from the worktree:

   ```bash
   RELAY_STATE_DIR=S/state RELAY_HTTP_PORT=3341 RELAY_SERVE_HOST=<host>.<tailnet>.ts.net:8443 RELAY_SERVE_LOGIN=<login> node .worktrees/typed-messages/bin/relay.js serve
   ```

   Run it as a background command whose timeout covers the session. Record its pid.
4. Expose it on the tailnet. This is a host change, so ask the user first, naming the
   command and its removal:

   ```bash
   tailscale serve --bg --https=8443 http://127.0.0.1:3341
   ```

   Record it as a host pointer in a task note: what (tailscale serve on port 8443), from
   (none), to (`127.0.0.1:3341`), and how to restore (`tailscale serve --https=8443 off`).
5. Set presence away: `RELAY_STATE_DIR=S/state node .worktrees/typed-messages/bin/relay.js presence away`.

- [ ] **Step 2: Run the three cases**

The user starts `claude --settings S/settings.json` in a scratch workspace and prompts it
to ask one AskUserQuestion. Each hook command names the worktree's
`bin/relay.js`, and the hook must reach this run's service, so export
`RELAY_STATE_DIR=S/state` in the shell that starts `claude`.

1. **Answered from the phone.** From the phone, run
   `curl https://<host>.<tailnet>.ts.net:8443/v1/inbox`, then POST an answer with
   `Origin: https://<host>.<tailnet>.ts.net:8443`, port included. Tailscale passes the
   incoming `Host` through unchanged, so the guard sees `<host>.<tailnet>.ts.net:8443`.
   Before the cases, check that a GET from the phone returns 200 and not 403. Expected: the Claude turn continues with the chosen label, and
   `GET /v1/inbox/<id>` shows `consumed`.
2. **Deferred.** A new question; POST `/defer` from the phone. Expected: the native
   question appears in the terminal, and after answering there the entry is `released`
   with the native answer recorded.
3. **Withdrawn from the desk.** A new question;
   `relay inbox withdraw <id>`. Expected: the Claude turn ends with the denial reason,
   and the entry is `withdrawn (user)`.

- [ ] **Step 3: Restore and record**

Run `tailscale serve --https=8443 off`, stop the service with SIGTERM to its pid, and
note the restore on the task. Write `docs/runbooks/inbox-e2e-2026-10.md` with the
following, and no session ids or personal identifiers:

- the date and the Claude version;
- each case's observed entry states and the time to each transition;
- anything that differed from the expected outcome.

- [ ] **Step 4: Commit**

```bash
tasks check
git add docs/runbooks/inbox-e2e-2026-10.md
git commit -m "docs: record the inbox end-to-end run"
```
