# Codex Question Connector — Protocol Feasibility Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inline execution is recommended because every step consumes the preceding probe's evidence; the user may choose subagent-driven-development instead.

**Goal:** Establish the exact current-version protocol contracts needed to implement relay-a27e7c without falsely confirming answers or answering an approval as a clarification.

**Architecture:** A private Codex server and native TUI reproduce the shared-daemon topology, with an outside client using the supplied stdio proxy. A bounded task-local probe captures native requests, responses, receipts and restart behavior. No production connector is written in this phase.

**Tech Stack:** Installed Codex, Node >=22 built-ins, a private tmux server, the existing `just` test front door. No added dependencies.

**Spec:** [Codex blocking question connector addendum](../specs/2026-10-28-codex-question-connector.md), approved by the user at relay `77d3aee2f84d5945514a7fcf089a899b4153deb9` (task spec review round 2). Read the accepted parent spec's §5, §8 and §9.3 too.

## Scope and phase boundary

This is the first executable phase of the connector task. The approved spec makes
provenance, receipt, decline and reconciliation prerequisites of production work.
The generated types establish field shapes, but do not prove those prerequisites.
This plan therefore ends with a verdict and either a concrete production-code plan
for review or a blocker report. It does not close relay-a27e7c or replace its final
Node 22/development-runtime and user-present phone answer/defer acceptance.

Writing an implementation that guesses an acknowledgement or replay barrier is
rejected. A passed probe produces the exact parser and reconciliation decisions
for the next plan; a failed or unknown required gate returns to design review.
No second transport, transcript-tail fallback or permanently unconfirmed route is
authorized by this phase.

## Global Constraints

- One explicitly configured local daemon, one `relay serve`, Node built-ins, no new root library export.
- The route's maximum waiting period is 23 hours, as for Claude.
- Mark `consumed` only after a native tool result for the exact call contains the saved answer, using a version-probed mapping.
- No model prose or timing inference counts as receipt.
- Secret questions, app approvals, permission requests, async/default questions, and unidentified calls stay native.
- Do not touch this session's daemon or use the live desktop to probe.
- Production code does not manage the daemon. This probe may start and stop only its own foreground server and private TUI, never a host service or the real daemon.
- No real credentials in automated fixtures. Never copy a refreshable login into the probe. Live runs use only the access-token boundary below; no refresh token reaches a child, private home or RPC. Do not change live login state or create paid API credentials.
- All spawned process environments are built from explicit keys, including private `HOME`, `CODEX_HOME`, XDG config/state/cache/runtime locations, `PATH`, `USER`, `TERM` when needed, and isolated Git configuration. Never copy the inherited environment.
- Tests use `just test-one`; no direct test-runner invocation. New worktree baseline remains deferred until execution Setup, when `just test` runs before any probe code is written.

## Review Focus

1. A normally created TUI thread may lack raw events that a specially configured test thread exposes. Task 2 must prove both early and late attachment without changing thread settings.
2. A resolution can be cleanup or a competing answer. Task 2 compares actual call-correlated outputs, never a notification or model's final text alone.
3. A disconnect can occur after native acceptance but before the client observes it. Task 2 must recover the output or positively identify the exact still-pending request before any resend.
4. An approval can use the question method. Task 2 requires a positive built-in-call discriminator, plus exclusion evidence; a label heuristic or a synthetic fixture alone is insufficient.
5. A cleanup fault can leave a server or credential behind. Task 1 tests interruption cleanup, and every Task 2 case carries a checked cleanup verdict that can invalidate the run.

## Workspace, artifacts and interfaces

Continue in `.worktrees/codex-question` on `feat/codex-question`. Do not recreate it.
Verify retained manifests before using prior inputs. Keep the approved spec unchanged.

