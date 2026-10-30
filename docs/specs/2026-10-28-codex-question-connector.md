# Codex blocking question connector

Status: r11, current contract proposed for the prerequisite package review.
Task: relay-a27e7c, extending relay-f58531 for ops-cb50a8 milestone 4.
Production implementation requires approval of this spec and its production plan.
Gate 7 and integration each require separate user approval. These probes ship no
connector and authorize no live daemon, desktop, phone or model use.

## Intent and architecture

Answer an ordinary Codex Plan-mode question from the existing private phone inbox,
or defer it and answer in Codex's native desktop UI. Keep a saved answer distinct
from confirmed receipt, preserve retry identity, and never deliver an old answer
to a recovery turn's new question. The accepted
[typed-interaction spec](2026-10-11-typed-interaction-messages.md) §9.3 supplies the
architecture: an internal connector in `relay serve` joins one explicitly
configured, already running local Codex app-server. Claude and detached-question
semantics remain unchanged.

Use Node built-ins, Node >=22, and direct Unix WebSocket transport. Add no runtime
dependency, root library export, HTTP endpoint, phone UI, general RPC framework or
proxy child. Reuse the inbox's serial queue, persistence, HTTP guard and events.
The connector is an internal route owner, not a fake hook waiter. Update private
ownership, stored validation, JSDoc, recovery and native value types together;
existing hook commands cannot acquire connector-owner operations.

Configuration is opt-in and names an absolute Codex executable, its home, control
socket and validated evidence file. All absent means no connection; partial or
malformed enablement fails early. Production never starts, restarts, updates or
reconfigures Codex, reads authentication files, or copies credentials. Support is
exactly the evidenced codex-cli 0.165.0; 0.166.0 and other versions are refused.

## Transport and discovery

Validate the Unix endpoint, HTTP Upgrade and acceptance key; mask client frames,
handle fragmentation, control frames, close, cancellation and backpressure, and
bound message size and time. Reject compression. Require the 0.165.0 header
`x-codex-websocket-max-unfragmented-message-bytes` to be a valid positive integer.
Outbound messages must fit both that peer ceiling and the local 1 MiB cap; never
fragment to evade either. Keep inbound frame/reassembly bounds separate, capped
at 8 MiB. Shutdown aborts waits, closes sockets and cancels reconnect timers.

Discover only loaded threads associated with live Codex registry rows, using
complete paginated loaded discovery and bounded refresh, including late joins
and new arrivals. Joining must preserve model, instructions, approval policy,
workspace and collaboration mode, start no work and never resurrect an unloaded
thread. A registry row disappearing stops new discovery; it does not establish
an already tracked question's death. Partial pages cannot establish absence.

Exclude the automatic title helper before joining or publishing: it is ephemeral
and feature-sourced `thread_title` (the protocol serializes this source as the
string `"thread_title"`). Do not generalize this exception to arbitrary second
starts. Missing or ambiguous ownership remains native. Production does not name
user threads to suppress helpers; naming was private probe setup only.

In 0.165.0 unloading requires both no subscribers and inactivity for
`thread_unload_delay_secs`, whose production default is **1800 seconds (30 minutes)**.
The deadline follows the later of subscriber loss and inactivity. The private
unloaded probe uses a root config value of 2 seconds; the connector never changes
that production setting. Complete loaded absence, followed by restoration by the
native controller and only then an outside join, establishes the probe result.
Unsubscribe success or elapsed time alone does not establish absence.

## Admission, identity and translation

Publish only positively identified built-in blocking `request_user_input` calls
in Plan mode, with `isBlocking: true`, nonsecret questions and a representable
form. The provenance predicate requires an earlier rollout `function_call` with
`call_id == itemId`, name exactly `request_user_input`, and no namespace.
App approvals use their differently named tool calls; skill dependency prompts
lack that qualifying earlier call. Method name, labels, prose and `isBlocking`
alone establish neither provenance nor mode. Pinned native mode enforcement,
including a scripted Default refusal and Plan positive control, must support the
mode proof. Mode changes and late/resumed joins do not waive it.

Secret, permission, app-approval, async/default and unidentified requests stay
native. Unsupported content is never truncated or silently converted. Diagnostics
contain bounded codes, no question text or answers. Presence `here` admits no new
inbox question; `away` admits eligible questions. Existing identity survives
presence changes, and the native UI may still display an admitted question.

