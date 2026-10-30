# Codex question correction checkpoint: cancellation encoding unknown

## Current outcome

The user approved r8 and the correction plan (records `e4b4e2a66`, SHA-256
`ef926147e87a8379d384cb9d495ca00ce8135c0113c9147b383b65a26408f62a`).
The correction plan executed inline through its blocker-report path. A stale
approval park was a controller error, cleared before execution; no repeat approval
of this plan is owed. Spec r8 at `00f2d31` remains the approved contract.

The reader and delivery prerequisites are corrected. The native mixed-history
pilot, decline controls and both disconnect variants passed. Interruption produced
an unrecognized non-answer output, `aborted by user after 0.1s`, followed by the
matching turn-aborted barrier. The reader correctly returns **unknown**, never
answered or consumed. The native cancellation mapping remains **unobserved**:
no cancellation fixture or decoder was fabricated from source text. This stops
continuation of the original races/defer/recovery/TUI matrix under the approved
plan. No production plan or connector implementation was written.

The next controller action is a scoped source/native cancellation-contract review,
using the captured output and pinned runner source, before proposing a bounded
recognizer or any further native attempt. This is a new evidence gap, not a renewed
approval request for the plan already executed. The parent relay-a27e7c remains
open and owns this follow-up and all original production/acceptance obligations.

## Fresh native controls

| Run | Outcome | Wall time | Evidence and limit |
| --- | --- | ---: | --- |
| `corrected-pilot-01` | passed | 521 ms | MCP approval is other; controller Cancel prevents tools/call; its array is discarded; a later built-in in the same thread/rollout has exact protocol/rollout/provider Blue receipt |
| `interrupt-pending-01` | unknown | 2419 ms | correlated resolution and interrupted completion; unknown non-answer output precedes matching turn-aborted; delayed read/reopen stays unknown; no cancellation decoder configured |
| `decline-collisions-01` | passed | 2747 ms | valid decline, generic client error and malformed controller body each yield exactly `{"answers":{}}`; equality identifies neither winning client nor cause |
| `disconnect-pending-01` | passed | 40566 ms | outside-only and last-client loss each observed for 20 s; still-loaded discovery precedes resume; exact tuple replay then outside Blue has three matching witnesses |

The turn-transition client-error exception was a separate fourth decline turn.
Request resolution occurred without provider continuation, matching output or
turn-end during a 2-second observation. The still-pending turn was then explicitly
interrupted. Pinned source supplies the early-return fact; elapsed time alone does
not establish an unbounded negative. Receiver-failure fallback is source/unit
knowledge, not an inferred consequence of every disconnect.

Both disconnect observations were pending/absent before reattachment and later
had positive replay and receipt evidence. These results establish only the two
observed private controls on 0.165.0. They do not establish daemon restart,
generation handling, stale-answer rejection, re-ask, explicit unloaded-thread
behavior, or recovery of a live native TUI.

## Evidence types and corrected prerequisites

- **Source:** archive/file hashes pin the nonparallel executor default, absent
  request-input override, router lookup and exclusive execution lock. Pending input
  and answer submission use turn ids. A version change requires checking the pinned
  source again. Native simultaneous supersession cannot be reproduced on this serial
  runtime; the earlier two-call observation was sequential.
- **Unit:** one turn owner; arrival of an ineligible successor revokes the old send
  before filtering; queued withdrawal precedes admission; send ownership is checked
  again immediately before sending. Same-tuple replay cannot change questions.
  Closed/resolved owners and malformed outside answer maps never send. These are
  disposable guard checks, not shipped inbox lifecycle behavior.
- **Reader:** every open starts at byte 0; orphan outputs are unknown. Every other
  output shape is discarded. Duplicate fingerprints stay in memory only, never
  exposed in snapshots/logs/persistence/forwarding. Conflicting duplicates make
  unknown sticky. Native and synthetic privacy checks inspect actual Map entries
  and serialized protocol/provider/rollout/result evidence.
- **Settlement:** valid answer maps, including empty decline, are answers; only a
  validated native cancellation mapping may identify a cancellation. Arbitrary
  non-answer strings remain unknown even when a matching turn barrier exists.
  Reader failure outranks cached receipt. A no-output/barrier reader result alone
  is insufficient for disappearance without the matching protocol transition.
- **Limits:** a line over 1 MiB or file over 64 MiB remains unknown after reopening,
  including unrelated image history. This accepted fail-closed limit keeps those
  threads native; no prefix skipping was added.
- **Deadlines:** the original case owns one aggregate deadline across all leaves.
  Idle observation honors abort; canceled work cannot pass. Independent cleanup
  attempts have a separate 60-second allowance and persist failure/unresolved
  ownership on timeout. The server also bounds its post-SIGKILL close wait.
- **Runbook:** the proposed post-handoff recognized-cancellation label remains
  unconfirmed but means a known end without an answer, not possible future delivery.
  The three lifecycle expectations in the interruption result are explicitly unit
  expectations; no inbox transition was observed.

## Why the native interruption remains unknown

`interruption-0.165.0.json` pins the raw native file, selected line hashes, minimized
unknown-output fixture and `core/src/tools/parallel.rs` SHA-256
`7b65d5c5538db2fee9e9367490e46f3b64f0190efb94c842e5718a1abd90e87c`.
Lines 275–317 create an aborted response for cancellation outside the handler;
lines 363–385 format elapsed seconds as `aborted by user after {secs:.1}s`.
This is a separate source path from the handler's dropped-channel text. The native
capture contains the timed form; the handler form was not observed.

No elapsed-time grammar, prefix matcher, source-text default, or interpretation of
an arbitrary non-answer string was added. The captured timed output has a regression
that remains unknown and never consumes either a saved answer or decline. Source
plus one native capture makes the next review concrete; it does not silently amend
the approved reader contract.

## Gate disposition and preservation

| Gate | Current state |
| --- | --- |
| 1 transport/discovery/join | earlier pilot and fresh still-loaded reconnect controls pass; explicit unloaded/native TUI cases remain open |
| 2 forms/provenance/exclusions | prior forms/exclusions retained; fresh mixed MCP-to-built-in history now passes; supersession guard is unit/source evidence |
| 3 receipt/competition/clear/delay | exact supported receipts and decline value collisions pass; new interruption form remains unknown; races and delays unrun |
| 4 defer | unrun |
| 5 reconnect/restart/re-ask | two bounded disconnect controls pass; original restart/re-ask/generation obligations remain unrun |
| 6 production unit/IPC | no production implementation |
| 7 real model/phone/native desktop | unchanged, unrun; no 0.166.0 capability established |

Original failed runs and historical text below are preserved as historical evidence.
The original Task5–7 records remain unstarted behind the correction checkpoint.
The all-gates report and later production plan remain obligations of the parent;
repurposing the former blocker-report record did not retire them.

## Verification, review and retained evidence

`just setup` succeeded; fresh execution baseline `just test` passed **773/773**.
With no `.tt.toml` in this checkout, the enabled test policy applies. All task-local
checks used `just test-one`: final combined **85/85** on Node **26.5.0** and
**22.23.2** (reader21, guard10, provider8, driver46). Privacy/classification,
ownership and new controls were written and observed RED before implementation.
The new native timed-string regression characterizes the intentional unknown
result and passes without widening the decoder.