Task scratch is the already recorded `$WORK_ROOT/relay/relay-a27e7c/`. Within it,
create `probe/` for `run.mjs`, `probe.test.mjs`, fixture children and an initial
`cases.json`; use fresh `runs/<run-id>/` directories for evidence. Record creation
and mutable ownership immediately. A short per-run runtime directory may live under
the host runtime directory when a Unix socket path would exceed its limit; record
its path and copy needed results into persistent scratch before cleanup. No
multi-session input lives only in a temporary directory.

Probe code is disposable research code, kept as hashed task attachments rather
than a new public tool. Existing code to borrow selectively:

- `tools/codex-subagent-capture/lib.sh`: private-directory cleanup only; its
  auth-file copy is explicitly forbidden here, as are inherited environments.
- `tools/codex-model-acceptance/run`: private tmux naming and capture pattern,
  not its `--no-daemon` topology or permissive sandbox flags.
- `test/helpers/spawn-lines.js`: owned-child cleanup and line-based assertions.
- `src/serve/lines.js`: bounded UTF-8 framing; do not modify production code just
  to share a probe helper.

The probe CLI is:

```text
node <probe>/run.mjs --case <name> --out <fresh-dir> --codex <absolute-bin>
                    --model <confirmed-model> --auth-file <read-only-auth-source>
```

All five options are required once; unknown, repeated, missing or empty arguments
fail before creating output or launching anything. `--case` is one of the rows in
Task 2, including `pilot`. Never accept shell command strings. Spawn argv arrays.

`runCase({name, out, codex, model, authFile, signal}) -> Promise<RunResult>` owns all
children, bounded IPC buffers and timers. The probe module exports this function
for its fixture tests; importing it does not launch a run. No reusable RPC framework.

`RunResult` is written to `result.json`, including on ordinary failure or handled
interruption: `{schema:1, case, cliVersion, daemonVersion, startedAt, endedAt,
status, reason, assertions, evidence, cleanup}`. `status` is `passed`, `failed`,
`unknown` or `refused`; `assertions` are `{name, passed, evidenceRefs: string[]}`;
`evidence` lists relative filenames and SHA-256; `cleanup` records owned pids,
survivors, tmux termination and credential removal. Missing observation is `unknown`,
not a pass. Exit 0 requires every assertion and cleanup to pass; exit 1 is
failed/unknown, exit 2 is preflight refusal, and interrupted runs exit 130.

Raw private evidence uses `{at, client, direction, message}` JSONL plus separate
bounded stderr and terminal captures. Record only the isolated scenario's messages;
no environment dump or auth frames. A portable derivative replaces host paths and
synthetic thread ids consistently while preserving identity relationships and
ordering. Keep hashes of raw and derivative bytes; neither is a substitute for the other.

### Authentication boundary and prerequisite gate