Use the exact `(threadId, turnId, itemId)` tuple as native identity. Encode it
unambiguously, including thread id, in `native.callId`; `sessionId` is thread id.
The numeric RPC request id is a live connection-local response address only.
Replay reuses the stored inbox UUID and immutable message/question mapping; the
same tuple with changed content is a conflict. Re-asks with new tuples get new
UUIDs; never match question text.

**One pending native request per thread and turn.** Never publish or answer a
second request for the same `(threadId, turnId)` while one is pending. Same-tuple
replay and multiple question items in one request are not second requests. A new
distinct request supersedes the old address, including an ineligible app approval
or skill prompt sharing the turn-keyed slot. Revoke the old send capability at
receipt, then serialize withdrawal before new admission. Recheck the full tuple,
connection, generation and response address at the actual socket write, after
all asynchronous queues. No saved or late answer may reach a superseded tuple.
Apply the lifecycle below without rewriting a confirmed receipt.

This is load-bearing: pending user input and submitted answers are keyed by turn.
The pinned executor defaults to serial execution, and `request_user_input` has no
parallel override. Thus simultaneous built-in requests cannot be reproduced
natively on this version. Supersession tests are source-shaped/unit-level;
every version change must re-prove the serial runtime from pinned source.

Assign relay question ids `q1` onward and option ids `o1` onward once, in native
order. Keep the native question-id map in private validated route metadata.
Duplicate native ids or ambiguous option labels make the whole call unsupported.
Copy header, prompt, labels and descriptions within existing limits;
`recommended` is null. Native options become single choice with
`allowOther = isOther`; invent no multiselect. This built-in rejects null/empty
options before requesting input and forces Other on admitted choices. Free text
uses Other; null/empty-options calls stay native. Maximum wait is 23 hours.

Validate the complete outside answer before handoff/send: every mapped question
must have its single admitted value, translated to the exact native label or Other
text. Unknown/duplicate ids, malformed bodies or unsupported values fail locally.
A relay decline is exactly `{"answers":{}}`; never rely on a native malformed-body
fallback. Persist only the question, minimal routing/ownership data, saved answer
and approved native answer observation. Retain no unrelated request/transcript,
secret or credential content.

Native answer observations preserve the full answer map and string arrays without
flattening. The captured native TUI unanswered submission is
`{"answers":{"q_color":{"answers":[]}}}` for the fixed probe question. It is a
valid answer-map output, distinct from an empty-root relay decline. It follows
answer-map equality, never structural no-answer classification, and cannot
confirm a saved relay decline. This native observation does not authorize relay
to submit empty arrays or broaden admitted phone forms.

## Read-only rollout evidence

The protocol supplies requests and transitions; the thread's own rollout supplies
call provenance and what the model received. Those are the only answer/provenance
channels. Validated daemon process identity supplies the separate replacement
lifecycle proof below, never an answer. The connector never writes the rollout.

Accept only the path returned by `thread/resume`, a regular, owned, non-symlink
`.jsonl` under the configured home's sessions directory. Revalidate identity on
every read. Missing, compressed, replaced, shrunk or unreadable files are unknown.
Every open starts at byte 0 and rebuilds the call table; thereafter read appended
bytes incrementally. EOF, writer lag and unfinished reads are not disappearance.

Retain only response-item envelope/type, call id, name/namespace, approved output,
and turn-end type/turn id needed by these rules. Other fields may exist transiently
while parsing a bounded line but must never be retained, logged or forwarded.
Classify by the exact provenance predicate, not tool family: `view_image`, shell
and file tools can all be `other`. For **every shape** of `other` output, discard
content; retain only call id and SHA-256 of UTF-8 `JSON.stringify(output)`, preserving
JSON type and field order. Require a present output and valid earlier call/id.
Fingerprints stay in memory only, never logs, persistence, forwarding or telemetry.
Short outputs can be recovered by guessing their hash. Reopen rebuilds them.
Same-id/same-hash output is idempotent; conflicting duplicates make evidence sticky
unknown. Fingerprints and `other` output never establish receipt.

An output without an earlier valid call is unidentified and unknown, not `other`.
Repeated/ambiguous dispatch identities, malformed JSON/fields, conflicting output,
file validation failure and structured built-in output remain unknown. Never
convert arbitrary structured content to answer text. For a positively identified
built-in retain only the bounded string needed for receipt or joint settlement.
Unknown reader state outranks cached evidence.