Pre-native impl23 found Important3; expiry/cleanup regressions were reproduced RED
and fixed GREEN, and receive-hook coverage was corrected. Fresh impl24 accepted
prerequisites with no Critical/Important finding. Full reports and exact reviewer
identity `codex/gpt-6-astra` are attached to the parent. Whole-correction impl25
accepted the blocker checkpoint with no Critical/Important findings and one new
Minor finding; it grants neither continuation nor integration approval. Final hygiene and whole-
correction review are recorded on the task before freezing this checkpoint.
`just test-fast` passed **773/773** after the correction controls.
`just check`, `tasks check` and whitespace checks pass with no errors. Four
historical r3 headings are reported as unlinked after their records were
intentionally retasked; provenance notes preserve the old links. The frozen r3
text remains unchanged, and its remaining matrix/all-gates scope stays open.

Deferred minors remain: overlapping provider requests may share an index; cleanup
rejection can omit detailed attached server/socket metadata while still failing.
The disposable guard also lacks an option-label uniqueness check: captured forms
have distinct labels, but broader form-validation claims require that refusal test
and check first. The old duplicate Task7 prompt wording retains its one-submission
ruling and stays deferred until that plan is next edited.
Earlier unrelated deferred findings remain in their original reports. The former
aggregate-deadline minor is fixed before any delayed cases. No delayed case ran.

`correction-evidence-index.json` and `interruption-0.165.0.json` are attached to
relay-3ff852 along with corrected probes, native unknown fixture and focused logs.
Raw runs, manifests and canonical task-local inputs stay on persistent task-owned
storage, located by retained-item notes. The parent owns cleanup/review follow-up.
Every owned server PID and exact socket/lock path was independently absent after
each run. No process survived, no subscription/credential turn was spent, no shared
launcher or live daemon/desktop setting changed, and nothing was pushed.

The branch `feat/codex-question` remains unmerged in `.worktrees/codex-question`.
It integrates only after reviewed implementation, outstanding native/phone gates,
and the user's approval; this checkpoint grants no merge or activation.

---

# Historical checkpoint: structured-output blocker

## Review update: proposed r8

Supplied spec review round 13 (claude-code/claude-opus-5-5: revise,
Important 2, Minor 1) accepts the round-12 corrections and asks for a short r8.
R8 restores one pending native request per thread/turn, supersession with old-answer
send revocation, and serial-runtime re-proof for every supported version change.
It also defines version-probed cancellation output as settled without an answer,
with pre-/post-handoff lifecycle handling, and keeps output fingerprints only in
memory, never in logs, persistence or forwarding. Gate 3 must capture the native
cancellation encoding; the source string is not new native observation.

Pinned 0.165.0 source confirms turn-keyed replacement, default serial tools without
a request-input override, and the handler's dropped-channel cancellation text.
The current probe's output-presence-based `callSettled` does not implement the new
classification. No executable file changed or native case reran. R8 is frozen for
a short diff re-check/text review before correction planning; the execution blocker
and all remaining gates stay as recorded below.

## Frozen f70dd8d r7 review update

Spec review round 12 (claude-code/claude-opus-5-5: revise, Important 4, Minor 1)
was supplied by the user, who approved incorporating its findings before the
correction plan. Proposed r7 of the [connector addendum](../specs/2026-10-28-codex-question-connector.md)
discards every `other` output shape with only id/fingerprint retained, uses predicate
classes rather than MCP/built-in taxonomy, states the persistent 1 MiB/64 MiB
fail-closed limits, and limits decline receipt to value equality. It also specifies
byte-0 rebuild and unidentified outputs without an earlier call.

The pinned source confirms non-MCP inline-image output and empty-map fallbacks
for client errors, receiver failure and malformed response bodies. Turn-transition
errors are an exception: they return without an answer. Whether disconnect causes
receiver failure remains unverified and belongs to gate 5. The reviewer supplied
a size-only local census (87/12,697 oversized-line files; two over 64 MiB); this
session neither repeated that census nor read live rollout content.

No executable reader changed, no native case reran, and no new runtime verification
is claimed. The current probe starts each open at byte 0, but still retains strings
for `other` or not-yet-classified calls; r7 specifies a correction, not a capability
already present. R7 awaits frozen-text review before a correction plan.

## Frozen c36e7b7 execution checkpoint

Approved scripted plan r3 (records `82be32595`, SHA-256
`bfea9cdee60ec7eeddddf08e3da836b9483be9276541737e00e3389694ac9c14`) executed
inline through Tasks 1–3 and Task 4's native controls. Native work stopped at a
valid MCP rollout shape that the approved string-only reader rejects. No production
connector or production plan was written. Tasks 5–7 remain unrun, and relay-a27e7c
remains open. Proposed spec r6 in
[the connector addendum](../specs/2026-10-28-codex-question-connector.md)
requires user review before a revised probe plan or reader implementation.

The failure is conservative: no unsupported answer was reported consumed. Native
app exclusion itself was observed before cancellation; the complete gate remains
unsettled because a legitimate MCP output makes later reader evidence unknown.

## Runs and evidence

| Run | Outcome | Wall time | Scope |
| --- | --- | ---: | --- |
| `scripted-pilot-01` | passed | 649 ms | late join, policy preservation, loaded-thread discovery, idle join, exact Blue answer in protocol/rollout/provider |
| `scripted-forms-01` | eight subcases passed | 3318 ms | choice, Other text, three questions, decline, RPC error, null/empty options refusal, two sequential calls |
| `scripted-exclude-01` | partial; app failed | 16593 ms | secret, Default refusal and Default async passed; old provider projection omitted nested MCP tool names |
| `scripted-app-02` | failed reader barrier | 672 ms | corrected namespace projection reached native approval and Cancel; valid array output made reader unknown |

The installed binary was explicitly pinned to `codex-cli 0.165.0`, SHA-256
`c06a67fd8ac76508dc78bd99ce20c9f317b8d568beda59485f3f4134df9962d5`.
The shared launcher now resolves to 0.166.0 and was never changed. These results
establish no 0.166.0 capability. Pinned source tarball SHA-256 is
`4e066a7dbd1234efa7458c2b137161bb7ddde1dde6be4ed4c8f38e6c45f862ab`.

Each run used private homes, an app-server, two clients and a loopback scripted
Responses provider. Every child environment was built from explicit safe keys;
no auth file or credential was supplied. Scripted turns spent no subscription and
left the earlier subscription budget unchanged at 373609 ms/two charged turns,
inactive. No live daemon, host launcher, desktop, installation or upstream post
was touched. The private MCP fixture implements only initialize, initialized,
tools/list and tools/call; the Cancel control recorded no tools/call.

Raw runs live in the task-owned persistent scratch; their portable result/evidence
attachments and retained-item notes are the durable lookup. Each result lists
relative evidence paths and hashes. Raw native files are preserved, not rewritten
when a later observation corrects the interpretation.

## Native findings and limits

- Pilot tuple uses native thread/turn ids and `itemId = call_id`. The request was
  blocking; resume preserved Plan, model, approvals, sandbox and cwd. The outside
  client joined after turn start, discovered a second loaded thread with limit1
  paging, and an idle join emitted no new turn/provider request in its bounded
  observation. No explicit unloaded-thread or daemon-restart control ran.
- Exact native choice receipt is `{"answers":{"q_color":{"answers":["Blue"]}}}`.
  The rollout call had no namespace, its output was a JSON string, and matching
  `task_complete.turn_id` followed that output. A captured minimized fixture now
  checks this file order and identity.
