# Codex Question Connector — Protocol Feasibility Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inline execution is recommended because every step consumes the preceding probe's evidence; the user may choose subagent-driven-development instead.

**Goal:** Establish the exact current-version protocol contracts needed to implement relay-a27e7c without falsely confirming answers or answering an approval as a clarification.

**Architecture:** A private Codex server and native TUI reproduce the shared-daemon topology, with bounded outside clients speaking WebSocket directly over the private Unix socket. A bounded task-local probe captures native requests, responses, receipts and restart behavior. No production connector is written in this phase.

**Tech Stack:** Installed Codex, Node >=22 built-ins, a private tmux server, the existing `just` test front door. No added dependencies.

**Spec:** [Codex blocking question connector addendum](../specs/2026-10-28-codex-question-connector.md), approved by the user at relay `741a546dde23a4271ab640b7bfde8aabadfbc87c` (task spec review round 9). Read the accepted parent spec's §5, §8 and §9.3 too.

## Scope and phase boundary

This resumes after approved plan `59e468e` ran metadata-02 and readiness-01.
The companion protocol report records a disposable-driver classifier defect:
normal composer status text was rejected, then a stale flag mislabelled the stop.
The defects are corrected offline against the capture. This new frozen revision
requires separate user approval before any further native run. It is not a retry
under the earlier approval. The earlier private transport prerequisite remains
proved; no production connector is authorized by this amendment.
The approved spec makes
provenance, receipt, decline and reconciliation prerequisites of production work.
The generated types establish field shapes, but do not prove those prerequisites.
This plan therefore ends with a verdict and either a concrete production-code plan
for review or a blocker report. It does not close relay-a27e7c or replace its final
Node 22/development-runtime and user-present phone answer/defer acceptance.

Writing an implementation that guesses an acknowledgement or replay barrier is
rejected. A passed probe produces the exact parser and reconciliation decisions
for the next plan; a failed or unknown required gate prevents production work.
The app-approval prerequisite alone may remain unknown while independent native
probes run in the sequence below; every other unknown stops its dependent cases.
This changes probe ordering, not the approved spec or its acceptance gates.
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
- Tests use `just test-one`; no direct test-runner invocation. Validate test policy from this code checkout at execution; invalid/unreadable policy is an error. Valid automatic_broad=false keeps focused evidence and hygiene and skips broad suites, never claiming a skipped pass. The execution baseline already passed: `just test`, Node 26.5.0, 773/773 tests. Reuse that recorded baseline unless code, dependencies or runtime changed; do not repeat it for this documentation-only revision.

## Review Focus

1. Trust can change defaults or enable workspace configuration: Task 2 pins one owned canonical path, rejects unexpected project layers, and rechecks effective read-only/on-request/user policy before input.
2. Startup status or a modal can receive queued model text: Task 2 waits without input on pinned starting states, tolerates noninteractive notices above the required composer, and rejects unknown prompts/modals before any ready or starting match.
3. A previous thread or a missing TUI thread can masquerade as readiness: Task 2 requires unique new native thread/cwd/model evidence, no inference bootstrap, serial backoff, 40 polls/90 s and aggregate precedence.
4. Missing capture or similar tool names can create false app conclusions: Task 2 retains the corrected projection, tests naming/absence/omission separately, and keeps app unknown independent of safe core admission.
5. A successful startup can be mistaken for native capability: the pilot still needs exact built-in provenance, current-version Plan enforcement and exact correlated receipt; all other native gates and cleanup remain mandatory.

## Resume state and ordering

The approved spec remains `741a546`. Read the companion frozen protocol report
and verify retained hashes before any execution. Task 1 stays complete. Task 2's
trust/readiness implementation, captured-frame and trust-overlap fixes, and the
review-required Plan-screen correction are complete offline in snapshot `r12`.
Combined driver checks passed 119/119 on Node 26.5.0 and 22.23.2. Repository checks
remain 773/773 from the unchanged code checkout. Before retained admission or any
native retry, verify r12 hashes and the focused RED→GREEN evidence for trust and
post-`/plan` admission. The entire pinned trust surface must match; the Plan
composer accepts only source-derived decoration and still requires native
identity/policy/provenance/mode evidence. Do not repeat completed implementation
or call fixtures native proof.

`metadata-02` passed core config/model/preset checks and clean cleanup in 11.378
seconds, with an auditable projection. `codex_apps` has 194 tools, including
`linear.search`; neither exact approved tool name matched. App remains unknown,
not an authorized alias or schema proof. Offline inspection of the exact raw
response confirmed the `linear.search` object contains only `name`, not its
schema. Snapshot r12 retains that one schema in any future separately authorized
metadata run as evidence only; exact-name admission remains unchanged.
`canRunPilot(metadata-02)` passed with
verified evidence. No metadata retry is authorized by this revision.

`readiness-01` used saved untrusted, displayed no trust prompt and created one
native thread with the expected cwd/model. Its original unknown result is
`tui-thread-unobserved` after 40 polls. The capture instead establishes that a
normal model/workspace status line prevented composer recognition, while an early
missing-id flag was not cleared. Required thread/read and resume policy checks
were never reached. Both driver defects are fixed offline; the original result
stays unchanged. No model turn or keystroke ran. A complete readiness pass is
still unproved, and the paid `pilot-02` has not been attempted.

Continue **346,069 ms and two charged turns**, including the earlier 40,000 ms
conservative diagnostic charge. Only one native turn was observed in the earlier
pilot-01; its unused bootstrap reservation stays charged. Never reset/refund the
budget. The exact approved Linear search/decline operation persists; the observed
`linear.search` name is not permission to substitute another operation.

After approval: verify the final r12 driver/checks and metadata-02 evidence → one
fresh no-inference `readiness-02` with untrusted → only its exact eligible trust
prompt permits one trusted `readiness-03` → one `pilot-02` → the seven independent
cases → available exclusions. Retained metadata admission and clean cleanup are
necessary but never replace each fresh server's own core/auth/model/policy checks.
A readiness failure/unknown stops; no additional readiness attempt, configuration
repair or metadata scan is included. Only pilot provenance/mode/exact-receipt
success admits later cases. App unknown alone still does not block safe independent
learning, but gate 2 and all production/activation gates remain required.

Why prepare this retry: the localized driver defect is reproduced from the actual
frame and corrected offline. Cost: another bounded readiness attempt may remain
unknown and use up to 120 seconds, with no inference; the unchanged aggregate cap
still wins. Rejected alternatives are taking an unlisted immediate retry, relaxing
native thread/policy proof, or repeating the completed metadata diagnostic.

hq-d85ede recorded WebSocket and Plan-only blocking on 0.162.1; retain that
provenance and current-version source candidate. Shared-listener source proves
transport selection, not managed/private lifecycle equivalence.

## Workspace, artifacts and interfaces

Continue in `.worktrees/codex-question` on `feat/codex-question`. Do not recreate it.
Verify retained manifests before using prior inputs. Keep the approved spec unchanged.

Task scratch is the already recorded `$WORK_ROOT/relay/relay-a27e7c/`. Within it,
reuse `probe/` for the files listed in Task 1; use fresh `runs/<run-id>/` directories for evidence. Record creation
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
- `test/helpers/spawn-lines.js`: owned-child cleanup only. Neither this helper nor
  `src/serve/lines.js` defines the WebSocket wire contract; do not reuse line framing
  or modify production code to share a probe helper.

The probe CLI is:

```text
node <probe>/run.mjs --case <name> --out <fresh-dir> --codex <absolute-bin>
                    --model <confirmed-model> --auth-file <read-only-auth-source>
                    [--trust-level <untrusted|trusted>]
```