A line over 1 MiB or cumulative read/file size over 64 MiB makes evidence sticky
unknown **before classification or discard**, even for irrelevant images,
compaction or patch events. Reopening encounters the same limit; the thread stays
native while oversized. This is an accepted residual restriction. Skipping lines
by type prefix, raising bounds or changing recovery requires review.

### Exact receipt

Parse the actual exact-call built-in output using the pinned answer-map schema:
`{answers: Record<string, {answers: string[]}>}`. Confirm a saved answer only by
full native-map value equality with its validated translation. Same text in another
call, `serverRequest/resolved`, protocol completion, client order, elapsed time,
source-shaped results and synthesized history outputs never confirm receipt.
A missing/unknown actual output cannot establish consumed.

Native client errors, failed receivers and response deserialization failures can
all become `{"answers":{}}`; the turn-transition-error path is a separate exception.
Matching a saved decline confirms only the model's empty-map value, not an
intentional decline, winning client or cause. A nonempty saved answer cannot
match an empty map. The native unanswered per-question empty-array map is also
different from empty root. Keep these distinctions in history and the runbook.

### Settled without an answer

Require positive built-in provenance and an observed protocol request for the exact
tuple, plus **all** of:

1. Its actual output is a string failing the pinned answer-map parse.
2. The same turn's rollout `task_complete` or `turn_aborted` barrier follows that
   output in file order.
3. The protocol reports that exact thread/turn completed, interrupted or failed.

An earlier/wrong-turn barrier, timestamps, EOF, resolution alone or an unobserved
request cannot substitute. Incomplete evidence and structured output stay unknown.
No text grammar or prefix recognizes a cause: this proves an end without an
answer, never interruption, steering or dropped channel. It is never answered or
consumed. Pre-request validation failures create no inbox entry.

The separate disappearance case with **no matching output** requires the exact
protocol terminal, matching rollout turn-end and no call output. Neither a caught-up
read nor elapsed time proves disappearance. Reconciliation cannot invent a missing
protocol transition; detected replacement below is a separate lifecycle authority.

## Delivery, lifecycle and recovery

All inbox transitions use the existing serial queue and durable commit discipline.
Persist handed before the guarded wire write. Relay serializes its own submissions
and replays the same answerId; Codex independently chooses between native and relay
responses. There is no cross-client atomic transaction. Saving does not lock the
native UI. Resolution revokes the live response address immediately, independently
of receipt and settlement classification.

| Evidence/state | Lifecycle |
| --- | --- |
| Native answer before any saved relay answer | Withdraw as `answered-elsewhere`. |
| Proven end without an answer, pending | Withdraw with reason `asker-gone`. |
| Saved, not handed, request lost or a different native answer wins | Retain saved answer, mark `undeliverable`. |
| Handed, absent/mismatching/unknown receipt | Retain saved answer, remain `unconfirmed`; retain valid actual answer in `observed`. |
| Handed, actual exact output equals saved native map | `consumed`, including matching late receipt after the existing 60-second window. |

For structural no-answer settlement, post-handoff `unconfirmed` means a known end
without an answer: the saved answer did not reach the model, and later delivery to
that settled tuple is forbidden. For ordinary absent/mismatching/unknown receipt it
states only the corresponding uncertainty. Never rewrite completed receipt from
weaker lifecycle evidence. No retry of a settled, released, expired or superseded
tuple is allowed.

Defer uses `handback: true`: durably release the entry, send no answer or interrupt,
and leave the native question available. Later native answers update history
without reopening `released`. Answer/defer races retain the existing relay winner
rule. Expiry stops remote delivery without inventing an answer or cancelling an
unrelated native turn; the Codex question can remain visible.

On disconnection stop sending. Reconnect with bounded backoff while the service
lives. Socket loss alone does not prove daemon replacement, decline or continued
waiting. Before retry obtain exact pending replay and validate immutable tuple,
mapping and current ownership; resolved calls get readback without resend.
Unknown liveness cannot authorize replay; expiry and confirmation deadlines apply.
Relay restart must recover real persisted ownership and answer state, not just
reconstruct an RPC message.

**Detected daemon replacement independently settles lifecycle.** A validated
change of daemon instance/process identity makes old pending entries `asker-gone`
and saved-but-unhanded answers `undeliverable`. Handed stays `unconfirmed` unless
an actual exact-call matching output appears; replacement supplies no receipt.
Do not require an unavailable old protocol terminal/barrier for this lifecycle
transition. Preserve completed receipts and released/closed entries. A disconnected
socket, reused RPC id or local generation counter alone is not validated replacement;
unknown identity stays fail-closed. New re-asks have new tuple/UUID and reject all
old answers.