- Other accepted arbitrary text, and three question ids mapped independently.
  Empty-map decline and JSON-RPC error both reached the model as `{"answers":{}}`.
  Null and empty options produced native error outputs without a request.
- Two calls in one scripted model response were accepted sequentially, each with
  distinct native request and call ids and matching output. This does not prove
  simultaneous pending-call safety or retire the production single-question rule.
- Secret questions remained marked and the outside client sent no answer. Default
  without its feature refused the scripted built-in; enabling the feature produced
  a nonblocking request answered only by the controller. Permission/elicitation
  method exclusion has a synthetic test; no permission recipe ran.
- Codex advertises MCP tools inside namespace groups. The initial provider kept
  only the group name. A source-backed correction projects child name plus group
  namespace, retaining neither schema nor description. RED→GREEN and a fresh
  review preceded the app-only retry; the original failed result remains failed.
- The app retry found `noop`/`mcp__relay_fixture`, positively classified it `other`,
  observed `mcp_tool_call_approval_<id>`, and sent Cancel only through the controller.
  Its native output was an array of `input_text` objects, followed by the matching
  turn's `task_complete`. The reader rejected that array as `malformed-line` and
  stayed unknown. The provider also intentionally retains only string outputs.
  A string receipt or a successful full three-witness app result was not observed.

The minimized `scripted-structured-output-observation.json` retains field types,
call identity, raw-line hashes and assertions, without array text. Source mapping
is `scripted-namespace-source.json`: core MCP handler SHA-256
`3c67d9908c1763fafa6711ee9d402c86c502cb35297e39462bcd908145c58fe4`, namespace
collector `8c8bca4bcc32bdcbca5a89034f7b22461f65c85246e8ad994b2b68aafca1d1bd`,
request-input protocol `616c81d35b96785aa30766bedb50d4597aae219879b237b4a2ebbe8315242591`.

## Gates

| Gate | State at this checkpoint |
| --- | --- |
| 1 transport/discovery/join | pilot properties passed; explicit unload and later lifecycle controls remain unrun |
| 2 forms/provenance/exclusions | supported forms and three exclusions passed; app exclusion observed, structured-output reader policy unresolved |
| 3 exact receipt/competition/clear/delay | pilot/forms exact receipts passed; representative MCP history fails reader; races, clear and delayed receipt unrun |
| 4 defer | unrun |
| 5 reconnect/restart/re-ask | unrun |
| 6 production unit/IPC | no production implementation |
| 7 real model/phone/native desktop | unrun; remains a distinct user-present activation gate |

A completed protocol turn alone does not settle receipt or disappearance. No gate
is marked passed because an elapsed wait, model prose or a successful synthetic
fixture suggested it. A failed or unknown gate yields this blocker report, not a
production plan.

## Verification and review

Hydration used `just setup`. A fresh `just test` baseline passed 773/773 on Node
26.5.0; `.tt.toml` is absent. Task-local tests went through `just test-one` only:
provider 8, reader 12 (including captured pilot), driver 21, combined 41/41 on
Node26.5.0 and Node22.23.2. Missing-module RED covered new modules; namespace
privacy and nested-group regressions each failed before their correction.
`just check` passed; fresh final hygiene and the whole-slice review are recorded
on the task before freezing this checkpoint.

Fresh reviewers accepted the namespace privacy correction and group projection.
Their full reports are retained on the task. Deferred minors: overlapping provider
requests may share an index; aggregate forms/exclude deadlines are not applied
(the observed runs were short and every subcase retained its 120-second bound).
The latter must be fixed in the next reviewed plan before delayed cases.

All 50 recorded pilot/forms/exclude evidence hashes were verified before the app
retry. Server PIDs and exact socket/lock candidates were absent; host-load reported
nothing left running. The app retry's hashes and cleanup are independently checked
at this freeze. Private raw homes remain evidence, not active daemons.

## Decisions

- Keep this run blocked on the valid structured-output shape; do not weaken unknown
  or normalize arrays into guessed answer strings. Why: the approved reader has no
  such mapping. Cost: remaining native cases and production wait for review.
- Recommend r6's narrow discard for arrays belonging to positively identified other
  calls, keeping built-in and unidentified arrays unknown. Why: unrelated MCP history
  must not permanently poison later built-in evidence. Cost: correlation/provenance
  validation becomes a prerequisite for that discard; its tests and plan need review.
- The r3 null-options ruling stands: unsupported/native; text uses Other. Why: native
  refusal was observed. Cost: future null-option support requires new evidence.
- The explicit older binary and app-only retry rulings are retained in the ledger.
  No live pointer changed; the extra credential-free attempt corrected a probe
  projection defect and preserved both failed results.

The next human action is review of proposed spec r6 and this blocker checkpoint.
After approval, the agent writes a separately reviewed correction plan, then
resumes gate evidence. No executable reader change implements r6 yet.

## Historical report through cc94eaf

# Codex question feasibility: receipt gate blocked by protocol source

## Current outcome after checkpoint be590be

Planning of the first-question/direct-join pilot stopped before drafting. An
offline audit of the Codex 0.165.0 source found that the receipt gate (spec
gate 3) cannot pass on the route this task targets. No native run, model turn,
driver change or daemon contact occurred. Budget is unchanged at **373609ms,
two charged turns**, inactive.

The question the report left open was whether a client that joins late gets
tool-call evidence. The audit answers it for receipt. For a thread the native TUI
started, an outside app-server client has no protocol record of the answer the
model received for a built-in `request_user_input` call. It also cannot tell
whether its own response or the TUI's was accepted:

- The handler serializes the answer into an ordinary function output for the
  model (`core/src/tools/handlers/request_user_input.rs:129–153`). Core maps
  only message, reasoning, web-search and image-generation response items to
  typed turn items (`core/src/event_mapping.rs:196–271`). The only producer of a
  `functionCallOutput` turn item is injected pending input
  (`core/src/hook_runtime.rs:760–780`), not an ordinary tool result.
- Raw response items reach clients only when the thread's raw-event flag is set
  (`app-server/src/request_processors/thread_lifecycle.rs:343–356`). Only
  `thread/start.experimentalRawEvents` sets it (`app-server/src/thread_state.rs:602–627`,
  `app-server-protocol/src/protocol/v2/thread.rs:161–165`, documented internal
  use only). The TUI leaves it false (`tui/src/app_server_session.rs:2190–2231`).
  `thread/resume` has no such parameter; upstream openai/codex#34353 records the
  same resume gap, last reconfirmed by a commenter on 0.164.0.
- Stored and paginated history keep only typed items, so `thread/turns/list`,
  `thread/items/list` and resume pages have no other source for the output
  (`app-server-protocol/src/protocol/thread_history.rs:430–441,481–505`;
  `thread-store/src/local/thread_history.rs:515–540`).
- One server request id is shared by every subscribed connection. The first
  response removes the callback; a later one is only logged, and nothing is sent
  back (`app-server/src/outgoing_message.rs:484–512,578–597`).
  `serverRequest/resolved` carries only `threadId` and `requestId`. Upstream's own
  round-trip test asserts nothing more before `turn/completed`
  (`app-server/tests/suite/v2/request_user_input.rs:143–176`).