`--case`, `--out` and `--codex` are required once. `--model` and `--auth-file`
are also required for `readiness`, `metadata`, historical `inventory`, `pilot` and the matrix,
and forbidden for
`transport`, which must not read a login file. Unknown, repeated, missing or empty
arguments fail before output creation or launch. `--case` is `transport`,
`readiness`, `metadata`, historical `inventory`, `pilot` or one of the matrix rows. `inventory`
remains a historical fixture path; this revision authorizes no live invocation of it.
Never accept shell command strings. Spawn argv arrays.
For TUI cases (`readiness`, `pilot`, and each later TUI matrix case), require one
additional `--trust-level untrusted|trusted`, passed as `trustLevel` to `runCase`.
Reject it for transport/metadata/historical inventory; no arbitrary config strings.
The controller selects it only from the readiness decision below and records that
provenance. It grants no live-home or ancestor/repository-wide trust.


`runCase({name, out, codex, model, authFile, trustLevel, signal}) -> Promise<RunResult>` owns all
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

### Bounded Unix WebSocket and RPC contract

`connectUnixWebSocket({socketPath, signal, onText, onFailure, maxIncomingBytes = 8388608}) -> Promise<Wire>` in
`probe/unix-websocket.mjs` resolves only after a validated Upgrade. `Wire` exposes
`sendText(text): Promise<void>`, `close(): Promise<void>`, and read-only
`peerLimitBytes`. `onText(text)` receives complete validated UTF-8 text messages;
`onFailure(code)` fires once with a bounded diagnostic, never payload bytes.
`close` is idempotent; abort rejects outstanding writes and closes the socket.
`maxIncomingBytes` must be a positive integer no larger than 8 MiB; the only
lower live override is the explicit isolation control below. Use `node:net`,
`node:crypto` and Buffer/TextDecoder only; no runtime dependency.
`sendText` promises local write completion, never native answer receipt.

| Boundary | Required behavior and tests |
| --- | --- |
| Upgrade | 15-second total handshake deadline, 16 KiB header cap. Generate a fresh random key; require status 101, Upgrade/Connection tokens and exact SHA-1 acceptance key. Reject duplicate critical headers, missing/invalid/nonpositive peer limit, extensions or unsolicited subprotocols. Preserve any frame bytes arriving after headers in the same chunk. No compression requested. |
| Frames | Mask every client frame with fresh randomness; reject masked server frames, RSV bits, reserved opcodes and noncanonical/unsafe lengths before allocation. Accept text fragmentation with aggregate cap, interleaved ping/pong and close. Validate UTF-8 across message fragments and close reasons; reject binary application messages, orphan continuation, nested data messages, fragmented/oversized controls, invalid close codes, truncated header/payload and EOF mid-message. Test 125/126 and 65535/65536 length boundaries. |
| Limits | Outbound message cap `min(1 MiB, peerLimitBytes)`; never fragment to evade it. Incoming hard cap 8 MiB per frame or reassembled message, including advertised lengths checked before allocation. Maintain a 15-second incomplete-message deadline and 2-second close grace. Test smaller peer limits, chunk splits and aggregate fragmentation limits. |
| Buffering | At most 32 in-flight RPCs and 256 queued notifications, with total queued decoded payload at most 8 MiB. Await socket drain; bound pending outbound bytes to 1 MiB. Overflow is explicit failure, not dropped events. Total persisted capture is 16 MiB per case, including wire/header/decoded artifacts; stop before exceeding it. No payload enters diagnostics on parse/limit failure. |
| RPC | One JSON object per text message; validate object/id/method boundary. 15-second RPC deadline, except the single metadata `mcpServerStatus/list` request and historical inventory `app/list` retain request-local 95-second deadlines. Connection-local ids never become durable identity. Refresh requests abort before normal routing. Auth frames and errors are excluded/redacted as in the retained safety tests. All pending calls fail explicitly on connection loss. |

Native `transport` starts with the 8 MiB incoming hard cap. Metadata, readiness, pilot and
history pages record byte lengths and method names without credential content.
Keep this fixed probe ceiling throughout the run; do not silently raise it to make
an observation pass. The report proposes a production cap from the largest real
nonsecret message observed plus explicit headroom (at least 2x observed size,
rounded up to MiB, floor 1 MiB, ceiling 8 MiB). If required headroom exceeds the
ceiling, report a limit blocker for design review. Real small samples do not prove
support for arbitrary histories; the pagination and oversize tests remain required.

### Lightweight history and thread isolation

`openThread({threadId, wireFactory, signal}) -> Promise<ThreadProbe>` in
`probe/history.mjs` owns a dedicated initialized connection for that one loaded
thread; `wireFactory(): Promise<Rpc>` creates the bounded transport/RPC adapter, never a
server. Adapt the existing `Rpc` to expose `call(method, params): Promise<object>`,
`send(message): Promise<void>`, `next(predicate): Promise<object>`, and `close()`;
its onText input feeds only validated complete messages. Register that callback
before reading frames; do not lose frames coalesced with the Upgrade response.
`ThreadProbe` exposes `resume(): Promise<ThreadResumeResponse>`,
`findResult({turnId,itemId,matchNativeResult,pageSize = 20})` and `close()`.
`matchNativeResult(item, tuple)` returns a matched native result or null; the pilot
must establish this exact call/output mapping before it can be used live. Fixture
mappings are explicitly synthetic, never a substitute for that evidence.
`resume()` sends only `{threadId, excludeTurns:true}`; omit `initialTurnsPage`,
`history`, `path` and all settings overrides. Its metadata is not proof of an
active turn's mode. The owner checks loaded-thread membership before rejoining;
never resume an unloaded thread merely for discovery.

Fetch only needed history: `thread/turns/list` with `limit:20`,
`sortDirection:"desc"`, `itemsView:"notLoaded"`; then `thread/items/list` for the
relevant `turnId`, `limit:20`, `sortDirection:"asc"`, preserving returned string
cursors. The saved SortDirection values are `"asc"` and `"desc"`. `pageSize` may
reduce these limits to 1–20, never increase them. Use at most 10 pages across the
lookup and detect repeated cursors.
Return `{status:"found", result}` only for an exact correlated result;
`{status:"unknown",reason}` for exhausted bounds, absent mapping, loss or incomplete
reconciliation. A final page alone is not a temporal replay barrier. Receipt can
be found early; declaring a call gone needs Task 2's independent barrier evidence.

Keep the authentication/control client separate; at most four thread clients plus
one control client, enough for two competing clients and isolation controls.
For a size violation on a dedicated thread channel, close only that channel,
record `{threadId,reason:"inbound-limit"}`, quarantine that thread for this run,
and send no answer/retry there. Keep another assigned thread's connection usable;
never log the offending payload. Reconnect the failed thread at most once to
obtain lightweight metadata, with no automatic history fetch or answer resend;
a repeat failure leaves it quarantined. An oversized control message cannot be
attributed safely: stop the case visibly rather than guessing a thread. If native
subscriptions broadcast unrelated large payloads to all clients, connection-per-thread
is insufficient; mark isolation unknown and return to design, not silently claim
containment. Task 2 tests subscriptions with two owned threads. Synthetic overflow
proves driver mechanics only, not server subscription behavior. Cleanup/capture
failure can still invalidate the whole case even when a thread failure is contained.

### Private trust and positive TUI readiness

This section replaces blind startup keystrokes and the inference bootstrap.
Use separate owned paths `<run>/private/home` and `<run>/private/workspace`;
the workspace starts empty and contains no repository, `.codex`, hooks, plugins,
exec policies, instructions or symlinks. Require canonical paths inside the owned
run; no trust entry for an ancestor, Git root, live checkout or source home. Only
the private `CODEX_HOME/config.toml` gets a single exact workspace project key.
Preserve explicit `sandbox_mode="read-only"`, `approval_policy="on-request"`,
`approvals_reviewer="user"` and private app prompt policy irrespective of trust.
Inspect enabled project layers before the TUI starts; any unexpected project
layer, hook/plugin configuration, path alias or policy mismatch stops the batch.

