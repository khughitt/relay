# Detached Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent can post a durable question without a waiter, stop, and later
consume its saved answer through the private socket or CLI.

**Architecture:** Extend the existing lifecycle and strict durable validator;
use the inbox's serialized operations and socket protocol. Add inbox ask/take and
the two CLI options through the existing command declaration and desk runner.
Keep native handoff behavior on its existing path.

**Tech Stack:** Node >=22, ES modules, checked JavaScript/JSDoc, Node built-ins,
Node test runner through the justfile. No new dependency.

**Spec:** `docs/specs/2026-10-24-detached-ask-design.md`, approved by the user at
relay commit `94555165894c8bb47d314020aa1296b3895911fe`. Read that frozen revision
and this plan before execution. The parent task is relay-8d8e86.

**Status:** Draft for user review. Default execution is inline with
superpowers:executing-plans: three sequential tasks share a lifecycle and service
interface, so keeping the implementation context is useful. The execution skill
and repository rules retain independent final review and corrective rounds.

## Global Constraints

- A question is detached exactly when `question.body.native === null`.
- Detached route: `{waiter: null, handback: false}`; sender agent, recipient user.
- Maximum expiry: `createdAt + 7 * 24 * 60 * 60 * 1000` milliseconds; refuse
  `createdAt > now + 1000` with `INVALID_MESSAGE` before replay lookup. Sample
  `now` once in the queued ask. Do not clamp against service time.
- Save detached questions in both presence modes. No waiter ownership, state
  pushes to an asking connection, or asker-loss transition for detached entries.
- Take only detached answered/undeliverable entries to consumed, with cause `take`;
  consumed replay is unchanged. Keep null `handedAt`/`observed`, no observations.
- Entry schema stays 1. No new message kind, mode field, dependency, store, or
  root export. `refusal:STALE` rows count attempts, including identical retries,
  without storing the refused message, its ids, surface, or values.
- Retention remains 30 days after a terminal entry's last durable change, with
  existing supersession retention. A repeated take does not extend retention.
- CLI surface values: `cli|terminal`, default `cli`; withdrawal reasons:
  `user|asker`, default `user`. Socket/HTTP surface contracts remain as specified.
- Preserve stdout `{entry: ...}` and existing stderr error envelopes under
  `--json`; usage exits 2, service/operation/file failures exit 1.
- Work in `.worktrees/detached-ask` on `feat/detached-ask`. Paths in this plan are
  relative to that workspace for commands; paths shown to the user carry its
  `.worktrees/detached-ask/` prefix.
- No live service, host launcher, installation, push, PR, or flows change.
  Older binaries can quarantine take/refusal histories; document the downgrade
  limit, without adding a compatibility layer.
- New/changed subprocess tests construct environments key by key, with a
  test-owned HOME and fake credential values when needed. They inherit only
  named nonsecret inputs such as PATH, never the full host environment.
- Start each step task, run trial-arm and follow its result; close each step on
  this branch before integration. Use conventional commits and `tasks check`.

## Review Focus

1. A queued ask crosses the one-second boundary: use service operation time,
   reject without sequence allocation, and preserve accepted replay after time
   advances or a stated refusal after clock rollback (Task 2).
2. A detached retry collides with a live native question id: invalid routes and
   conflicting messages must not steal native waiter ownership (Task 2).
3. An answer expires between a client's show and take: clock-before-take must
   consume the retained undeliverable answer, never lose it (Task 2).
4. A refusal is persisted but its response is lost: an identical stale request
   adds another attempt, while an accepted answer retry adds nothing (Tasks 1–2).