The approved spec says: "If no correlated output is available, the receipt gate
fails and the route remains disabled." It also rules out shipping permanently
unconfirmed answers. A paid pilot would spend turns confirming a gate that the
source already shows it cannot pass, so none is proposed. A bounded check of the
same code paths in 0.166.0, released 2026-10-29, found the same structure. That
was not a full audit of 0.166.0.

Two other source facts bear on whatever plan follows:

- Besides the built-in tool, two other core paths emit the same
  `item/tool/requestUserInput` request with `isBlocking: true` in any mode.
  The first is the app tool-approval fallback: its `itemId` is the MCP call id,
  with one question whose id is `mcp_tool_call_approval_<id>`
  (`core/src/mcp_tool_call.rs:1474,1667,1744–1762,1994–2030`). It runs only
  when the default-on, stable `tool_call_mcp_elicitation` feature is off;
  otherwise approval uses `mcpServer/elicitation/request`
  (`features/src/lib.rs:2043–2047`). The second is the skill MCP
  dependency-install prompt: `itemId` `mcp-deps-<turnId>`, question id
  `skill_mcp_dependency_install` (`core/src/mcp_skill_dependencies.rs:36,285–293`).
  No typed field names the emitter. Only these naming conventions separate the
  three, and they are not a protocol contract.
- In core, the pending answer slot is keyed by turn id. A second question in
  the same turn overwrites the first. An error response from any client also
  resolves the request, and the model then receives an empty answer map
  (`core/src/session/mod.rs:3333–3369`; `bespoke_event_handling.rs:1694–1770`).
- A fresh TUI thread becomes resumable only after its first turn materializes
  the rollout. Before that, a running-thread resume fails at its stored read,
  ahead of any subscription or client-info change. A successful join records the
  joining client's name and version on the thread
  (`app-server/src/request_processors/thread_processor.rs:1774–1783,4624–4668,4800–4805`).

Each cited file was hashed and the full map retained as
`receipt-source-audit.json` (SHA256
`4cfc4c550db6338a13da7b2eb21f191002016fabaa2ad9f88db01d90d77cda6c`). The
tarball matches the earlier per-file source pins. This is static source
evidence, not a live observation. A second, independent read of the same tree
(Claude Code subagent, with the questions posed open-endedly rather than seeded
with this conclusion) reached the same receipt and winner conclusions. It
supplied the emitter and rollout-persistence corrections above. Its open
gaps are rollout flush timing, ordering of the approval prompt relative to its
`mcpToolCall` item, and code-mode invocation of the tool.

## Decision needed

Ruling: stop before drafting the pilot plan and return the receipt gate for a
design decision (be590be plus this audit). Why: Task 3's failure path requires
the smallest blocking contract and its alternatives rather than guessed
production work. Cost: if a protocol path was overlooked, a source-verified
counterexample reopens the pilot plan; no native evidence is lost.

Supported alternatives, none implemented:

1. **Read receipt from the thread's own rollout record.** Correlate the
   `function_call_output` whose call id equals `itemId`. This needs a spec
   revision, because it is a second evidence channel outside the protocol, which
   the plan currently rejects. It ties relay to an undocumented on-disk format
   and requires reading a private transcript file under the daemon's home.
   The rollout policy persists `FunctionCallOutput` items
   (`rollout/src/policy.rs:85–92`), and `Thread.path` (marked unstable)
   exposes the file's location. Flush timing, ephemeral threads and the
   paginated-history interaction have not been audited.
2. **Keep handed answers unconfirmed.** This is honest about the gap, but it
   contradicts the parent task's done criterion ("confirms native receipt") and
   the spec's rule against permanently unconfirmed answers. It needs a change of
   intent by the user.
3. **Ask upstream for a typed per-call result or a raw-event opt-in on join.**
   Then wait for a release. The search found related open requests
   (openai/codex#39426 for an output-only input lifecycle, #34353's later comment
   on resume raw events) but no request for per-call receipt. Any post is
   outside the repository and needs the user's approval.
4. **Have relay start its own threads with raw events.** Rejected: it does not
   serve questions from the user's TUI threads, and the flag is documented for
   internal use.

Recommendation, independent of the choice: run any later protocol matrix
against a local mocked Responses provider. The Codex binary stays native; only
the model is scripted. That costs no subscription turns, makes tool calls
deterministic and needs no credential. Upstream reporters use the same
technique. Model behaviour and phone acceptance still need the real model at
the user-present gate.

Task 2 and Task 3 remain open, along with the parent. The branch is unmerged.

## Historical report through be590be

The following preserves earlier evidence and proposals, not renewed execution
authorization.

# Codex question feasibility: native readiness established

## Current outcome after approved0492f74

The single authorized readiness-05 ran on Codex0.165.0 from
2026-10-29T19:47:03.639Z to19:47:12.317Z. Its original verdict is
**passed / readiness-only**, exit0. Three discovery polls found one native TUI
thread and a recognized empty composer in the fresh saved-untrusted workspace.
No keystrokes, trust fallback, model turns, metadata retry, app operation or pilot
occurred. Native work stopped after this attempt as approved.

The source-defined socket alias passed all captured ownership predicates at
startup, immediately before connection and immediately after connection. The
observer received the native TUI thread/start response on that connection and
correlated its exact typed request id with the discovered thread. It confirmed
the owned cwd, gpt-6-astra, on-request approvalPolicy, user approvalsReviewer,
readOnly sandbox with networkAccess:false, and null activePermissionProfile.
Refreshed config/layer checks independently passed. Unlike readiness-04, these
ownership predicates and start-policy fields were actually captured.

The peer advertised16777216bytes. Observed maximum frame/message sizes were
3428bytes client-to-server and11090bytes server-to-client, below the unchanged
8MiB local limit. This small startup observation does not size production thread
history or prove a recovery/subscription contract.

Budget is **373609ms (6min13.6s), two charged turns**, inactive. This attempt
charged8680ms and zero turns; historical charges/reservations are retained.
All seven owned PIDs were independently absent after the run. Private/runtime
paths and the two exact derived protected socket/lock candidates were absent.
Cleanup reported no errors/survivors; no namespace scan, permission repair or
unrelated deletion occurred. The driver detected no source-login change, refresh
request or private credential persistence. Host-load found nothing left running.

Raw SHA256: `e8b672864aac2cf674b91e50495e0731e244b765f6a30a69769a647b52571c6f`.
Portable SHA256: `3040c659da9bb7bb392a440fee4c953c76ad8817c481573911d0fcc505aa8126`.
`readiness-05-observations.json` keeps interpretation and independent cleanup/hash
checks separate from the unchanged original run result. Raw evidence, console,
exit status and portable derivatives remain retained on relay-a27e7c.

## Implemented correction and verification

Disposable r16 implements the exact native alias resolver and identity checks
specified by0492f74. The observer connects only to the derived protected socket;
its own listener remains in the private runtime directory. Errors expose fixed
codes and bounded stat predicates, never arbitrary link targets or error prose.
The driver computes the native namespace from canonical /tmp and effective uid,
verifies the owned server process, and records exact socket/lock cleanup candidates.
Only the internal test dependency object can substitute a fixture namespace.

The fake server now publishes an alias,0600 protected socket and startup lock in
an owned fixture namespace outside private/runtime removal. Tests require normal
cleanup and preserve/report leftover candidates. No production connector code,
host launcher, shared daemon configuration, dependency or active route changed.