Prefer `trust_level="untrusted"`. Tagged 0.165.0
`tui/src/onboarding/directory_trust.rs:83–85` skips the trust screen for a remote
saved-untrusted folder. `tui/src/lib.rs:1067–1082` selects Remote for an explicit
socket different from the default daemon; assert the owned socket is different
without connecting to the default daemon. `core/src/config/mod.rs:3904–3924`
uses the explicit approval policy before trust-derived defaults. These are source
expectations, not a native readiness pass. Exact bytes/hashes and limits are in
`tui-readiness-source.json` and `source-0.165.0/sources.json` on the task. The
reviewer's count of 59 live trusted projects remains attributed; do not reread,
copy or change those entries.

Run one `readiness` case with untrusted, no model prompt and no `/plan`. It may
create a TUI thread, but must observe zero `turn/started` and charge zero turns.
If it passes, use untrusted thereafter. Only a clean result with the exact owned
trust prompt still present (`untrusted-trust-prompt`) permits one fresh trusted
readiness attempt. Safety/policy failure, unfamiliar screen, lost connection,
missing thread or timeout permits no trusted fallback. This is two specified
readiness variants at most, not a generic retry/escalation loop.

The trusted variant writes `trust_level="trusted"` for that one canonical owned
workspace before startup. If the exact allowlisted trust prompt still appears,
permit its preconfigured `Trust and continue` choice once, only after verifying
the displayed cwd/trust target equals that workspace and the private server/home
identities and pre-trust config are safe. Select the numbered choice explicitly,
never send a bare queued Enter to an unclassified screen. A repeated prompt, a
broader target or any other prompt stops. Verify no project files/layers were
introduced, then re-run `config/read` with that workspace as `cwd` and
`includeLayers:true`; require the same read-only/on-request/user boundary. Inspect
config after either trust level, after any trust action, and before paid input.
Never repair a failing safety setting. Trust may change defaults; observed
permissive or unknown effective settings stop the whole batch.

Implement a small pure `classifyTuiScreen(text, workspace)` returning
`trust`, `starting`, `ready` or `unknown`, with a reason and matched evidence.
Capture only the owned pane at fixed 160×40; normalize ANSI escapes, line endings
and wrapping, not semantic text or arbitrary prompts. Match the active input/status
area, not the entire screen. A trust screen uses the pinned Folder access
copy/choices plus exact owned path, not a substring. Unknown modal, login, approval,
permission request, picker or other input prompt takes precedence over every
starting/ready match and stops with `tui-screen-unrecognized`, without keys.
Never treat a composer visible behind a modal as permission to send input.

Recognize these pinned startup states as `starting`; they permit observation only:

- The placeholder session header while configuration is pending: the native
  `OpenAI Codex (v0.165.0)` title and owned directory, without the required ready
  composer. Use the rendered header from `tui/src/history_cell/session.rs:358–381`,
  not its different `raw_lines` transcript representation. `chatwidget.rs:1265–1272,
  1534–1546` and `chatwidget/constructor.rs:66–68` explain its lifetime.
- An active status row with `Booting MCP server: <name>` or
  `Starting MCP servers (<completed>/<total>): <names>`, matching
  `chatwidget/mcp_startup.rs:17–18,159–190`. Variable names/counts and spinner/time
  decoration are data, not prompts. This active status takes precedence over a
  visible composer; quoted text in the history area does not count as active status.

On `starting`, keep polling without `/plan`, keys, turn reservation or inference,
within the same 40-request/90-second readiness bound. State changes never reset
that bound. The initial blank first paint retains its 5-second allowance. Other
unclassified noninteractive paint is not readiness: retain it and observe without
input within the existing readiness bound, ending unknown if no ready state appears.
This does not broaden the trust fallback, which still requires its exact prompt.

Recognize `ready` from the required empty `› Ask Codex to do anything` composer
line and matching `? for shortcuts` footer variant, with no active startup/busy
status, prefilled input or modal. The placeholder is fixed in
`chatwidget.rs:2101`; use the pinned empty/default/Plan composer fixtures for the
input area. Derive the status row from pinned source rather than copying only
Default's captured row: model display name, effort label, separator and exact
owned workspace. `chatwidget/status_controls.rs:460–467` renders absent/None
as `default` and other efforts by their string label; `status_surfaces.rs:988–1006`
combines model and effort. The private setup needs `default` and `medium` because
`models-manager/src/collaboration_mode_presets.rs:6–24` sets Plan to Medium.
Do not use `plan` as an effort label. Allow the source Plan indicator
`Plan mode (⇧tab to cycle)` (or its compact `Plan mode` form) right-aligned on
the status row, and the source shortcut-footer variant. See
`bottom_pane/footer.rs:150–174`, `chat_composer/status_surface.rs:20–80` and the
retained fullscreen Plan snapshot. Require the exact owned path, empty composer
and recognized shortcut footer; extra prompts, typed text or busy/startup state
still prevent readiness. The native Default capture and source-derived Plan
fixture are distinguished in `plan-screen-source.json`; no native Plan frame has
been captured. Exercise `/plan` through the fake-process driver to the ready
Plan composer and onward to native-protocol receipt checks; an overlapping modal
must stop without question input or its turn charge. All status/footer labels
are decoration, never mode/model/provenance proof.
A glyph or footer alone is insufficient. Notices above the composer
are not whole-screen match requirements: welcome banners, empty-state animation,
and a completed `MCP startup incomplete` warning may coexist with readiness.
Retain warnings in bounded evidence, separate from an active MCP startup status;
`chatwidget/mcp_startup.rs:202–241` records failures and clears startup state.
A warning does not establish tool availability or waive any core/app policy gate;
the app control still needs its independent authoritative metadata and approval.
Require recognized composer plus native thread/policy proof together before input.
Terminal text never establishes Plan mode, provenance or receipt. Retain exact
source hashes and these distinctions in `tui-readiness-source.json`.

Before TUI launch retain the loaded-thread set. With no other producer creating
threads, require exactly one new loaded id, corroborated by `thread/read` with
`includeTurns:false`, matching the owned cwd and configured model; record source
and client metadata when present. Reject ambiguity, disappearance or a preexisting
control thread. Tagged `tui/src/app/startup.rs:19–51,560–586` starts a fresh thread
before any initial message, so a bootstrap turn is not needed to discover it.
A missing signal is `tui-thread-unobserved`, never permission to send input.
Only after ready composer + native thread proof may the paid pilot send `/plan`
or reserve/submit its question. Remove the old READY bootstrap entirely. Verify
lightweight resume (`excludeTurns:true`, no overrides) for this exact loaded thread:
`cwd`, `model`, `approvalPolicy`, `approvalsReviewer` and read-only `sandbox` must
match the requested boundary; contradictory active-permission provenance stops.

All discovery/capture iterations are serial, with one shared counter/deadline:
minimum 500 ms between starts of `thread/loaded/list`, exponential intervals
500/1000/2000 ms then 2000 ms capped, at most 40 requests and 90 seconds from TUI
launch, whichever comes first. One page of up to 100 loaded ids per request; a
nonterminal page stops as discovery incomplete in this small private topology.
No overlapping polls or notification-driven bursts. Ordinary RPCs retain 15
seconds; rate limits never restart the case/aggregate deadline. Capture at most
once per poll, with bounded output inside the existing total capture cap. Use the
same readiness gate afresh in each paid TUI case; a prior readiness pass does not
waive current policy or identity checks. Reclassify before each input:
starting/unclassified noninteractive paint waits without input inside the same bound; an unknown prompt/modal stops. A changed
screen never inherits a previous ready classification.

Add `result.readiness={status,reason,trustLevel,threadId,evidenceRefs,pollCount}`;
threadId is null unless native proof succeeded. `passed` requires effective policy,
recognized composer, unique native thread and zero native turns during readiness;
the standalone readiness case also requires clean cleanup.
The controller records this verdict/hash separately from `canRunPilot(metadata)`.
Neither readiness nor metadata proves the question/receipt gates. Terminal and
protocol observations must be retained before cleanup on every failure too.