5. No service is running: a native question file fails locally, but a syntactically
   valid detached file with the wrong parties fails `SERVE_UNAVAILABLE` because
   party direction is service validation (Task 3; user's nonblocking spec nit).

## File responsibilities and execution setup

- `src/interaction/lifecycle.js`: take, detached invariants, stale history.
- `src/routes/index.js`: detached expiry maximum alongside native route lookup.
- `src/serve/inbox.js`: route/party/time checks, presence, serialized take.
- `src/serve/socket.js`: detached ask without ownership and take dispatch.
- `src/types.js`, `test/types/contracts.js`: typed take response and call site.
- `src/commands.js`, `bin/relay.js`, `src/cli/desk.js`, `tools/cli.toml`: public CLI.
- Existing lifecycle/store/inbox/socket/HTTP/CLI tests: the regression boundaries.
- Reused CLI subprocess helpers: explicit environment and owned temporary home.
- `docs/api.md`, `docs/runbooks/inbox-service.md`: current behavior when implemented.

Execution Setup comes before any code or test change. Re-enter the worktree skill,
reuse the hydrated and locked workspace, inspect its status and run `just setup`
if dependency inputs changed or hydration is absent. Run `just test`, record its
actual count and command on the task, and resolve any failing baseline before
implementation. A run selecting zero tests is not a baseline. Setup already ran
when this workspace was created; no full-suite baseline has run during design.
After the user approves this frozen plan, unblock the three step tasks below
and start Task 1; their dependency chain preserves the execution order.

Use file-only focused commands below because the existing `test-one` recipe does
not preserve quoted runner arguments. Then `just test-fast` before every code
commit; it intentionally runs the same full suite as `just test`. Do not invoke
the test runner directly. `just check` includes strict type and task checks.

The final gate must also run on an already installed Node 22 runtime, selected
for that command with `PATH="<node 22 bin>:$PATH" just gate`, as the release
runbook documents. Locate the installed runtime before execution and record its
version; do not replace a shared launcher or install a runtime as a fallback.

---

### Task 1: Persist detached consumption and stale refusal history

**Files:** Modify `src/interaction/lifecycle.js`; test
`test/interaction-lifecycle.test.js`, `test/interaction-store.test.js`.

**Interfaces:**
- Add `applyTake(entry: Entry, now: number): Result` to the lifecycle module.
  Notice → `NOT_A_QUESTION`; native question → `UNSUPPORTED_ROUTE`; detached
  pending → `NOT_ANSWERED`; withdrawn/expired → matching closure code.
  Answered/undeliverable → consumed; consumed → unchanged.
- Preserve `applyAnswer(entry, message, now): Result<QuestionEntry>`, but STALE
  now returns `changed: true`, pending entry with `refusal:STALE`, and the same
  error `{code: 'STALE', revision: <expected>}`. Other refusals keep their behavior.
- Preserve existing `applyAskerGone`, `applyConfirm`, and `validateEntry`
  signatures. Detached asker loss is unchanged; detached confirmation returns
  `NOT_HANDED`, including for expired questions.

- [ ] **Step 1: Add lifecycle regression tests.** Use existing question/answer
  factories, `step`, `stamped`, and `roundtrip` helpers. Build a detached pending
  fixture with `L.createEntry(questionMessage({body: {native: null}}),
  {handback: false, waiter: null, now: NOW})`. Add these named tests and assertions:

  ```js
  // "detached take consumes an answer without native handoff"
  const a = step(L.applyAnswer(e, answerMessage(e.question), T));
  const taken = step(L.applyTake(a, T + 1));
  assert.deepEqual([taken.state, taken.handedAt, taken.observed, taken.observations],
    ['consumed', null, null, []]);
  assert.deepEqual(taken.answer, a.answer);
  assert.equal(taken.log.at(-1).cause, 'take');
  assert.deepEqual(L.applyTake(taken, T + 2),
    {entry: taken, changed: false, error: null});
  assert.deepEqual(roundtrip(taken), stamped(taken));

  // "detached take accepts expiry-held answers and declines"
  // For ordinary and declined answers: applyClock at expiresAt, assert
  // undeliverable, then take and assert consumed and the identical saved answer.

  // "detached receipt paths and take refusals preserve the entry"
  // Table: pending/NOT_ANSWERED, withdrawn/WITHDRAWN, expired/EXPIRED,
  // native answered/UNSUPPORTED_ROUTE, notice/NOT_A_QUESTION.
  // Each applyTake result has changed === false and the exact original entry.
  // applyAskerGone is unchanged for detached pending/answered/undeliverable;
  // applyHanded with null or HANDLE gets NOT_WAITER; applyConfirm on detached
  // pending/answered/expired/consumed gets NOT_HANDED, with no observation.
  ```

  Add `"stale refusal records each attempt without accepted message content"`:
  artifact revision `r1`, submitted `r0`; assert changed true, error STALE/r1,
  pending, answer null, messages unchanged, cause `refusal:STALE`, updated time
  equal to operation time. Repeat the identical message and assert another row.
  Then accept revision r1 and retry its answerId: changed false, no new row.
  Amend the existing STALE assertion that uses `refused()` (it asserts no change);
  keep invalid-value and local-authorization checks ahead of stale history.

  Add `"strict validation distinguishes detached and native receipt evidence"`:
  accept take and stale roundtrips; reject a native take cause, pending-to-consumed
  take, consumed-to-consumed take, detached nonnull waiter/true handback,
  wrong parties, any native receipt/release/asker-loss history on detached
  entries, nonnull handedAt/observed/observations, and refusal rows outside
  pending artifact-bound history. Keep existing native confirmation roundtrips.
  Test detached defer → pending/desktop with accepted defer history, its replay,
  pending withdrawal, expiry, and supersession using the existing shared actions.

- [ ] **Step 2: Add store recovery tests and prove RED.** In
  `"detached take and stale evidence survive strict reload"`, put a detached
  pending entry, persist two stale results, then a matching answer and take;
  reload and assert exact saved messages, answer, log, null handoff fields,
  consumed state, and no rejected entries. A put of a forged native take must
  throw `INVALID_ENTRY` before increasing `store.seq()`.
  Run `just test-one test/interaction-lifecycle.test.js test/interaction-store.test.js`.
  Expected RED: missing applyTake and stale refusal still unchanged. Record it.

- [ ] **Step 3: Implement the lifecycle contracts.** Reuse `move`, `annotate`,
  `keep`, and `refuse`; do not add another history structure. Annotate STALE and
  return its error together. Update durable route/state/history evidence checks
  to permit only the approved take/refusal cases. Do not loosen native handoff
  evidence or generic message validation. The store writer needs no new format.

- [ ] **Step 4: Verify GREEN and commit.** Rerun the focused command, then
  `just test-fast`, `just check`, `git diff --check`. All must exit 0 with actual
  tests selected. Commit its code/tests with
  `feat: persist detached question consumption and stale refusals`, then close
  this child task with the commit and verification evidence.

### Task 2: Route detached questions through the service and private socket

**Files:** Modify `src/routes/index.js`, `src/serve/inbox.js`,
`src/serve/socket.js`, `src/types.js`, `test/types/contracts.js`;
test `test/serve-inbox.test.js`, `test/serve-socket.test.js`,
`test/serve-http.test.js`. Update `docs/api.md` for the service contracts here.

**Interfaces:**
- Consume Task 1's `applyTake(entry, now): Result`.
- `expiryLimit(question: QuestionMessage): number`: return
  `7 * 24 * 60 * 60 * 1000` for native null; retain route lookup otherwise.
  `expectAnswers(entry)` remains native-only.
- Keep `inbox.ask(message, {handback, waiter}): Promise<InboxResult>`; validate
  detached route, parties, and timestamp before clamp/replay in its queue.
- Add `inbox.take(id: string): Promise<{entry: Entry|null, error: Refusal|null}>`
  through the existing `on(id, fn)` queue and `commit` path.
- Socket `{op:'take', id}` validates `isUuid(id)` or throws INVALID_MESSAGE.
  Extend `SocketResponses` with `take: {entry: AnsweredEntry}`; compile-time
  tests must show a successful take exposes an answer and lacks list fields.

- [ ] **Step 1: Add service tests for admission and replay.** Reuse the inbox
  test's controlled clock; detached asks use null waiter, false handback.
  Name tests `"detached ask is stored here and away with a seven-day bound"`,
  `"detached admission checks timestamp and parties before replay"`, and
  `"detached supersession preserves existing ownership and answer rules"`.

  ```js
  // In the existing setup(t) fixture, advance(ms) changes the service clock.
  const q = questionMessage({createdAt: NOW,
    body: {native: null, expiresAt: NOW + 30 * 24 * 3_600_000}});
  const r = await inbox.ask(q, {handback: false, waiter: null});
  assert.equal(r.entry.question.body.expiresAt, NOW + 7 * 24 * 3_600_000);
  advance(1000);
  assert.equal((await inbox.ask(q, {handback: false, waiter: null})).entry.seq,
    r.entry.seq);
  ```

  In isolated fixtures accept `createdAt === now + 1000`; reject `now + 1001`
  and `now * 1000` with INVALID_MESSAGE and no sequence/file. Queue the ask
  behind an existing held write, move the controlled clock before releasing it,
  and assert admission uses its queued operation time. After acceptance move
  the clock backward beyond allowance: replay refuses without changing the
  saved entry. Reject null-native wrong parties and route combinations even
  on replay; preserve native 23-hour clamp, native presence passthrough, and
  unsupported Codex/OpenCode native routes. Update the old test that treats
  every native-null question as unsupported.

  Supersede pending detached entries from the same agent, including a pending
  native predecessor; assert both durable events and predecessor withdrawal.
  Refuse other agents and answered predecessors with the existing codes.
  A stale replacement already expired must not withdraw its predecessor.

- [ ] **Step 2: Add service durability/clock tests and prove RED.** Name the
  tests `"take consumes after show crosses expiry and is concurrent-idempotent"`,
  `"detached retention starts at undeliverable and resets once at take"`, and
  `"stale refusal persists before error publication and fails closed on IO"`.
  Assert the following using the existing controllable clock and IO injection:

  - Answer, read, advance to expiresAt, then take: log ends with expiry → take,
    consumed retains answer. Parallel takes return the same final sequence;
    parallel answers still have one winner. Missing id returns NOT_FOUND.
  - Reopen pending and answered detached entries before/after their deadlines;
    startup sweep yields expired/undeliverable as appropriate, with no quarantine.
    No-op asker loss does not change state beyond clock application.
  - Undeliverable is retained at `updatedAt + RETENTION_MS - 1`, pruned at
    `updatedAt + RETENTION_MS`. Taking first resets that deadline; repeated take
    does not. After prune, take gets NOT_FOUND and sequence high-water survives.
    Existing nonterminal replacement retention stays covered by store tests.
  - Subscribe/watch, send a stale answer twice, assert two increasing sequences,
    published pending refusal rows, STALE/r1 responses, and reload persistence.
    Inject rename failure during a refusal write: STORE_FAILED, no published
    success/refusal entry, halted resolves, later operations refuse; restart
    recovers whichever valid entry reached disk using existing store rules.

  Run `just test-one test/serve-inbox.test.js`. Expected RED: detached ask is
  unsupported and inbox.take is absent. Record before implementation.

- [ ] **Step 3: Add socket and HTTP regression tests; prove RED.**
  Tests use in-process service fixtures and direct connections; no new child
  process is needed. Add `"detached ask has no owner and survives socket close
  and restart"`: ask here, close the asking connection, await its server-side
  close using an event/barrier, reopen, answer on another connection, take,
  retry, and assert no native state pushes or liveness probe for that entry.
  Use an inbox.askerGone spy and await the restart recheck barrier with fake
  processOps; do not use a sleep to infer no owner.

  Add `"detached collision cannot steal a native waiter"`: an existing native
  pending question's id is reused by a native-null message and by invalid route
  variants; get ID_CONFLICT/INVALID_MESSAGE as appropriate, then answer the
  original and assert its original waiter still receives the state. Add malformed
  take id, notice/native/pending/closed take refusals, and watch-visible take.

  Extend HTTP's existing STALE/409 regression: assert stored pending refusal
  row and increasing sequence after an identical retry. Preserve phone/desktop
  overrides and remote authorization refusal (existing tests).
  Run `just test-one test/serve-socket.test.js test/serve-http.test.js`.
  Expected RED: detached asks are unsupported and take is unknown. Task 1
  already supplies the shared stale lifecycle, so HTTP stale assertions may
  pass already; do not count a passing HTTP case as RED evidence for the missing
  socket behavior.

- [ ] **Step 4: Implement service and socket behavior; verify GREEN.** Add the
  expiry branch and inbox checks. Bypass presence passthrough only for detached
  questions; add serialized take without a new writer. In the socket's ask
  handler, after message kind/handback validation, branch on native null:
  require null waiter, call inbox.ask, and return without touching `waiters` or
  `socket.waiting`. Preserve the existing native reservation/restore machinery.
  Add the take handler and response type. Restart's null-waiter skip stays in place.
  Add compile-time take-response assertions to test/types/contracts.js.
  Update API's
  ask/take fields, lifecycle, seven-day admission rule, error codes, refusal
  history semantics, retention, and downgrade limit; keep CLI additions for Task 3.
  Rerun the inbox/socket/HTTP focused commands, then `just check` for the new
  typed response. Expected: all selected tests pass and strict checking exits 0.

- [ ] **Step 5: Verify and commit.** Run the Task 2 focused files together,
  `just test-fast`, `just check`, and `git diff --check`. Commit with
  `feat: serve detached inbox questions and explicit take`, then close the child
  with the commit and verification evidence.

### Task 3: Expose detached asks and receipt through the CLI

**Files:** Modify `src/commands.js`, `bin/relay.js`, `src/cli/desk.js`,
`tools/cli.toml`, `test/cli-interaction.test.js`, `test/cli-desk.test.js`,
`test/cli-surface.test.js`, `test/helpers/cli-interaction.js`,
`test/helpers/spawn-lines.js`, `docs/api.md`, `docs/runbooks/inbox-service.md`.

**Interfaces:**
- Extend `runInbox` options with `file?: string`, `surface?: 'cli'|'terminal'`
  (default cli), `reason?: 'user'|'asker'` (default user). Keep its other options
  and `{json, text}` result. Ask uses file and no positional args; take uses id.
- CLI declarations and TOML agree: inbox ask requires `--file PATH`; take
  requires ID; answer gets surface enum cli/terminal; withdraw gets reason enum
  user/asker. Existing --json/--pretty placement and --decline semantics stay.
- Read/parse/normalize the file before `withSocket`; fail INVALID_MESSAGE for
  malformed/non-question input and UNSUPPORTED_ROUTE for a valid native question.
  Party direction and future timestamp are service checks. **Accepted nit:**
  a valid wrong-party detached file costs one connection; with no service its
  error is SERVE_UNAVAILABLE, with service it is INVALID_MESSAGE. No duplicate
  CLI party validator is planned.
- Take sends the socket operation directly, without a preliminary get that could
  change its refusal semantics. Asker withdrawal sends from `entry.question.from`
  to `{kind:'user'}`; default user withdrawal keeps the existing direction.

- [ ] **Step 1: Make the reused subprocess fixtures explicit before RED.**
  Prepare the environment construction below before running any new test,
  including the feature's RED run. Add an isolation check using these safe
  helpers: a synthetic parent-only secret must not reach a child, and the
  child's HOME must belong to the fixture. Run it with
  `just test-one test/cli-interaction.test.js` before adding the feature tests.
  No host credential is read or printed, even on an expected failure.
  `cliEnv(p, extra)` builds PATH, HOME under p.stateDir, USER=test-user,
  RELAY_STATE_DIR, XDG_CONFIG_HOME/XDG_STATE_HOME under the fixture, and
  GIT_CONFIG_GLOBAL=/dev/null, GIT_CONFIG_NOSYSTEM=1 key by key. Create the home.
  Extra values at call sites are explicit test inputs (RELAY_FORMAT, HTTP config,
  etc.), never an inherited environment. Inspect all helper callers.
  `spawnLines` must pass its constructed environment directly to spawn, with an
  owned temporary home and explicit PATH/USER/git isolation for its default
  fixture callers; keep its SIGKILL-and-await cleanup. Remove its process.env
  spread so it cannot reintroduce host variables behind cliEnv. Change
  cli-surface's local run helper to use cliEnv too. Do not retrofit unrelated
  subprocess tests outside these reused helpers.

- [ ] **Step 2: Add the real CLI regression and prove RED.** Use `tempState`,
  `serveCli`, and `runCli`; service and command children use Step 1's environment.
  Name the test `"detached CLI ask survives its process and take is idempotent"`:

  ```js
  // q is questionMessage with createdAt: Date.now(), native: null,
  // expiresAt: createdAt + 7 * 24 * 3_600_000; file is in p.stateDir.
  const ask = runCli(p, ['inbox', 'ask', '--file', file, '--json']);
  assert.equal(ask.status, 0, ask.stderr);
  assert.equal(JSON.parse(ask.stdout).entry.state, 'pending');
  const answered = runCli(p, ['inbox', 'answer', q.id, 'q1=o2',
    '--surface', 'terminal', '--json']);
  assert.equal(answered.status, 0, answered.stderr);
  assert.equal(JSON.parse(answered.stdout).entry.answer.body.surface, 'terminal');
  const first = runCli(p, ['inbox', 'take', q.id, '--json']);
  const again = runCli(p, ['--json', 'inbox', 'take', q.id]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(first.stdout).entry.state, 'consumed');
  assert.deepEqual(JSON.parse(first.stdout), JSON.parse(again.stdout));
  ```

  Show the pending entry after the ask process exits. Add second-question tests
  for default cli surface, terminal decline, default user withdrawal, and asker
  withdrawal's exact from/to parties. In controlled in-process desk tests cover
  take of an undeliverable answer and pretty receipt labels.

  Add `"ask-file local validation and service validation stay distinct"`:
  without service, malformed JSON/non-question → INVALID_MESSAGE; native
  question → UNSUPPORTED_ROUTE; valid detached question with wrong sender or
  recipient → SERVE_UNAVAILABLE. With service, those party cases → INVALID_MESSAGE
  and no entry. Missing file → ENOENT once, with filename, empty stdout, exit 1.
  Assert error.kind is inbox_failed and detail starts with the exact code.

  Add parser cases for missing/repeated --file, unexpected id on ask, missing or
  extra take args, invalid/repeated surface/reason options, phone/desktop surface,
  and decline with item tokens: exit 2 before connecting. Update command-table
  parity and enum baselines for both new enums using real pending questions.
  Run `just test-one test/cli-interaction.test.js test/cli-desk.test.js test/cli-surface.test.js`.
  Expected RED: commands/flags unknown. Record failures, not just exit status.

- [ ] **Step 3: Implement the CLI contracts.** Update declarations and TOML
  together, branch ask argument validation before the generic needs-id path,
  and pass the new options to runInbox. Read files with Node built-ins; wrap a
  read failure using its original code and `cannot read question file <quoted path>`
  so the existing formatter adds one code prefix. Keep normalized question data,
  raw stderr envelopes, winning-answer details, and existing pretty labels.
  Reuse reply construction, changing from/to only for asker withdrawal.

- [ ] **Step 4: Update reference documents and verify GREEN.** Complete the API
  CLI rows and service runbook: presence applies native passthrough only to native
  questions; detached questions are always stored. Document ask-file, take,
  surface/reason defaults, validation boundary, receipt/retention, refused-attempt
  counting, and older-reader quarantine risk. Verify the packaged schema still
  accepts existing native-null messages and needs no format change.
  Rerun focused CLI tests, then `just test-fast`, `just check`, `git diff --check`.
  Commit with `feat: add detached inbox ask and take commands`; keep the child
  open through the whole-branch gates in Step 5.

- [ ] **Step 5: Verify the whole branch and hand it to review.** Run `just gate`
  on the development runtime and `PATH="<node 22 bin>:$PATH" just gate` on the
  installed floor. Record versions, commands and actual counts. Use only the
  worktree executable in any further smoke test. No live service is required.
  Once both gates pass, close this child with the code commit and verification
  evidence. Dispatch the independent whole-branch review required by executing-plans;
  persist its full report and note the review before acting. Apply the repository's
  corrective-round and ruling rules to findings. Complete the parent task only
  after verification/review, on this branch before local integration. A local
  merge may follow the personal-profile rule; publishing remains outside scope.

## Planning review and handoff

Step tasks: Task 1 is relay-1aee2b, Task 2 is relay-420059 (depends on Task 1),
and Task 3 is relay-83f587 (depends on Task 2). All are blocked for plan approval.

Self-review must check spec coverage, task signatures, test ownership for all five
Review Focus cases, and proportion. This plan creates three direct step tasks,
ordered Task 1 → Task 2 → Task 3. Record the self-review as plan round 1 with the
reviewer's freshly resolved model identity. The user reviews the frozen plan
revision before execution begins; no implementation is authorized by drafting it.

Ruling on the user's final spec nit: retain service-side detached party validation
and document/test its one-connection cost in Task 3. Why: the approved spec places
these checks in the service and preserves local native-file rejection. Cost: a
wrong-party file reports service unavailability before party invalidity when the
service is down. This plan resolves the nit without changing spec `9455516`.