The source login is read only by the controller, never by a child. Extract only
`tokens.access_token` and `tokens.account_id`; reject a missing account, malformed
JWT or missing/nonfinite `exp`. Require at least 35 minutes until expiry before
starting the batch (30-minute run budget plus five minutes' margin), and at least
the case deadline plus five minutes before each case. Parsing expiry is a lifetime
check, not cryptographic validation; server authentication must still succeed.
Never request a refresh or wait for this probe to renew a stale token.

Start with an empty private Codex home and isolated credential-store configuration.
Initialize a dedicated authentication proxy with `experimentalApi: true`, then
send `account/login/start` with `type: "chatgptAuthTokens"`, the access token and
account id only. Omit this entire frame from capture and discard credential-bearing
errors without printing their contents. Require the matching successful login
response and `account/updated.authMode == "chatgptAuthTokens"` before starting
the TUI. Keep that proxy available for server requests. On any
`account/chatgptAuthTokens/refresh` request or authorization error, abort and clean
up; never supply refreshed credentials, call logout, or fall back to managed login.
On the deliberate server restart, repeat this same access-only login before
reconnecting the TUI, recording it as a probe action, not recovery evidence.
For the no-client variant, leave **all** proxies, including the authentication
proxy, disconnected during the no-client interval; authenticate only when the
later observer joins. A server with an authentication proxy attached is not
evidence of no-client recovery. If access-only login changes the recovery path,
report that equivalence unknown rather than crediting the gate.

This uses the installed 0.165.0 `LoginAccountParams` and refresh-request types.
The [official external-auth protocol](https://learn.chatgpt.com/docs/app-server#3c-log-in-with-externally-managed-chatgpt-tokens-chatgptauthtokens)
describes client-supplied access tokens and refresh requests to that client.
It is experimental: the pilot must verify native remote-TUI compatibility without
thread overrides; refusal or changed thread behavior blocks this topology.
The [authentication guide](https://learn.chatgpt.com/docs/auth) documents automatic
refresh for managed logins. Whether 0.165.0 would invalidate this particular live
login through a copied refresh token remains unverified; this plan avoids sharing
that token rather than depending on its age or detecting rotation after the fact.

Before and after every case, compare source-login bytes privately and check for
unexpected private auth-file creation or credential-store writes. Retain only
booleans, never credentials or credential hashes. A source change is not proof the
probe caused it (the live session can refresh concurrently), but it stops the batch
for investigation. Any unexpected private credential persistence fails cleanup:
stop, remove owned copies, and report a possible live-login impact without rewriting
the source. No real login, private auth copy or auth payload becomes an attachment.

Before any paid pilot, complete an exclusion-fixture inventory. Each row below
needs a producer and expected native provenance, or a recorded blocker. In
particular, an app approval using the question method is not assumed to exist in
an empty private home. Prepare the exact account/app/tool/arguments and
approval policy needed to produce that example, then seek the user's approval
for that account-connected probe. Plan approval does not grant this external
action. If no suitable connected app or safe recipe is available, park Task 2
before inference, identify the missing class, and return that blocker for design
review; do not run an inevitably incomplete matrix or mark the class passed.

### Case limits and subscription budget

Store these `deadlineSeconds` values in `cases.json`: pilot 180, join 300,
forms 600, exclude 600, race 480, clear 360, defer 240, reconnect 480, restart 600.
These are ceilings per case, not a promise that all cases fit their sum. Keep the
15-second RPC timeout separate from model-turn and delayed-receipt waits. In
`clear`, delay observation for 75 seconds within its case deadline.

Approval of this revision authorizes at most 30 minutes of live probe wall time
and 30 model turns on the existing subscription, including pilot and retries;
it does not authorize buying credits or API use. The earlier 15–30 minute estimate
is provisional, not evidence that the full matrix fits this allowance. Per-case
ceilings total 64 minutes before cleanup, so an extension may be needed. Keep the
30-minute/30-turn cap unchanged; no token-cost estimate is claimed. Persist cumulative time/turn counts
across runs and resumes. Stop at the first exhausted budget, keep partial evidence,
and seek an explicit extension before more inference. The harness timeout covers
the case deadline plus a bounded 60-second cleanup allowance; it never replaces
the driver's deadline or the aggregate budget.

### Task 1: Build and verify the isolated probe driver

**Files:** Create task-local `probe/run.mjs`, `probe/probe.test.mjs`, fixture child
scripts and `probe/cases.json`. Do not edit `src/`, schemas, package dependencies,
real settings or shared launchers.

**Interfaces:** Consumes the retained generated protocol and CLI help. Produces
`runCase` and `RunResult` above, with only `pilot` implemented initially; later
cases are added in Task 2 using the same bounded capture/cleanup path.

- [ ] **Setup:** Re-enter the worktree skill, confirm dependency hydration, run
  `just test`, and note command, runtime and nonzero test count on this task.
  A pre-existing failure is investigated and recorded before changing probe code.
- [ ] **Early app-fixture discovery:** Before building the driver, inspect available
  app/tool metadata read-only and prepare the exact deny-before-invocation recipe
  required by Task 2. Record whether this installation exposes a suitable existing
  app and whether its private approval policy can force the prompt. Metadata alone
  is not native protocol evidence. If proving availability needs the private server,
  defer only that bounded, non-inference check to the tested driver; do not touch the
  live daemon. Present a concrete account-connected probe for approval as soon as
  its recipe is reviewable. A missing recipe remains a Task 2 prerequisite, not
  permission to install an app or a prohibition on Task 1's fake-process work.
- [ ] **Write `probe.test.mjs` before the driver.** Use fake Codex/tmux processes
  and fake auth bytes in a private home. Assert these named behaviors:
  `invalid argv launches nothing`, `existing output is never overwritten`,
  `wrong server home refuses before thread RPC`, `unmatched response cannot settle
  another RPC`, `oversized input aborts without logging its payload`, and
  `SIGTERM reaps owned children and removes private credentials`. Also assert
  `expired or insufficient-lifetime token launches nothing`, `refresh token never
  reaches child, disk, RPC or capture`, `refresh request aborts without retry`,
  `auth frames and credential-bearing errors are never captured`, `changed source
  or private auth persistence stops the batch`, `missing protocol Plan mode sends
  no question prompt`, `previous-turn Plan mode cannot qualify a Default question
  turn`, and `case and cumulative budgets survive resume and stop
  inference at their limit`. Give fixtures no real
  credentials or inherited Git variables. Preserve an unrelated sentinel child.
- [ ] **Run RED:** `just test-one "$WORK_ROOT/relay/relay-a27e7c/probe/probe.test.mjs"`.
  Record the expected missing-driver/behavior failure, not a setup or credential failure.
- [ ] **Implement the minimal driver.** One fresh foreground
  `codex app-server --listen unix://<private-socket>` under private environment,
  one private tmux TUI using `--remote unix://<private-socket>`, and named proxy
  clients using `codex app-server proxy --sock <private-socket>`. Confirm this
  reproduces the shared-server ownership/recovery path; if only a materially
  different topology can run, mark equivalence unknown and do not claim the gate.
  Do not use `daemon start`, `restart`, bootstrap, systemd or the live control socket.
- [ ] **Bound the run.** Use a 1 MiB per-line cap and bounded total capture
  (16 MiB per case), RPC deadlines of 15 seconds, and the per-case and aggregate
  budgets above. Test deadlines with an injected clock, not minute-long sleeps.
  Capture overflow fails the case. On EXIT/TERM/INT close clients, stop the private
  tmux server, terminate/reap the owned server and children, remove any private credentials,
  then verify cleanup. Refuse mismatching ownership before killing any pid.
- [ ] **Implement `pilot`.** Initialize the proxy, verify its returned `codexHome`
  equals the private home, and record exact CLI/server versions. Establish access-only
  authentication as above. In the private TUI, select Plan mode, then attach an
  observer without overrides and require `thread/resume`'s
  `collaborationMode.mode == "plan"` before submitting the question prompt. Null,
  missing or conflicting mode evidence is unknown; terminal text is insufficient.
  If creating the thread or applying the TUI's mode selection requires a turn,
  use a harmless bootstrap turn that requests no question, count it against the
  budget, then verify mode before the question turn. Request exactly one
  Circle/Square question. Before accepting or answering it as an eligible question,
  re-read effective mode through `thread/resume` while that question is pending.
  Correlate the request's `(threadId, turnId)` with `turn/started` and the resumed
  thread's active turn; require the same active turn throughout the mode read and
  no intervening mode change or newer turn. The earlier precheck alone never
  qualifies the question. `turn/started` has no mode field in the saved 0.165.0
  types; do not invent one. Verify that the effective-mode read applies to this
  active turn, not saved settings for a prior or future turn. If that association
  cannot be established, record unknown and leave the question native. Apply this
  same current-turn check to Plan cases and the Default/async negative case.
  Using the observer without settings overrides, capture the native tuple and
  reply Square through the proxy only after these checks. Locate the correlated
  native result, then perform checked cleanup.
  Model text `CHOSEN=Square` is corroboration only. A missing identity/provenance or
  matching receipt makes the pilot unknown and stops the matrix.
- [ ] **Run GREEN** through the same `just test-one` command on development Node
  and installed Node 22 (adjust only this command's PATH; print `node --version`).
  Record counts and verify tests did not contact a real daemon or inference service.
- [ ] **Checkpoint:** attach source/test snapshots and the test result summaries;
  hash retained scratch. No repository-code commit is needed for these research
  scripts. Mark this child done only after its checks and attachments are verified.

### Task 2: Run the current-version protocol matrix

**Files:** Extend task-local `probe/run.mjs` and `probe/cases.json`; create fresh
`runs/<run-id>/` evidence and `protocol-contract-report.md` in task scratch.

**Interfaces:** Consumes Task 1's CLI and result schema. Produces one `RunResult`
per case and a report mapping each approved spec gate to exact native fields,
captured ordering, supported versions and verdicts. No fabricated protocol fixture.

- [ ] **Preflight:** Re-read current hq-25665e notes for relevant results without
  taking its claim. Resolve the installed executable and versions afresh. Confirm
  the selected model exists in this installation and record it; use the installed
  configured model, with no silent substitution. An unavailable subscription/auth
  path is a blocker, not permission to buy API access. Inventory the real daemon
  read-only so ownership cannot be confused with the private one. Complete the
  authentication lifetime checks and exclusion-fixture inventory above, including
  any required account-connected approval, before the first paid pilot. Record
  the approved recipe and cumulative subscription budget in task notes.
- [ ] **Pilot first:** Run the CLI with `--case pilot` in the foreground under a
  harness-tracked timeout of five minutes. Read request, native result, terminal
  capture, verdict and cleanup before adding or running other cases. Correct probe
  mistakes against their output, retaining failed runs. Do not convert an unsupported
  capability into a pass by changing the target thread's settings.
- [ ] **Add and run each case below, once each initially.** Each is a separate
  bounded run with fresh isolation and a result. Use two named clients for races.
  Runtime is unmeasured and may exceed the initial allowance; enforce the
  subscription budget above. No idle-desktop window is required.
  A retry names the observed cause and changes
  only the probe defect or prerequisite. A required failed/unknown contract stops
  dependent cases and production work.

| Case | Required observation and assertion |
| --- | --- |
| `join` | A TUI-created thread, with ordinary settings and no special raw-event opt-in, is discoverable through paginated `thread/loaded/list`. Early and late `thread/resume` observers receive the pending request and enough evidence to identify the built-in call. Compare model, mode, instructions, approvals and workspace before/after joining; none changes, no turn starts. A completed/unloaded thread is not resumed merely for discovery. |
| `forms` | Native single choice, Other, nullable-options text, multiple questions and native decline are captured and answered through the proxy. Record exact native question-id mappings, labels/text and declined result. Obtain decline from actual native interaction; do not guess `{}` or a magic string. If a required form cannot be produced or represented, report it unknown/unsupported. |
| `exclude` | Establish a positive discriminator for an ordinary built-in blocking call. Execute the prerequisite recipes below and record the actual method and originating tool for every negative class. No real app operation is approved. An unobserved negative class or discriminator based only on labels/prose is not a pass. Controlled synthetic inputs test the proposed predicate but are labelled synthetic, not capability evidence. |
| `race` | On separate questions, order desktop before proxy and proxy before desktop, including a delayed proxy write after the other client wins. Identify the actual accepted answer by call-correlated output, show that resolution alone does not establish it, and record how duplicate responses behave. A different native answer must never be called receipt of the proxy candidate. |
| `clear` | Interrupt an unanswered turn through the private controller, capture cleanup resolution and prove no matching answer exists. Separately delay receipt observation beyond 60 seconds and recover the exact output. Record ordering when resolution precedes the output; distinguish temporarily missing receipt from cleared-without-answer. |
| `defer` | Keep the proxy silent, leave the native question pending, then answer using only native TUI input. No turn advances before that input. Capture the matching native result and prove the proxy has not answered or interrupted. This establishes native handback; relay's `released` state itself is tested in the later production phase. |
| `reconnect` | Kill/recreate only the proxy while a question waits, then separately disconnect after sending its answer but before reading receipt. Rejoin without overrides. Find a positive pending replay or exact recorded result, and an authoritative completion condition for reconciliation. Silence, an arbitrary grace period, and a partial page are not barriers. Repeat with a fresh controller process, representing relay restart. |
| `restart` | Stop/reap only the private server while a question waits, restart against the same private home, once with the private TUI reconnecting and once with no client attached until later. Record daemon identity and old/new turn/item/RPC ids. An old response must never answer a new call even if its RPC id is reused. Record interrupted vs recovered behavior exactly; no-client recovery is not inferred from the attached run. |

Exclusion producers (these are attempts to elicit real protocol examples, not
claims that this installation supports them):

| Class | Producer and required evidence |
| --- | --- |
| Secret question | In a private Plan thread ask the native question tool for a secret-marked field using only the dummy value `probe-not-a-secret`. Require observed `isSecret: true` and built-in provenance. If the native tool cannot emit it, record unknown; hand-crafted JSON does not replace it. |
| Default/async question | Switch a separate private TUI thread to Default, confirm `collaborationMode.mode == "default"` through the protocol, and prompt its asynchronous question tool for Circle/Square. Require actual nonblocking request and originating call; a prose question is not evidence. |
| Permission request | Ask the private agent to use built-in `request_permissions` for read access to a controller-created sentinel outside its allowed workspace, never a real user file; deny the request before the read. Require observed `item/permissions/requestApproval` with native tool provenance, plus the version-scoped path audit below. A command-execution approval alone does not prove this permission-tool case. A question-method permission example is required only if the protocol, documentation or native evidence establishes that path. |
| App approval using the question method | Requires a connected app plus user-approved account-connected recipe. Before the pilot name one actual tool, exact synthetic arguments, private approval policy forcing a prompt, and the point where the driver denies/cancels before invocation. Choose an operation whose approval can be observed without an external write; never enable automatic approval or a permissive sandbox. Do not connect/install an app or change live account settings merely to obtain this case. If no existing app can safely produce it, park before the pilot. At runtime require a real question-method approval with app-tool provenance; another approval method or cached consent is unknown. |

Permission path audit: retain the installed-version `ServerRequest` union,
`PermissionsRequestApprovalParams`, and the relevant official documentation
references and inspection result. The saved 0.165.0 protocol exposes the dedicated
permission method; the [official permission documentation](https://learn.chatgpt.com/docs/app-server#permission-requests)
assigns it to `request_permissions`. No question-based permission path has been
identified in these sources. Record that bounded finding, not a universal proof
from a type union's silence. Observing the dedicated method plus this audit is
sufficient permission-exclusion evidence unless a source or actual request reveals
another path; then add the corresponding case before declaring exclusion passed.
Absence of a recipe for an unestablished path does not block the pilot. This matches
the approved spec's gate 2, which names app approvals, secret and async requests.
Positive built-in-question provenance remains mandatory for every forwarded call;
all other methods and unidentified requests remain native.

The app-through-question recipe and account-connected approval remain **unmet**
prerequisites: Task 1 can build with fake fixtures, but Task 2 cannot start live
inference until they are recorded. This preserves the approved app-exclusion
requirement without inventing an additional permission transport requirement.

- [ ] **Report the contract.** For each gate, give raw evidence references/hashes,
  the exact request and answer mapping, positive built-in provenance predicate,
  decline encoding, receipt extraction/correlation, late-join source, replay
  completion condition, daemon-generation discriminator and same-call retry rule.
  Distinguish protocol observation from test-driver action. A failed transport,
  provenance, receipt, decline or recovery gate prohibits a green overall verdict.
- [ ] **Checkpoint:** verify every run's processes/auth cleanup; attach portable
  reports and representative real protocol fixtures with their raw-evidence map.
  Retain exact raw logs under hashed task ownership. Note relevant Codex results
  on hq-25665e without changing its status or its unrelated scopes. A tooling defect
  is filed to its owner; an upstream defect is searched upstream before patching.

### Task 3: Freeze the implementation decisions or the blocker

**Files:** Create `docs/notes/2026-10-28-codex-question-protocol-report.md` in the
code worktree, derived from the portable Task 2 report. On passing all prerequisite
gates, create `docs/plans/2026-10-28-codex-question-connector.md`; otherwise produce
only the report and any required spec revision for user review.

**Interfaces:** Consumes every `RunResult` plus exact source hashes. Produces a
checked report and the next frozen artifact; never an enabled connector.

- [ ] **Adjudicate completeness.** Require all five prerequisite gates in the
  approved spec, including no-client recovery and native forms. List any missing
  evidence explicitly. Preserve the parent task's implemented-vs-intended scope;
  a failed route probe does not authorize narrowing its acceptance.
- [ ] **On failure/unknown:** record the smallest blocking contract, its evidence,
  and the supported alternatives without implementing one. Park the parent for
  the relevant design decision; do not mark it done or continue producing guessed
  production signatures. Record environment refusals separately from unsupported
  protocol behavior.
- [ ] **On pass:** use writing-plans to produce the production plan with exact
  functions, JSDoc types, native field parsers and tests derived from the report.
  Cover: translation and evidence validation; connector-specific durable route
  ownership; serialized delivery/receipt/races; service lifecycle and discovery;
  Node 22/development-runtime unit/IPC checks; docs and user-present phone acceptance.
  Proposed configuration names to settle there are `RELAY_CODEX_BIN`,
  `RELAY_CODEX_HOME`, `RELAY_CODEX_SOCKET`, `RELAY_CODEX_EVIDENCE`; partial configuration
  fails, absent configuration launches nothing, exact version mismatch disables
  only the connector. These are builder defaults, not an already exposed interface.
- [ ] **Cover every remaining spec requirement in that plan.** Include 23-hour
  expiry, the 60-second confirmation window, same-tuple replay/content conflict,
  stable `qN`/`oN` mappings, private native-id metadata, native competing answers,
  bounded discovery and reconnect, dead-registry-row handling, storage crash windows,
  no hook-waiter impersonation, fail-stop IO, retained receipt evidence and cleanup.
  No root exports, new HTTP endpoints or new phone UI. Prepare actual installation
  paths and rollback for human acceptance, seeking host-use approval at that point.
- [ ] **Self-review and freeze.** Verify report claims against the recorded bytes;
  run `tasks check`, `git diff --check` and `just check`, then commit only the report
  and plan with conventional commits. If any executable repository code was added,
  run the appropriate focused and fast front-door tests before its commit as well.
  Record the self-review using a fresh verified reviewer identity. The user's next
  review names repository, commit and path; do not amend that revision while open.
- [ ] **Handoff:** attach the frozen report/plan if branch-only links remain refused
  (tasks-85e8cd), record retained items and `host-load --section session`, and park
  the parent for user review. A successful feasibility phase is not a live rollout.

## Plan review and records

The plan is reviewed before Task 1 runs. Inline execution is the recommendation;
there is no independent parallel implementation in this evidence-dependent phase.
Record one child per task heading, each with this plan attachment and its heading
in its body while the tracker cannot link a branch-only plan. Add dependencies
Task 1 → Task 2 → Task 3. This is a documented workaround for tasks-85e8cd, not a
waiver of task tracking or plan review. Once ordinary links resolve, restore them.

At the end, keep relay-a27e7c open for the actual connector implementation and
phone acceptance. Do not integrate unreviewed artifacts, activate a service or
leave an unattended probe running across a review gate.