Why: test the least-permissive candidate before paying for inference, and prevent
input from reaching a different prompt. Cost: an unrecognized prompt, readiness
timeout or unproven thread identity still stops this bounded attempt; the classifier maintains a slightly larger
source-derived startup list. Rejected alternatives are
trusting all projects, assuming terminal text means readiness, or starting a model
turn to discover the TUI thread.

### Current-version Plan-mode proof

Before the paid pilot, inspect the pinned 0.165.0 tool registration and handler
sources for the blocking question variant: record file URLs, hashes, exact mode
and feature/configuration conditions and any alternate call path. The hq 0.162.1
fact is motivation, not this proof. If available native tool-availability data
establishes the same rule, retain it too. Do not mistake hiding a descriptive name
for enforcing unavailability of the blocking variant. Incomplete or contradictory
paths leave the rule unknown.

The pilot uses a normal TUI Plan positive control and a separate private Default
control. For the latter the probe may explicitly set `collaborationMode` on its
own `turn/start` using the Default preset returned by `collaborationMode/list`.
Use the preset's model/reasoning values with only the tagged TUI's documented
fallback for null fields; verify the selected configured model matches. The
preset mask has no developer-instruction field: clear that override only as the
pinned TUI does, rather than inventing Default instructions or assuming null
means native defaults. Retain preset, constructed settings and effective settings
from the completed controlled turn; prove the source rule applies to them.
This is producer setup, never an
observer override on the Plan thread. Record effective model/features/permissions
and show that the audited rule applies to this exact configuration. Accept either
an actual attempted blocking call with native rejection, or captured native
availability/version-pinned source proving the blocking tool unavailable in Default.
A model choosing not to call, a prose refusal, or resumed prior-turn settings is
insufficient. Source-proven unavailability does not require eliciting an impossible
call; record the selected proof path and the Default control's actual configuration.

For the positive question require positive built-in provenance plus `isBlocking:true`
and the established rule. Retain the exact `(threadId,turnId,itemId)`, native tool
call and matching result; `turn/started` has no mode field. A resume-mode read may
corroborate, never replace, this proof unless native evidence binds it to the exact
active turn. Do not retain the old unconditional pre-question resume-mode gate.
No inference bootstrap is permitted. Discover the native TUI thread first through
the readiness gate above; count the Default control and question turns separately.
Task 2's `join` repeats qualification for late attachment and a TUI Plan→Default
mode change, and `exclude` checks actual Default/async requests. If a queued old
Plan request remains blocking after mode selection changes, qualify its original
call only when the version-proven rule covers its creation semantics; do not infer
its mode from the new selection. Missing provenance or enforcement fails closed.

### Authentication boundary and prerequisite gate