The source basis is the in-memory pending oneshot slot in
`core/src/session/mod.rs:3340–3354` and history normalization in
`core/src/context_manager/normalize.rs:52–66`. Replacement loses the old pending
receiver; synthesized `aborted` history is not an actual rollout answer and never
receipt. Production tests must prove identity detection, all three lifecycle
states, stale-generation refusal and late actual-output reconciliation. This is a
production testing requirement, not a remaining native research prerequisite.

## Version evidence and acceptance

The [all-gates report](../notes/2026-10-28-codex-question-protocol-report.md) and its
retained evidence index distinguish native captures, source proofs, unit fixtures
and production obligations. Validate exact executable/version, protocol/native
fixture hashes and pinned source, not just evidence-file presence. A mismatch
disables this connector with a content-free actionable diagnostic; other inbox
routes continue. The source archive SHA-256 is
`4e066a7dbd1234efa7458c2b137161bb7ddde1dde6be4ed4c8f38e6c45f862ab`.
The evidence index pins every required source file. Required source proofs include:

- `request_user_input.rs`, `context.rs` and `parallel.rs` together: the only success
  output after an observed request is the serialized answer map; other handler/runtime
  outputs are non-answer strings. Every version change re-proves this and conversion.
- The turn-keyed slot, executor and router: the serial runtime and supersession risk.
- `core/src/config/mod.rs:4100–4101` and
  `app-server/src/request_processors/thread_lifecycle.rs:58–64`: unload defaults/conditions.
- `tui/src/app/thread_routing.rs:2045–2077`, `thread_title.rs` and
  `tui/src/temporary_structured_request.rs`: ephemeral title source and disabled tools.
- The pending slot and normalization sources above: replacement lifecycle versus receipt.

1. **Transport/discovery:** private real handshake/initialize and listener source
   equivalence; complete loaded discovery, late/new arrivals, unchanged settings,
   no work or unloaded resurrection; exact title-helper exclusion.
2. **Admission/forms:** positive built-in provenance and Plan enforcement; app,
   secret, skill, async/default and unidentified exclusions; every admitted form,
   Other/multiple items/decline; unit/source supersession and version serial proof.
3. **Receipt/competition:** actual answer-map equality, native-first/relay-first,
   mismatch, empty-map collisions, malformed-relay local refusal, transition-error
   exception, delayed matching/mismatching read, immediate resolved-send revocation;
   structural settlement positive/incomplete/wrong-order/wrong-turn/unobserved/array
   cases and reader bounds/rotation/compression/writer lag/privacy.
4. **Defer:** native question remains usable without turn advance until answered;
   production history, retries, expiry and answer/defer races.
5. **Recovery:** reconnect, genuine durable relay restart, replacement lifecycle
   and exact receipt split, no-client recovery, new re-ask/generation/id reuse,
   complete unloaded absence and controller-only restoration. Native disconnect
   controls must not be silently reclassified as safe from socket loss alone.
6. **Production/unit/private TUI:** real IPC, queue/durable crash boundaries,
   ownership/storage/native arrays, duplicate delivery, evidence refusal and child
   cleanup; native TUI answer and unanswered output with zero outside responses.
   Explicit safe subprocess environments; both Node 22 and development runtime,
   policy-appropriate `just test-one`, `just test-fast` and integration `just gate`.
7. **Separately approved user-present acceptance:** after automated gates, one real
   model Plan question answered by phone and another deferred to native desktop,
   actual receipt, exact temporary state/endpoint and rollback, host-use approval
   at execution. Scripted provider/private tmux do not satisfy this gate.

Private scripted prerequisites establish protocol capability, not real-model
behavior or shipped inbox durability. Implement only after this package's spec
and production plan are reviewed. Production automated tests precede activation;
permanently unconfirmed normal delivery is not a completion criterion. A version
change must re-prove all version-specific invariants before activation.

Update `src/routes`, `src/serve`, lifecycle/stored-entry validation, `src/types.js`
and affected fixtures/type checks together. Update API, inbox-service runbook,
route-probe instructions and portable evidence when implemented. No compatibility
layer is requested. Default-mode async/new-turn delivery, `codex exec`, OpenCode,
automatic presence, public exposure, permission routing, persistent installation
and daemon lifecycle management remain outside this task.