RED:21 alias tests and4 driver integrations failed before their implementations.
An initial updated codec fixture exceeded the Unix path-length limit; its prefix
was shortened, the failed log retained and only its41empty generated directories
removed. Final combined checks passed **201/201 on Node26.5.0 and201/201 on
Node22.23.2**. Repository fast checks passed **773/773**. just check, tasks check
and diff hygiene exited0. Full logs and11 r16 source/test snapshots are retained.
Independent pre-native review (codex/gpt-6-astra, impl20) accepted the correction
with no new findings.192 retained records,15 complete manifests and11 reviewed
input hashes were independently reverified before readiness-05.

## Boundary and next review

Readiness is now demonstrated in this isolated topology. The paid pilot is still
unrun: no built-in question provenance, current-question Plan enforcement, exact
answer receipt, exclusion, late-join, race/defer/reconnect/restart or production
phone capability is established by this result. Linear identity/schema remains
unknown. Earlier failed/unknown runs keep their original verdicts.

Ruling: retain exact source-derived alias verification rather than generic link
following or removing ownership checks (0492f74, r16). Why: the native run now
confirms the expected owned layout and identities. Cost: a future layout change
still fails visibly and needs renewed version-specific evidence.

Ruling: stop native work after the readiness pass (0492f74, readiness-05).
Why: the approved sequence explicitly ends here; the current observer rejects
turns and settings changes. Cost: the question/receipt pilot requires its own
reviewed first-question/direct-join plan before further execution.

The next design review must settle that transition, not repeat readiness alone.
Pinned tui/src/chatwidget/settings.rs:704–706,751–770 shows a mode choice submits
an override containing collaboration mode; app_server_session.rs:1452–1508 sends
the effective mode on turn/start. The current zero-input observer deliberately
rejects this lifecycle. The next plan must account for native settings-update
policy, first-turn materialization, direct-client join/replay and exact receipt
without treating the observer as production provenance or a resume-mode snapshot
as proof of the question turn. It must also check raw-event availability before
assuming a newly joined client receives earlier tool-call provenance. These are
planning obligations, not authorization to alter the driver or run another case.

The recommendation is to use this completed readiness proof as the starting
point for that separately frozen plan. Rejected alternative: rerun the old pilot
unchanged, which retains the pre-first-turn resume problem and lacks this observer
lifecycle. No gate is waived by this recommendation. The parent, Task2 and Task3
remain open; connector implementation, native gates and user phone answer/defer
acceptance still precede integration.

Existing minor (deferred): the default/medium effort-label allowlist can fail
closed on another legitimate label. No new minor was introduced in this slice.

## Historical report through0492f74

The following preserves earlier evidence and proposals, not renewed execution
authorization.

# Codex question feasibility: private socket alias blocker

## Current outcome after approved84692cd

The single authorized readiness-04 ran from2026-10-29T19:00:29.334Z to
19:00:33.589Z. Original result: **unknown / observer-ownership**, exit1.
Core metadata/configuration checks passed, but observer construction failed before
TUI launch: zero discovery polls, no native TUI thread, no keys or model turns.
No observer handshake or start-policy response was captured. The attempt is spent;
no fallback, retry, metadata, app operation or pilot followed.

Budget is **364929ms (6min4.9s), two charged turns**, inactive; this run added4255ms
and zero turns. Historical reservations remain charged. All three owned PIDs2640,
1893 and1855 were independently absent. Private/runtime paths were removed and
cleanup reported no errors/survivors. The exact protected socket and lock derived
from the recorded canonical alias were also absent; the shared namespace was not
scanned or changed. Native evidence hashes verified.

Raw SHA256: `f3a67a1af68e5f05c74fd0f4bbc908937181fc078caf0de59c7389c9a95e0d8e`.
Portable SHA256: `3561340540f79390c10ccb4ee56e4d8cc60244fc64aec61852405cc9648b24c1`.
`readiness-04-observations.json` retains interpretation separately from original
result, including the bounds of the cleanup observation.

## Source finding and limitation

The pinned0.165.0 Unix listener deliberately publishes the requested path as a
symlink to a0600 protected socket. The protected filename is SHA256 of the canonical
advertised path; its namespace is canonical `/tmp` plus `codex-daemon-<effective-uid>`,
owned by that uid with mode0700, independent of HOME/TMPDIR/CODEX_HOME.
See `socket-alias-source.json`, `app-server-transport/src/transport/unix_socket.rs`
69–145 and354–369, and `uds/src/daemon_directory.rs`13–39.

Our observer instead requires lstat of the advertised path to report a socket.
Its fake server used that direct-socket layout. I missed the source's normal
rendezvous alias when drafting the observer boundary. This is a source-supported
mismatch in the probe, not a Codex defect. The run captured only the combined
observer-ownership error; its individual runtime predicates/readlink were not
retained. Do not claim those values were observed after cleanup or reinterpret
this run as a passed native contract.

## Implementation and review evidence

Disposable r14 added the byte-preserving observer and standalone start-policy
correlation. Initial29 observer tests failed before implementation; readiness
integration6/6 failed before its change. Two first-GREEN assertions were corrected
to await downstream bytes, not merely the earlier capture callback. A scalar RPC
reply regression was reproduced and fixed. Combined r14 passed164/164 both runtimes.

Independent review found two Important defects: fragment object counts escaped
the byte cap, and Close did not invalidate policy. Seven reproductions failed;
r15 bounds both parsers to1024fragments and makes Close terminal while forwarding
original bytes with a shared2-second shutdown bound. Intermediate81/83 exposed a
missing direct-client diagnostic allowlist entry; final **171/171** passed on
Node26.5.0 and22.23.2, **773/773** repository fast checks passed, and structured
hygiene records exit0. Fresh scoped review accepted both corrections before the
native attempt. Full reviews and r14/r15 snapshots remain retained.

Ruling: retain historical exported fake pilot paths but reject pilot/trusted
readiness at the native CLI. Why: preserve synthetic contract coverage while
restricting this diagnostic. Cost: runCase remains callable and controller
discipline must prevent bypassing the approved sequence. This does not authorize
any native pilot or change the paid-case gates.

Ruling: fix the direct client's shared fragment defect despite the unchanged-codec
plan instruction. Why: both parsers run in this diagnostic; fixing only one leaves
the resource-exhaustion path. Cost: a valid message above1024fragments fails visibly.
Both rulings were accepted in corrective review against84692cd.

## Proposed next revision

The revised plan specifies source-pinned verification of the exact alias target,
namespace and socket ownership/modes, identity checks around connection, bounded
predicate capture, and fake processes with the real alias layout. It proposes
one untrusted zero-input readiness-05 after offline verification and separate
frozen-plan approval. No resolver correction or further native run has occurred.

Ruling: verify the specific protected alias instead of following arbitrary links
or removing the ownership check. Why: exact target derivation keeps the private
instance boundary while matching Codex's actual source contract. Cost: the probe
must maintain a version-pinned check and a changed layout fails unknown.

Ruling: preserve readiness-04 unknown and stop native work. Why: the only approved
attempt is exhausted and supplied no start-policy proof. Cost: the paid pilot
remains unrun pending the reviewed correction and readiness evidence.

Existing minor (deferred): the default/medium effort-label allowlist fails closed
on another legitimate label. All native question/provenance/Plan/receipt, exclusion,
join/lifecycle/recovery gates and account-specific Linear identity/schema remain
unproved. Production connector and phone answer/defer acceptance still precede
integration. Task2/Task3 and relay-a27e7c remain open; the branch is unmerged.