The source login is read only by the controller, never by a child. Extract only
`tokens.access_token` and `tokens.account_id`; reject a missing account, malformed
JWT or missing/nonfinite `exp`. Require at least 35 minutes until expiry before
starting the batch (30-minute run budget plus five minutes' margin), and at least
the case deadline plus five minutes before each case. Parsing expiry is a lifetime
check, not cryptographic validation; server authentication must still succeed.
Never request a refresh or wait for this probe to renew a stale token.

Start with an empty private Codex home and isolated credential-store configuration.
Initialize a dedicated authentication WebSocket client with `experimentalApi: true`, then
send `account/login/start` with `type: "chatgptAuthTokens"`, the access token and
account id only. Omit this entire frame from capture and discard credential-bearing
errors without printing their contents. Require the matching successful login
response and `account/updated.authMode == "chatgptAuthTokens"` before starting
the TUI. Keep that client available for server requests. On any
`account/chatgptAuthTokens/refresh` request or authorization error, abort and clean
up; never supply refreshed credentials, call logout, or fall back to managed login.
On the deliberate server restart, repeat this same access-only login before
reconnecting the TUI, recording it as a probe action, not recovery evidence.
For the no-client variant, leave **all** WebSocket clients, including the authentication
client, disconnected during the no-client interval; authenticate only when the
later observer joins. A server with an authentication client attached is not
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

For authenticated cases, compare source-login bytes privately before and after
the case. Every case checks for unexpected private auth-file creation or
credential-store writes; `transport` never reads the live login file. Retain only
booleans, never credentials or credential hashes. A source change is not proof the
probe caused it (the live session can refresh concurrently), but it stops the batch
for investigation. Any unexpected private credential persistence fails cleanup:
stop, remove owned copies, and report a possible live-login impact without rewriting
the source. No real login, private auth copy or auth payload becomes an attachment.

Record producers for each exclusion class, but do not gate the pilot on the app
example. Missing app identity/schema/policy blocks only the app branch and keeps
gate 2 unknown. The approved exact Linear recipe remains the sole account-connected
operation allowed. Changing its app, operation, arguments or external effects
requires new concrete user approval. Native provenance/mode, auth, model,
isolation and safety prerequisites still apply before any non-app turn.

### Focused metadata diagnostic and admission

Historical metadata-02 used the diagnostic below and is complete; this revision
authorizes no further metadata case. Verify its retained verdict and hashes for
admission, while each fresh case repeats its own core checks. The diagnostic uses no TUI, `thread/start`, `turn/start`, tool invocation,
app operation or account configuration change. Keep the same empty private home,
access-only auth, private prompt-policy configuration, caps and cleanup. Do not
copy live config, MCP credentials, plugin state or refresh tokens. The reviewer's
live-config observation (only `ohai` explicitly configured, no app sections) is
attributed evidence, not independently verified by this plan or a complete view of
effective runtime settings.

Before that run, audit the pinned `rust-v0.165.0` source: follow the saved
`apps_processor.rs` calls to `apps_enabled_for_auth`, `CodexAuth::uses_codex_backend`,
the managed/external auth variants, and construction/discovery of `codex_apps` in
the MCP manager. Read relevant feature defaults, per-app policy, and initialization
or cache conditions, including the bounds on startup, initialization and tool
discovery. Save exact source URLs, bytes/hashes and line references under
`source-0.165.0`; record a bounded `app-auth-audit.json` with supporting conditions,
contradictions and unresolved paths. Do not infer managed/external equivalence
from the enum names or from the absence of a live config section. If source cannot
establish a cause, preserve the hypothesis as unresolved; do not switch login mode.
This audit is prerequisite to interpreting app availability, not a native pass.

After initialize and successful access-only login, send metadata requests in this
order. Only the single filtered `mcpServerStatus/list` request below gets a
request-local **95-second** deadline; every other metadata request keeps 15 seconds.
One 120-second case deadline bounds them together; missing a result is never
permission to extend it or retry. Use no `app/list` requests or general-directory
notifications as proof.

Deadline basis: the pinned `codex-mcp/src/mcp/mod.rs` constructs host-owned
`codex_apps` with `startup_timeout_sec:30`. `rmcp_client.rs` applies that timeout
to client creation and separately passes it to initialization and initial tool
listing; `pagination.rs` bounds the paginated listing as a whole. These sequential
phases can consume up to 90 seconds before surrounding discovery work. No single
end-to-end bound for the whole app-server request has been established, so use the
95-second precedent as a bounded probe allowance, not a native timing guarantee.
The pre-run audit must record these paths and any contrary bound; it cannot widen
the case or aggregate limit. If a contrary bound cannot fit this allowance, retain
that limitation without an automatic increase. The source links and exact hashes
live in the task's `source-0.165.0/sources.json`.

Why: avoid preempting native startup/discovery at 15 seconds. Cost if wrong: up to
80 additional seconds charged against the existing budget. This is the sole change
to request deadlines from `e91248b`; no constructor-wide default is changed.

1. `mcpServerStatus/list` with
   `{cursor:null,limit:100,detail:"toolsAndAuthOnly",serverName:"codex_apps"}`;
   omit `threadId`. At most one response page. Require a terminal `nextCursor:null`
   before declaring that filtered server absent; otherwise record
   `mcp-discovery-incomplete`. Examine only the exact server name and exact
   `linear_search` or `mcp__codex_apps__linear_search` tool names, with one unique
   match. Require `toolsError:null`, a valid tool map and the existing conservative
   `admitsApprovedArguments` schema check for the unchanged approved arguments.
   Preserve native server/tool names, input schema, auth/runtime status and available
   cache/error metadata. Cached or ambiguous discovery is not proven live availability;
   use the pinned handler's semantics to interpret it and leave it unknown if unclear.
   Never choose by a display label or substitute a similarly named operation.
2. `config/read` with `{includeLayers:false,cwd:<owned-private-workspace>}`.
   Record effective model, relevant feature/auth/app-policy settings and configuration
   provenance without credentials. Require `sandbox_mode:"read-only"`,
   `approval_policy:"on-request"` and `approvals_reviewer:"user"`, as the existing
   private config writes, independently of app availability. App admission additionally
   requires the exact private default prompt/user policy and no per-app/tool overrides.
   Unproven app-specific policy blocks the app example. Observed automatic app
   approval or permissive/unknown general sandbox/approval/credential boundaries
   stop the entire batch, including non-app probes. Config reads never write settings.
   A non-app prompt requests only the built-in question operation; the controller
   never approves unrelated native tool or permission requests.
3. `model/list` with `{cursor:null,limit:100,includeHidden:true}`, following returned
   opaque cursors for at most three pages, stopping once the exact configured model
   is found. Detect repeated cursors. Absent or unobserved model is a core blocker,
   not permission to substitute. Then `collaborationMode/list` with `{}`; require
   valid Plan/Default presets and record the inputs for the existing mode proof.
4. Only if the exact app tool/schema and prompt policy above qualify, one optional
   `app/read` with
   `{appIds:["asdk_app_69a089a326dc8191b32a3f2553f5be2c"],includeTools:true}`;
   omit `threadId`. This is secondary investigation of the already observed candidate,
   not a required general-directory lookup. Its display-only summaries cannot prove
   schema or invocation availability, and an unrelated candidate does not invalidate
   positive authoritative MCP evidence. Retain any identity association only when
   native metadata/source actually establishes it. No ID guessing or alternate lookup.

When `codex_apps` or the exact search/schema is missing, stop the app-discovery
branch immediately: no `app/read` or further app listing. Finish only independent
core config/model/preset checks if transport, auth, capture, ownership and budget
remain safe. Give the app branch a stable observation code (`codex-apps-absent`,
`linear-tool-unmatched`, `linear-schema-unproven`, `mcp-discovery-incomplete`,
`mcp-discovery-error`, or `app-prompt-policy-unproven`). Record a separate cause
`auth-mode`, `feature`, `configuration`, or `unresolved`, with exact evidence for
any established cause. An RPC timeout is an observed timeout with unresolved cause
unless stronger evidence exists. Never invent a cause merely to name the stop.
No additional metadata retry, managed-login comparison, feature enablement or
configuration repair is authorized by this diagnostic. Only the separately scoped
private trust/readiness work above changes configuration.

Retain `result.metadata = {core, app}`. Each member is
`{status:"passed"|"unknown"|"failed",reason,evidenceRefs}`; app also has `cause`
and `causeEvidenceRefs`. Core covers exact version/private identity, successful
access-only auth, safe effective config, model and preset observations. It does
not claim native mode/provenance/receipt. App records the exact tool/schema/policy
prerequisite only, never gate-2 passage; add bounded `tool` evidence fields
`{serverName,toolName,inputSchema,evidenceRefs}` only for an exact match, within
the existing verdict-size cap. No tool metadata is allowed to displace cleanup
from the bounded failure verdict. A non-app case does not consume an app ID.
If core passes and only app evidence is incomplete, the run's overall status stays
`unknown`, reason `app-prerequisite-unproven`, exit 1; never relabel it a passed
inventory. The controller may proceed to the pilot solely when core passed,
cleanup passed and no transport/auth/capture/budget/ownership failure occurred.
Every paid case repeats its own core safety/model checks in its fresh private
server; a previous result never overrides a fresh failure. Any other unknown or
failure stops dependent runs. An optional `app/read` timeout leaves its association
unknown; any unsafe channel failure still stops the whole run.

After verified metadata-02 admission and a fresh complete no-inference readiness pass, run pilot-02 once. Only its native provenance, mode and exact
receipt success admits the seven app-independent cases. Run them in the stated
order within the existing budget; stop dependent cases at any required unknown or
failure. Do not use the diagnostic to authorize a question response. At the end,
run available secret, Default/async and dedicated-permission exclusion controls;
only run the app control if its exact metadata/policy prerequisites pass again in
that control's fresh server. Missing app evidence leaves that portion of `exclude`
unknown and returns to design after the independent evidence is recorded. It never
becomes a pass, and no production plan or route activation is allowed until all
five protocol gates pass.

### Case limits and subscription budget

Store numeric case-name → deadline-seconds entries in `cases.json` (matching the
existing driver format): transport 60, metadata 120, readiness 120, pilot 360, join 300,
forms 600, exclude 600, race 480, clear 360, defer 240, reconnect 480, restart 600.
Keep the historical `inventory:120` fixture entry, but do not run it live.
These are ceilings per case, not a promise that all cases fit their sum. Keep the
15-second default RPC timeout separate from model-turn and delayed-receipt waits;
only the single metadata `mcpServerStatus/list` request and historical inventory
`app/list` path use 95 seconds; every other metadata request keeps 15 seconds. In
`clear`, delay observation for 75 seconds within its case deadline.

The original authorization remains at most 30 minutes of cumulative live probe wall time
and 30 model turns on the existing subscription, including pilot and retries;
it does not authorize buying credits or API use. The earlier 15–30 minute estimate
is provisional, not evidence that the full matrix fits this allowance. Listed per-case
ceilings total 74 minutes before cleanup when both readiness variants are needed, so an extension may be needed. Keep the
30-minute/30-turn cap unchanged; no token-cost estimate is claimed. Persist cumulative time/turn counts
across runs and resumes, continuing from 346,069 ms and two charged turns. Charge native
transport, metadata, readiness and historical inventory time as well as inference; no case gets a new budget.
Reserve 60 seconds of remaining aggregate allowance for cleanup; refuse a launch
with no execution time left after that reservation. End work at the earlier of
the case deadline or aggregate allowance minus that reserve, and charge cleanup
time too. An overrun is a failed budget assertion, never an implicit extension.
Stop at the first exhausted budget, keep partial evidence,
and seek an explicit extension before more inference. The harness timeout covers
the case deadline plus a bounded 60-second cleanup allowance; it never replaces
the driver's deadline or the aggregate budget.

### Task 1: Repair and verify the isolated probe driver

**Completed under `7d55697`, including reviewed corrections retained with report
`aac3954`.** The steps below preserve the original requirements and evidence
contract; do not reimplement or rerun them merely because this plan was revised.
Task 2 owns the metadata/admission amendment. Its earlier timeout amendment is
complete under `ccd0a75`; preserve that evidence.

**Files:** Modify retained `probe/run.mjs`, `probe/probe.test.mjs`,
`probe/fake-child.mjs`, `probe/cases.json`; create `probe/unix-websocket.mjs`,
`probe/unix-websocket.test.mjs`, `probe/history.mjs`, `probe/history.test.mjs` and
`probe/fixtures/` for captured unauthenticated wire bytes plus hash/provenance maps.
`unix-websocket.mjs` owns only HTTP Upgrade/framing; `history.mjs` owns lightweight
resume/pagination and thread-scoped failure. `run.mjs` owns RPC correlation,
processes, auth, budget, mode evidence and case orchestration. Do not edit `src/`,
schemas, dependencies, live settings or shared launchers. No proxy compatibility path.

**Interfaces:** Consume the CLI/result contracts above and the bounded transport
and history contracts below. `runCase` implements `transport`, `inventory` and
`pilot`; Task 2 adds matrix cases through the same path. The driver is not done
until fake checks pass and its initial native transport case succeeds; live
question capability remains Task 2's gate.

- [ ] **Setup:** Verify retained manifests, hydration and the recorded 773-test
  baseline. Re-run full baseline only if the checkout, dependencies or runtime
  changed since that run. Preserve the old 19-check results as historical safety
  evidence. Read the approved Linear recipe; no repeated approval is needed for
  the unchanged operation. Native app availability now uses Task 2's metadata procedure, independently of pilot admission.
- [ ] **Write failing codec tests before modifying the driver.** In
  `unix-websocket.test.mjs`, assert the boundary table below using byte vectors
  and an owned Unix socket with no Codex process. These are protocol-unit inputs,
  not claimed native fixtures. At minimum pin:
  ```js
  assert.equal(await rejectsUpgrade({ peerLimit: '0' }), 'peer-limit-invalid');
  assert.equal(await sendAtPeerLimit({ peerLimit: 16, bytes: 17 }), 'outbound-limit');
  assert.equal(await fragmentedTextBytesOver(8 * 1024 * 1024), 'inbound-limit');
  assert.equal(await utf8AcrossFragmentsWithPing(), 'decoded-once-pong-masked');
  ```
  These helper names are local test helpers, not exported driver APIs.
- [ ] **Run RED:** `just test-one "$WORK_ROOT/relay/relay-a27e7c/probe/unix-websocket.test.mjs"`.
  Record missing transport or wrong framing assertions, never a real credential
  or setup failure. Implement the bounded codec contracts below, then rerun GREEN.
- [ ] **Implement `transport` only and run the real first connection.** Start one
  owned foreground `codex app-server --listen unix://<private-socket>` in an empty
  private home. Do not read auth, start a TUI, or create a turn. Connect directly,
  validate Upgrade, send masked JSON `initialize` with `experimentalApi: true`,
  require its matching response and private `codexHome`, then send `initialized`.
  Record exact CLI/server versions, advertised cap, wire bytes and decoded message
  sizes. Close/reap and verify cleanup. Run in a tracked foreground call bounded
  by the 60-second case deadline plus at most 60 seconds cleanup; retain even
  failed attempts. HTTP 101 alone is insufficient. Failure/unknown stops here.
- [ ] **Build fake-process fixtures from the successful wire capture.** Replace
  newline-JSON fake behavior with the real HTTP/WebSocket sequence. Annotate each
  fixture's source hash, byte offsets and substitutions (random Upgrade keys,
  paths, ids); preserve original raw bytes. Add synthetic malformed/control/limit
  cases separately labelled as such. Never reuse the old fake as protocol proof.
- [ ] **Write failing driver/history tests.** Keep the existing ownership, auth,
  redaction, split-stderr secret, source-file deletion and interruption regressions.
  Add: mismatched RPC id cannot settle another call; whole/fragmented oversized
  input fails without payload logging; no newline fallback; unknown RPC/queued
  notification floods fail boundedly; `transport` never reads auth or starts a TUI;
  auth refresh aborts; budgets survive resume; lightweight resume emits exactly
  `{threadId, excludeTurns:true}` with no settings overrides; later-page receipt is
  found; cursor repetition/page exhaustion is unknown; oversize quarantines only
  its assigned thread and another thread's RPC still completes; reconnect never
  retries an answer without same-tuple pending proof. Mode tests must reject both
  previous-turn Plan settings and model non-use; source-based evidence must match
  exact version/configuration and cover the blocking variant, not just a tool name.
- [ ] **Run RED:** `just test-one "$WORK_ROOT/relay/relay-a27e7c/probe/probe.test.mjs" "$WORK_ROOT/relay/relay-a27e7c/probe/history.test.mjs"`.
  Confirm the named behavior fails, then replace the old line transport and add
  `history.mjs`, inventory and pilot orchestration. Each server/TUI/fixture child
  uses an explicit-key environment; no unrelated sentinel child may be killed.
  Use one private tmux TUI with `--remote unix://<private-socket>` and direct
  WebSocket clients; never `daemon start`, systemd or the live control socket.
  No inference runs while building/testing these fake paths.
- [x] **Historical `inventory` implementation retained.** Task 2 replaces its live
  admission role with focused metadata and separate core/app verdicts. Preserve
  the completed timeout tests and historical failed runs; do not run it live.
- [ ] **Implement `pilot` using the mode-evidence procedure below.** Capture one
  native Circle/Square blocking question from the Plan positive control, attach an
  observer without overrides, prove provenance and mode, answer Square through its
  native request id, and require a correlated native result with that exact answer.
  `CHOSEN=Square` prose is corroboration only. If mode cannot be proven, do not
  answer through the outside client; mark unknown, clean up and stop the matrix.
  Use normal TUI settings with no raw-event opt-in. Native TUI compatibility with
  external auth and shared-server semantics is itself a gate, not an assumption.
- [ ] **Run GREEN:** `just test-one "$WORK_ROOT/relay/relay-a27e7c/probe/unix-websocket.test.mjs" "$WORK_ROOT/relay/relay-a27e7c/probe/probe.test.mjs" "$WORK_ROOT/relay/relay-a27e7c/probe/history.test.mjs"`.
  Run on development Node and installed Node 22, changing only that command's PATH and printing the
  runtime version. Run `just test-fast` before checkpointing. Record counts and
  prove fake tests contacted no real daemon or inference service.
- [ ] **Verify cleanup on all paths.** A `finally` cleanup path handles normal
  completion and signal-triggered abort (SIGTERM/SIGINT). Close all WebSockets,
  stop the owned private tmux server, terminate/reap only recorded server/child
  pids whose start identity still matches, and remove owned private credential
  state/runtime directories. Refuse mismatched ownership before any kill. Capture
  overflow or cleanup failure invalidates the run. Tests preserve an unrelated
  sentinel child and exercise interruption during Upgrade, auth and pending RPC.
- [ ] **Checkpoint:** attach source/test/wire snapshots and test results; hash
  retained scratch. No repository-code commit is needed for disposable scripts.
  Mark relay-dc1f42 done only after the native `transport` result, fixture checks
  and attachments are verified. Task 2 owns the inventory/pilot live verdicts.

### Task 2: Run the current-version protocol matrix

**Files:** Extend task-local `probe/run.mjs`, `probe/probe.test.mjs`,
`probe/fake-child.mjs` and `probe/cases.json`; retain pinned source/audit additions
in `source-0.165.0/`, `app-auth-audit.json` and `tui-readiness-source.json`; create fresh `runs/<run-id>/`
evidence and `protocol-contract-report.md` in task scratch.

**Interfaces:** Consumes Task 1's CLI and result schema. Produces one `RunResult`
per case and a report mapping each approved spec gate to exact native fields,
captured ordering, supported versions and verdicts. No synthetic fixture may be
reported as native capability evidence.

Completed through `59e468e` execution: source audit, metadata/core-app separation,
95 s scoped deadline, trust/readiness driver, 112 pre-run checks and both native
attempts. Captured-frame fixes passed 114/114; the subsequent trust-overlap review
correction passed 115/115 on both runtimes. Keep all prior evidence. Completed
steps below are retained requirements, not work to redo. Execution first verifies
the r12 corrections and focused RED→GREEN logs, then retained admission and readiness-02.

- [x] **Correct trust-overlap admission offline before retry.** The review of
  `564bf02` found a substring trust match that bypassed modal rejection. Match
  the entire pinned trust surface, including its native footer, before allowing
  fallback or input. Test additional login, approval and arbitrary modal content
  above and below it at both trust levels: unknown, no fallback and no keys. Keep
  the exact valid prompt passing. Focused regression failed before the correction
  and passed afterward; combined checks passed 115/115 on both runtimes. Verify
  snapshot r11 and this evidence before the next unchecked step.