## Historical report through9ae6138 and the84692cd proposal

The following is historical evidence, not renewed execution authorization.

# Codex question feasibility: native no-rollout diagnostic

## Current outcome after approved 1206516

The single authorized `readiness-03` ran on Codex 0.165.0 from
2026-10-29T17:43:52.376Z to 17:43:59.707Z. Its original outcome is
**failed / rpc-error**, with readiness capability **unknown**. The bounded
projection captured request 13's native error: **code -32600, class no-rollout**.
It matches the pinned exact message for the thread id in that pending
`thread/resume` request; arbitrary error text and data were not retained.

The request used `excludeTurns:true`. Before it, the owned untrusted workspace
passed refreshed effective configuration checks, the native empty composer was
recognized, three discovery polls found one new TUI thread, and `thread/read`
confirmed its identity, model and workspace. The failure is at stored-thread
resume, not composer recognition. No keys or native model turns occurred.
No fallback, `/plan`, pilot, metadata retry or app operation followed.
The approved diagnostic sequence is exhausted, even though its capture objective
was achieved. It does not authorize another native run.

Raw SHA-256: `44e09208dc53994364dece3c5e33704ad23893e3543addfdc4faf909326026a2`.
Portable SHA-256: `73f8180aa7677c7d8af65eef467d8cb0496c2db2a0184688e109eef2cb6b3cfa`.
`readiness-03-observations.json` records request/response lines31/32 and the
controller interpretation separately from the original result. All evidence
hashes matched, all seven owned PIDs were independently absent, and both private
and runtime directories were removed. Cleanup had no errors or survivors;
no login-file change or refresh request was detected.

Budget is **360,674 ms (6 min 0.7 s), two charged turns**, inactive. This attempt
added7,333 ms and zero turns. Only one native turn was observed historically;
the unused reservation and earlier conservative charge remain counted.

## What this establishes and what it does not

The pinned `thread_processor.rs:4624–4662` reads stored state even when resuming
an already loaded thread. Lines6443–6455 map a missing stored thread to the
exact no-rollout message. This run now supplies the native response missing from
readiness-02: the same request shape cannot complete the required pre-input
policy proof for this fresh thread in this setup.

The source's first-message materialization comments are consistent with the
observation. They do not prove which internal storage condition occurred, that
all fresh threads behave identically, or that the managed live daemon has this
failure. Readiness-02 retains its redacted, unresolved cause. No upstream defect
is asserted, patched or reported; this is an incompatibility between the current
probe's pre-input resume requirement and the observed fresh-thread behavior.

The current generated protocol exposes no `thread/settings/read` method.
`thread/read` returns Thread metadata, which lacks sandbox and approval policy;
`thread/settings/updated` carries those fields, but none was observed here.
The mutating `thread/settings/update` is not an authorized substitute for a read.
These facts do not yet supply another complete native policy-proof path.

## Diagnostic implementation and verification

Disposable driver r13 changes only the pending `thread/resume` error projection.
It preserves request id/method, a safe integer code or null, and an exact class:
no-rollout, thread-closing, listener-not-running or unclassified. Classification
uses the pending request's thread id. It exposes no arbitrary message/data;
other RPC errors retain redaction and secret calls remain uncaptured. RPC
rejection, readiness gates, budgets and cleanup remain unchanged.

Four focused regressions cover exact classes, wrong-thread/lookalike text,
invalid codes/missing identity, credential-bearing errors and a fake readiness
failure with no input or turns and verified cleanup. RED passed1/4; GREEN passed4/4.
During GREEN the integration assertion was corrected to decode the existing
JSONL data wrapper; capture format was unchanged. Combined driver/transport/history
checks passed **123/123 on Node26.5.0 and123/123 on Node22.23.2**. Fresh
`just test-fast` passed **773/773**; `just check`, `tasks check` and diff hygiene
passed. r13 source/fixtures and portable logs are attached to the task; raw logs
and evidence remain in its persistent directory.

## Proposed fresh-thread policy observation (offline only)

After9ae6138 the user approved replanning. No additional native run or model turn
has occurred. The pinned audit `fresh-thread-policy-source.json` confirms that
an empty `thread/settings/update` is not a getter: the response is empty and no
update is submitted for empty overrides. Settings notifications require an actual
change from the initialized baseline. The TUI session log also lacks the complete
native start response. None supplies a read-only policy snapshot to an observer.

The native TUI does receive actual policy in `ThreadStartResponse`, generated from
Codex's config snapshot (`thread_processor.rs:1679–1710`, received at
`tui/src/app_server_session.rs:895–950`). The revised plan therefore proposes a
bounded task-local Unix socket observer on that private connection. It forwards
bytes unchanged and retains only correlated native identity/policy fields; the
outside client continues speaking directly to the private server. This changes
measurement, not the approved production transport or capability predicates.

Ruling: prefer this zero-inference observation over another stored-history resume,
a paid bootstrap, config-only proof or a forced settings mutation. Why: it reads
the native response that already exists without changing the thread under test.
Cost: a new bounded parser needs offline verification and one readiness-only run.
It may fail safely on unexpected framing, startup settings changes or size limits.

Ruling: the proposed execution stops after one untrusted readiness-04, even if it
passes. Why: observing start policy cannot establish when the outside production
client can join/replay the first real question. Cost: pilot-02 needs a separate
reviewed ordering after this evidence; no paid capability progress is claimed.
No fallback, input, metadata retry, app alias or paid turn is proposed here.

Task2 and Task3 remain incomplete. Native readiness, Plan provenance/mode/receipt,
forms/exclusions, join/isolation, races/defer and recovery remain unproved;
production connector and user-present phone acceptance remain owed. Budget stays
360674ms/two charged turns. Existing default/medium effort allowlist is a deferred
minor: another legitimate label fails closed. The branch remains unmerged.

## Historical checkpoint through 1206516

The following report is retained unchanged apart from its historical heading.
Its readiness-03 proposal was executed above and grants no further attempt.

# Earlier readiness-02 checkpoint

## Current outcome after approved 995a04e

`readiness-02` ran on Codex 0.165.0 with saved untrusted in the owned private
workspace. Its original result is **failed / rpc-error**; the required readiness
capability remains **unknown**, not disproved. It ran from
2026-10-29T17:09:09.800Z to 17:09:17.070Z and charged 7,272 ms. No keys, trust
acceptance or model turns occurred. No fallback, pilot or matrix case followed.

The corrected classifier passed the native empty composer. Three discovery polls
found exactly one new thread. `thread/read` returned the expected id, workspace
and gpt-6-astra model; refreshed config/read with layers passed policy checks.
The next request, id 13, was `thread/resume` with that id and `excludeTurns:true`.
Its reply was an error. The driver retained only `error:"redacted"`, so neither
numeric code nor cause can be recovered from this capture. The original error
and failed result are preserved without reinterpretation as a native contract pass.

Raw SHA-256: `4c9397bec1a068d629dfee5af91559b59176c5aae3655345368b3ba10aafceee`.
`readiness-02-observations.json` records the controller interpretation separately.
All evidence hashes matched; all seven recorded owned PIDs were gone, both
private and runtime paths were removed, and cleanup had no survivors/errors.
The controller detected no auth-file change or refresh request. No process remains.

Budget is **353,341 ms (5 min 53.3 s), two charged turns**, active false. Only one
native turn was observed historically, in pilot-01; its unused reservation and
the earlier diagnostic charge stay counted. No budget extension or refund occurred.