- [x] **Correct post-Plan screen admission before retry.** Review of `408dd93`
  identified the missing medium effort/Plan indicator. Retain pinned formatter
  source and a synthetic Plan fixture, reproduce rejection in the classifier and
  the fake `/plan` sequence, then admit only the known decoration with the exact
  workspace. Check that post-Plan modals still stop before question input/charge
  and protocol mode/provenance gates still apply. The four new focused checks
  went from 1/4 to 4/4; combined r12 checks passed 119/119 on both runtimes.
- [x] **Inspect the retained dotted Linear entry offline.** The exact raw
  metadata-02 response contains only `name` for `linear.search`, so no argument
  compatibility decision is possible. Retain its schema in the next separately
  authorized metadata capture; test that this remains evidence-only and cannot
  admit an alias or invoke any app. This plan still authorizes no metadata rerun.

- [ ] **Verify source and retained state.** Read `tui-readiness-source.json`, exact
  pinned files/snapshots and `6d0751d`. Confirm the remote-untrusted skip and
  pre-prompt thread-start paths apply to the selected CLI/socket. Preserve the
  live-config count as reviewer observation. Check budget 346069 ms/two turns and
  all retained hashes before launch. Never rewrite old results or reset counters.
- [x] **Write failing trust/readiness tests** in `probe/probe.test.mjs`, with
  synthetic screens in `probe/fake-child.mjs` and pinned composer/trust snapshots
  under `probe/fixtures/`. Preserve captured `readiness-01-screen.json` and its
  raw-source hash: the owned model/workspace status line is not typed input.
  Test exact owned-path trust only; parent/root/symlink
  targets reject; both trust levels retain explicit policies; trusted post-action
  drift or unknown config stops before a turn. Untrusted success never escalates;
  only clean exact `untrusted-trust-prompt` admits one trusted attempt. An unknown
  prompt, login/modal/approval, prefilled composer or footer-only fake receives
  no keys. Unknown prompts/modals stop even with ready composer/startup text behind
  them. Test placeholder header → single/multiple MCP startup → ready progression
  without keys or charged turns before readiness; startup plus a visible composer
  stays starting. Ready composer with varying welcome/animation/warning history
  stays ready; the captured model/workspace status line for the exact owned path
  is accepted without treating it as native mode/model proof. Retain MCP warning
  evidence without passing the app gate. Match
  active input/status regions, not quoted startup/composer text in history.
  Missing/ambiguous/disappeared native thread receives no `/plan` or
  model input and consumes no turn. A previous control thread cannot qualify.
- [x] **Pin timing and failure assertions.** Fake clocks prove poll starts are
  at least 500 ms apart, intervals 500/1000/2000 ms capped, no overlap, at most 40 calls,
  readiness ends by 90 s even inside case 120 s, and earlier aggregate exhaustion
  wins. Empty first paint is bounded 5 s; starting and unclassified noninteractive
  paint never reset the 40-request/90-second bound or trigger trust escalation.
  A startup stall ends unknown with zero turns; an unknown prompt/modal stops
  immediately without keys. A startup warning followed by the ready composer
  does not itself stop or authorize the app control. A later native id clears an
  earlier missing-id flag, without qualifying an unready screen or resetting limits.
  Refreshed config/resume mismatch, refresh request, capture overflow, private
  auth persistence and cleanup errors invalidate readiness and prevent the pilot.
  Assert failure terminal/protocol evidence is saved without credentials.
- [x] **Test corrected metadata evidence before retry.** Retain the existing
  projection regression; add an exact-name miss whose server is present, absent
  server, case/prefix naming variants and multiple matches. Capture identifiers
  and available status/schema evidence without credential-bearing prose. If the
  filter still omits material needed to verify a verdict, record app unknown with
  explicit evidence limitation, never a passed app prerequisite. No alias becomes
  authorized by resemblance; schema and identity still must match the approved
  search. Test projected/cached/partial evidence cannot replace authoritative data.
- [x] **Run RED** through `just test-one` on the changed probe test file and retain
  the named missing-behavior failures. Do not edit runtime code before those tests.
- [x] **Implement the bounded gate** in `probe/run.mjs`: the explicit trust-level
  option, isolated workspace, pure screen classifier, serial readiness loop,
  effective config/thread checks, `RunResult.readiness`, and failed-pane capture.
  Add `readiness:120` in `probe/cases.json`. Use the established RPC/cleanup/capture
  code; no new framework/dependency. Remove the blind `/plan` and bootstrap path;
  the paid pilot uses the same positive gate before input. Keep old evidence intact.
- [x] **Run GREEN and checkpoint.** Run the combined probe/codec/history files
  through `just test-one` on development Node and Node 22, recording versions and
  counts. Obey the invoking checkout's validated `.tt.toml`: policy-off means
  focused tests plus hygiene, no broad rerun; absent/enabled means the documented
  fast check. Run `just check` and `tasks check`. Attach source/tests/fixtures/logs
  and refresh manifests before native work. No production code changes.
- [ ] **Preflight.** Read hq-25665e without taking its claim; verify CLI 0.165.0,
  configured gpt-6-astra, auth lifetime, private ownership and remaining budget.
  The private workspace starts empty with no project layers that could run code
  upon trust. Do not connect to the live daemon or use the desktop.
- [ ] **Verify retained admission, without another diagnostic.** Hash-check
  `runs/metadata-02` and its original result; require `canRunPilot` true and complete
  cleanup. Preserve the exact-name mismatch and the schema evidence limit. Any
  missing/corrupt evidence or failed core admission stops; do not repeat metadata
  or qualify `linear.search` by resemblance.
- [ ] **Retry readiness once without inference:** `--case readiness --trust-level
  untrusted`, fresh `runs/readiness-02`, harness 180 s. Use the corrected matcher
  and captured-frame regression, with no `/plan`, prompt or charged turn. Require
  composer plus native thread/read/resume policy and cleanup. Only a clean exact
  `untrusted-trust-prompt` permits fresh `runs/readiness-03 --trust-level trusted`
  under the same bounds. Any other failure/unknown stops, with no additional live
  readiness attempt. All cases retain fresh server/home/workspace and original budget.
- [ ] **Retry the pilot once:** fresh `runs/pilot-02 --case pilot --trust-level
  <passed-level>`, harness 420 s, case 360 s. Repeat core and readiness checks in that
  private server; then Default control and Plan question proof. Count turns only
  immediately before authorized native submissions, never before readiness.
  Read exact provenance, mode, receipt and cleanup before admitting another case.
  Another missing/unknown gate produces only the updated blocker report. No
  further pilot attempt is included in this revision.
- [ ] **Add and run each case below, once each initially.** Each is a separate
  bounded run with fresh isolation and a result. Use two named clients for races.
  Runtime is unmeasured and may exceed the initial allowance; enforce the
  subscription budget above. No idle-desktop window is required.
  A retry names the observed cause and changes
  only the probe defect or prerequisite. A required failed/unknown contract stops
  dependent cases and production work; only the app prerequisite has the explicitly
  bounded ordering exception above. Run available exclusions after those seven cases.
  Before each newly implemented case runs live, add and pass its fake-process
  assertions through `just test-one`, preserving the case-specific requirements
  below; fake success alone never qualifies its native verdict.