## Source audit and limits

`linear-resume-source-audit.json` retains hashes and the paths inspected.
`thread_processor.rs:4624–4662` shows even loaded-thread resume reads the stored
thread before its configuration snapshot. Missing stored threads map to a
no-rollout error at lines 6443–6455; other errors can also propagate. Source notes
that fresh-thread history may be unmaterialized before a first user message.
This supports a hypothesis, not the observed cause: the actual message was redacted.
No Codex defect, persistence repair or inference bootstrap is established/authorized.

The requested Linear name trace reaches a connector-aware path:

- `rmcp_client.rs:866–918` routes Codex Apps tools through connector-name/id
  normalization while preserving the raw MCP tool definition.
- `codex_apps.rs:31–70` sanitizes the raw name, strips a matching connector prefix,
  and constructs the namespace from server and connector when provided.
- `tools.rs:113–218` applies prefixing, sanitization and collision/length handling;
  its canonical name is a namespace/name pair. `protocol/tool_name.rs` formats
  that pair by concatenation.

With connector name Linear, prefix enabled and no collision, the raw name
`linear.search` yields namespace `mcp__codex_apps__linear` and callable `_search`;
the display string equals the approved `mcp__codex_apps__linear_search`. This is
strong conditional evidence, not proof of the private account's actual mapping:
connector/callable identity was not retained, and display formatting does not by
itself establish the external harness's flattened-name mapping. The exact schema
and approved argument compatibility remain absent. No alias or new app call is admitted.

The schema path is also traced: `tools/list` supplies tool definitions through
`rmcp_client.rs:717–773`; catalog listing retains them; `mcp/mod.rs:713–727,817–870`
serializes the raw tool into protocol Tool. `ToolsAndAuthOnly` drops resources only.
`protocol/mcp.rs:390–427` retains inputSchema but permits a missing schema as null.
Thus this status path does not deliberately remove schemas for deferred model
loading. Our projection definitely removed this name's schema field; actual backend
omission/null is still possible. A future approved capture must verify the bytes.

## Proposed next step, separately reviewed

The companion revision proposes offline tests and a narrowly scoped safe error
projection, then one zero-inference untrusted `readiness-03`. Retain only numeric
code and exact source-literal error classes for thread/resume; all arbitrary text
and data stay redacted. Stop after that run, even on success. There is no trusted
fallback, pilot, metadata retry or app operation in that diagnostic authorization.

Why: it measures the currently hidden failure before changing native behavior.
Cost: up to another 120 seconds, with no model turns, and an unclassified error
may still leave the cause unknown. Rejected alternatives are guessing a missing
rollout, adding inference to materialize history, or repeating the unchanged capture.
The frozen diagnostic plan requires user review before its execution.

No driver code changed after r12. Its 119/119 checks on Node 26.5.0 and22.23.2
remain applicable; repository baseline773/773 was reused because executable code
and dependencies are unchanged. This documentation/source audit adds no test claim.
Required native readiness is still incomplete; Plan provenance/mode/receipt,
forms/exclusions, join, races/defer, recovery, connector and phone acceptance remain
unproved or unimplemented. The parent remains open and the branch stays unmerged.

## Historical report through 995a04e

The following sections preserve the earlier checkpoint. Their proposed retry was
executed only as described above and is now exhausted; they grant no current retry.


Approved feasibility plan `59e468e` ran through one corrected metadata diagnostic
and one untrusted no-inference readiness attempt. The private TUI skipped trust,
created a native thread and displayed its composer. The driver did not qualify it:
its screen matcher rejected the normal model/workspace status line, then a stale
missing-thread flag mislabelled the stop. The original run remains unknown. Both
defects are fixed against captured evidence offline; no further live attempt ran.
relay-a27e7c remains open, with Task 2 incomplete and the pilot/matrix, production
connector and phone acceptance still owed.

## Native metadata-02

The run lasted 2026-10-29 16:05:22.805–16:05:34.182 UTC (11.378 seconds charged).
It used a fresh private server and access-only authentication, with no TUI, model
turn or app invocation. One filtered `mcpServerStatus/list` request used the
approved 95-second request allowance within the 120-second case limit; the other
metadata calls retained 15 seconds. No directory scan or `app/read` ran.

Core safety/model/preset checks passed: read-only sandbox, on-request approvals,
user reviewer, configured `gpt-6-astra`, and Plan/Default presets. The corrected
projection retained native identifiers, so this time the account-tool observation
is independently auditable:

- The terminal response contains `codex_apps`, with 194 tools, 90 named `linear.*`.
- It advertises `linear.search`, rather than either exact accepted name
  `linear_search` or `mcp__codex_apps__linear_search`.
- The overall result is `unknown: app-prerequisite-unproven`; the app reason is
  `linear-tool-unmatched`, cause `unresolved`. The new name is not an authorized
  alias. Its schema was not retained by the exact-match projection, so neither
  argument compatibility nor operation identity is established. No tool was called.
- This resolves the earlier missing-server ambiguity, not the app-approval gate.
  Source still permits cache paths; metadata is not invocation or approval proof.

Raw evidence: `runs/metadata-02/raw.jsonl`, SHA-256
`dbbef4df94550ab8e12e7f5bff7564291d187736a4180dca83003bac1fd02fba`.
The portable `metadata-02-observations.json` records selected identifiers and
verdicts without copying unrelated catalog metadata into the report. Exact raw
bytes remain private retained evidence. All recorded owned processes were reaped;
private credentials/runtime directories were removed, no source-login change or
refresh request was detected, and cleanup reported no errors. Independent hash,
PID and path checks passed. `canRunPilot(metadata-02)` was true under the approved
core/app separation. Cumulative budget then stood at 265,161 ms/two charged turns.

## Native readiness-01

The run lasted 2026-10-29 16:06:21.563–16:07:42.470 UTC (80.908 seconds charged).
It used `trust_level="untrusted"` for only its canonical private workspace, a fresh
private home/server/TUI and the unchanged access-only authentication boundary.
Core checks and workspace `config/read` with `includeLayers:true` passed before
TUI launch. No trust prompt was seen or answered, and no keystroke or model turn
was submitted.

The retained protocol shows one `thread/started` notification with the expected
cwd and model. After the initial empty loaded-thread list, the same new thread
remained listed. Terminal captures show the native empty composer and footer,
with a model/workspace status line between them. These are observations, not a
complete readiness pass: the driver never reached its required `thread/read` or
lightweight `thread/resume` policy check.

The driver stopped at 40 readiness polls (plus one pre-launch baseline list).
Recorded poll intervals ranged from 500 to 2,002 ms, consistent with the capped
backoff and scheduling overhead. The readiness deadline never reset. The saved
result is `unknown: tui-thread-unobserved`, with zero native turns and clean
cleanup. The original result and capture are unchanged.

Two disposable-driver defects explain that misleading stop:

1. The ready matcher accepted only shortcut/context lines below the empty
   composer. The native `GPT-6-Astra default · <owned-workspace>` status line made
   it reject the composer and fall through to `starting` because the header was
   still visible. This was a classifier/fixture gap, not a Codex protocol finding.
2. An early empty discovery set latched `missingThread` without clearing it when
   the native id appeared. At the poll limit, that stale flag reported missing
   thread rather than unqualified readiness.