| Case | Required observation and assertion |
| --- | --- |
| `join` | A TUI-created thread, with ordinary settings and no special raw-event opt-in, is discoverable through paginated `thread/loaded/list`. Early and late `thread/resume` observers receive the pending request and enough evidence to identify the built-in call. Compare model, mode, instructions, approvals and workspace before/after joining; none changes, no turn starts. A completed/unloaded thread is not resumed merely for discovery. Repeat after Plan→Default selection changes; prove eligibility from creation-time evidence, never current selection. Use the history/isolation controls below. |
| `forms` | Native single choice, Other, nullable-options text, multiple questions and native decline are captured and answered through the WebSocket client. Record exact native question-id mappings, labels/text and declined result. Obtain decline from actual native interaction; do not guess `{}` or a magic string. If a required form cannot be produced or represented, report it unknown/unsupported. |
| `exclude` | Establish a positive discriminator for an ordinary built-in blocking call. Execute the prerequisite recipes below and record the actual method and originating tool for every negative class. Never accept a native app approval; only the exact authorized read-only fallback search may execute if prompting is bypassed, which fails the case. An unobserved negative class or discriminator based only on labels/prose is not a pass. Controlled synthetic inputs test the proposed predicate but are labelled synthetic, not capability evidence. |
| `race` | On separate questions, order desktop before client and client before desktop, including a delayed client write after the other client wins. Identify the actual accepted answer by call-correlated output, show that resolution alone does not establish it, and record how duplicate responses behave. A different native answer must never be called receipt of the outside client candidate. |
| `clear` | Interrupt an unanswered turn through the private controller, capture cleanup resolution and prove no matching answer exists. Separately delay receipt observation beyond 60 seconds and recover the exact output. Record ordering when resolution precedes the output; distinguish temporarily missing receipt from cleared-without-answer. |
| `defer` | Keep the outside client silent, leave the native question pending, then answer using only native TUI input. No turn advances before that input. Capture the matching native result and prove the outside client has not answered or interrupted. This establishes native handback; relay's `released` state itself is tested in the later production phase. |
| `reconnect` | Disconnect/recreate only the outside client while a question waits, then separately disconnect after sending its answer but before reading receipt. Rejoin without overrides. Find a positive pending replay or exact recorded result, and an authoritative completion condition for reconciliation. Silence, an arbitrary grace period, and a partial page are not barriers. Repeat with a fresh controller process, representing relay restart. |
| `restart` | Stop/reap only the private server while a question waits, restart against the same private home, once with the private TUI reconnecting and once with no client attached until later. Record daemon identity and old/new turn/item/RPC ids. An old response must never answer a new call even if its RPC id is reused. Record interrupted vs recovered behavior exactly; no-client recovery is not inferred from the attached run. |

Exclusion producers (these are attempts to elicit real protocol examples, not
claims that this installation supports them):

| Class | Producer and required evidence |
| --- | --- |
| Secret question | In a private Plan thread ask the native question tool for a secret-marked field using only the dummy value `probe-not-a-secret`. Require observed `isSecret: true` and built-in provenance. If the native tool cannot emit it, record unknown; hand-crafted JSON does not replace it. |
| Default/async question | Use a separate owned Default control turn whose `turn/start` explicitly sets Default as above; prompt its asynchronous question tool for Circle/Square. Require an actual nonblocking request and originating call; a prose question is not evidence. A prior-turn resume-mode value cannot qualify this control. Native absence of the blocking variant can prove mode enforcement, but does not replace the separately required async exclusion example. |
| Permission request | Ask the private agent to use built-in `request_permissions` for read access to a controller-created sentinel outside its allowed workspace, never a real user file; deny the request before the read. Require observed `item/permissions/requestApproval` with native tool provenance, plus the version-scoped path audit below. A command-execution approval alone does not prove this permission-tool case. A question-method permission example is required only if the protocol, documentation or native evidence establishes that path. |
| App approval using the question method | Requires a connected app plus user-approved account-connected recipe. Before this app control name one actual tool, exact synthetic arguments, private approval policy forcing a prompt, and the point where the driver denies/cancels before invocation. Choose an operation whose approval can be observed without an external write; never enable automatic approval or a permissive sandbox. Do not connect/install an app or change live account settings merely to obtain this case. If no existing app can safely produce it, leave this exclusion and gate 2 unknown; it does not block the pilot or seven independent cases. At runtime require a real question-method approval with app-tool provenance; another approval method or cached consent is unknown. |

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

The account-connected recipe is **already approved by the user** in this task's
session and retained as `app-probe-recipe.md`. Use only the existing Linear search
(current harness catalog name `mcp__codex_apps__linear_search`) with exact arguments
`{"query":"relay-question-probe-no-match-20261029","limit":1,"type":"all"}`.
In the isolated config set `apps._default.default_tools_approval_mode = "prompt"`
and `apps._default.approvals_reviewer = "user"`, with no per-app/tool overrides.
Confirm the actual native tool name and advertised argument schema by metadata;
if the approved operation cannot be identified exactly, stop the app control, never substitute.
Request one attempt, then decline the offered native approval. Never accept it or
write externally. If the prompt is bypassed, only this read-only search is allowed
to execute, and the case fails. Do not retain returned account content in portable
evidence. Native availability and producing the right prompt remain unproven;
those are prerequisite/result checks, not grounds to ask for the same approval again.
No app installation, new account setting or different operation is authorized.

History/isolation controls in `join`: reuse the owned pilot/control-style threads
and normal generated history; do not manufacture a huge account transcript. Fetch
turns/items with `pageSize:1` so an exact result on a later page is exercised, and
record `excludeTurns:true` resume sizes. Use two independently resumed owned
threads and observe notification subscription scope. Then on a disposable thread
channel set `maxIncomingBytes` below a previously measured history-response size,
repeat that bounded history request, and require a visible thread-id/limit failure,
channel closure and no answer send. The other thread must complete an ordinary
RPC and remain able to answer natively. The failing channel's one metadata-only
reconnect uses the normal cap; no auto-refetch or response resend. Record any
cross-thread broadcast and whether it defeats containment; if so, fail isolation.
The deliberately induced, correctly isolated failure is a passing test assertion;
an unexpected limit failure in a required native observation leaves that gate
unknown. These lower-cap controls prove the same failure path without generating
an actual 8 MiB payload. Synthetic tests separately cover the real cap's length boundaries.
When early stop prevents a control, report it unobserved, never passed.

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

**Files:** Update `docs/notes/2026-10-28-codex-question-protocol-report.md` in the
code worktree, derived from the portable Task 2 report. On passing all prerequisite
gates, create `docs/plans/2026-10-28-codex-question-connector.md`; otherwise produce
only the report and any required spec revision for user review.

**Interfaces:** Consumes every `RunResult` plus exact source hashes. Produces a
checked report and the next frozen artifact; never an enabled connector.

- [ ] **Adjudicate completeness.** Require all five protocol prerequisite gates (spec gates 1–5) in the
  approved spec, including no-client recovery and native forms, plus Task 1 transport/history safety
  checks. Spec gates 6–7 remain production/phone obligations, not completed here. List any missing
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

This amendment is reviewed before any further native run. Keith approved `59e468e`,
whose metadata-02/readiness-01 attempts and offline driver corrections are complete.
That approval does not authorize the additional readiness attempt proposed here.
Task 1 remains done; Task 2 resumes with retained admission/readiness-02 only after
this frozen revision is approved. Task 3 retains the report/next-artifact obligation.
Continue inline execution; no independent parallel implementation is needed.
Reuse children relay-dc1f42 (Task 1), relay-01090a (Task 2) and relay-4746ed
(Task 3), updating their parent-plan references to this frozen revision. Preserve
the Task 1 → Task 2 → Task 3 dependency chain; do not create replacement tasks. This is a documented workaround for tasks-85e8cd, not a
waiver of task tracking or plan review. Once ordinary links resolve, restore them.

At the end, keep relay-a27e7c open for the actual connector implementation and
phone acceptance. Do not integrate unreviewed artifacts, activate a service or
leave an unattended probe running across a review gate.

The earlier conditional approval after `e91248b` was discharged by `91c1c14` and
its completed runs. It does not approve this additional readiness retry. Keep
the approved spec unchanged and preserve inline execution after separate review.