Raw evidence: `runs/readiness-01/raw.jsonl`, SHA-256
`e0f43ba0847021e313fc86f2e8265fe947d31d4b6138fa5684858ff32263a2dd`.
`readiness-01-observations.json` separates the original result from this controller
diagnosis. `probe/fixtures/readiness-01-screen.json` preserves the captured frame
with the owned workspace replaced by a named placeholder and its raw-source hash.
The remaining code accepts only the captured status-line shape for the exact
owned path. Independent review then found that the trust substring branch could
bypass extra prompt/modal content. Snapshot r11 fixes this by matching the whole
pinned trust surface, including its native footer; extra content fails closed.
No overlap was observed natively. Model/mode text never
replaces native identity, policy, provenance or Plan-mode proof.

The 44 recorded owned child/command processes were verified gone. Private/runtime
paths were gone, no source-login change or refresh request was detected, and
cleanup had no errors. No process was left running. The trusted fallback did not
qualify, because this was not the exact untrusted trust-prompt outcome. The pilot
and all dependent cases therefore did not run.

## Verification and current driver

Before native execution, ten new missing-behavior tests failed (52/62 passing),
then passed. Two further safety regressions reproduced post-trust app-policy drift
and incorrectly passing an omitted exact schema. The fixes made unsafe app policy
fail readiness and omitted schema leave app unknown. Combined driver/codec/history
checks passed 112/112 on Node 26.5.0 and 22.23.2; repository `just test-fast` passed
773/773 and `just check`/`tasks check` passed. That pre-run driver is snapshot `r9`.

After readiness-01, two regressions reproduced the captured status-line rejection
and stale missing-thread reason. Both went RED→GREEN. The r10 combined checks
passed **114/114 on both Node versions**. The fake screen now includes the observed
status line; snapshot `r10` includes that fixture and the captured-frame regression.
Review of `564bf02` found one Important trust-overlap defect and its plan
consequence. A focused regression reproduced the unsafe classification, then
passed after the whole-screen trust match. It covers extra login, approval and
arbitrary modal content above/below trust at both trust levels, with no fallback
or keys; valid trust still passes. Snapshot `r11` passes **115/115 on both Node
versions**. The retry plan requires verifying this correction and RED→GREEN
evidence before retained admission or another native attempt.

These are offline corrections, not a retroactive native readiness pass. No
executable repository code, dependency, production connector or host setting changed.

The persisted budget is **346,069 ms (5 min 46.1 s), two charged turns**, active
false. This turn added zero model turns. Only the earlier pilot-01 Default control
is an observed native model turn; its unobserved bootstrap reservation remains
charged. The earlier 40-second diagnostic charge remains included. No refund,
budget extension or extra live attempt was taken.

## Offline Plan-screen correction after review of 408dd93

The incoming review correctly predicted that the post-`/plan` composer would be
rejected. Pinned `status_controls.rs:460–467` and `status_surfaces.rs:988–1006`
confirm effort formatting: absent/None is `default`, while the Plan preset's
Medium becomes `medium`. The Plan indicator is right-aligned beside the status
row in the fullscreen source snapshot, with `⇧tab` as the rendered key label;
its shortcut footer remains below. The fetched footer SHA-256 is
`cba851759c13f631ed95bbb243f36d4c70e7f7f28c991f8bf14a5b5fc19a0a1d`, matching
the reviewer's prefix. Source hashes and the audit are in `plan-screen-source.json`.

Snapshot `r12` accepts this source-derived decoration for the exact owned
workspace. It preserves whole-screen trust matching, modal/startup precedence,
empty-composer admission, native thread/policy checks, and independent question
provenance/mode/receipt checks. A synthetic post-`/plan` frame now drives the fake
pilot; it is not presented as a native Plan capture. Four focused checks went
from **1/4 to 4/4**, including a post-Plan modal refusing question input/charge.
Combined driver/codec/history checks passed **119/119 on Node 26.5.0 and 22.23.2**.
The repository code is unchanged; its prior 773/773 result remains the baseline.

An offline recursive inspection of the hashed `metadata-02/raw.jsonl` found the
`linear.search` entry at line 8, decoded message/result/data/0/tools/linear.search.
It contains only `name`; no schema survived that projection. We cannot decide
whether it admits the approved arguments from these bytes. The r12 projection
will retain this one additional exact schema in a future separately authorized
metadata run, but app admission still accepts only the previously approved exact
names. A fake regression verifies the schema is retained while the verdict stays
`linear-tool-unmatched`, with no app/read or model turn. This amendment authorizes
neither another metadata run nor invocation/substitution of `linear.search`.

No native operations ran during these corrections. Budget remains 346,069 ms and
two charged turns; all earlier native results and their hashes are unchanged.

## Gate disposition

| Spec gate | Current evidence and remaining obligation |
| --- | --- |
| 1: transport and join | Private transport/auth/core checks remain proved; native untrusted TUI startup and one thread observed. Required thread/read/resume readiness, join and subscription isolation remain unproven. |
| 2: clarification-only routing and forms | Unknown. Native `linear.search` name observed, but exact authorized operation/schema and real app approval unproved; no Plan question/provenance/forms or other exclusion controls. |
| 3: receipt and races | Unknown; no exact native answer/result correlation, race, cleanup-only resolution or delayed receipt. |
| 4: defer | Unknown; no native handback observation. |
| 5: reconnect/restart | Unknown; no replay barrier, generation proof, stale-answer rejection or no-client recovery. |
| 6–7: production and phone | Later obligations; not attempted or waived. |

## Proposed next attempt, separately reviewed

The companion feasibility-plan revision prepares one fresh **readiness-02** with
untrusted and the corrected matcher. It reuses the verified metadata-02 core/app
verdict instead of repeating metadata. Each fresh case still repeats its own
safety/model/auth checks. Only the original exact untrusted trust-prompt outcome
could admit one trusted **readiness-03**; every other required failure/unknown stops.
Only a complete readiness pass admits the still-unrun **pilot-02**, once. Its
native provenance/mode/exact receipt pass remains required for later cases.

Why: the defect is localized and reproduced using the actual frame, while native
untrusted startup already avoided the prior trust blocker. Cost if wrong: another
bounded readiness run can remain unknown and consume up to its 120-second case
allowance, with no model turns; the unchanged remaining 30-minute/30-turn budget
still applies. Rejected alternatives are an unlisted immediate retry, relaxing
native readiness proof, and repeating the successful metadata diagnostic. No new
app name, operation or arguments are authorized by this proposal.

The new frozen plan needs user review before any further native run. Preparing it
alongside this report makes that review concrete; it does not treat the earlier
approval as retry permission. The parent and Task 2 stay open, Task 1 stays done,
and Task 3 retains the evidence/next-artifact obligation. `feat/codex-question`
stays unmerged in `.worktrees/codex-question` until the connector, native gates and
user-present phone answer/defer acceptance are complete.

## Retained history

The task retains native metadata-02/readiness-01 bytes, observations, captured
fixture, r9/r10/r11/r12 driver snapshots, RED/GREEN logs and full reviews. Prior report
`6d0751d` records metadata-01's omitted response and pilot-01's trust interruption;
`f4c5448` records the inventory page-limit stop; `aac3954` records the earlier
transport/inventory correction. Approved spec `741a546` still governs all gates.
The previously overlooked hq-d85ede transport/mode evidence stays acknowledged;
shared listener source does not establish live/private lifecycle equivalence.
