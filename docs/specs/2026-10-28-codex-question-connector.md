# Codex blocking question connector — addendum

Status: r7 proposed for review, incorporating spec review round 12.
R5 at relay `cc94eaf` remains the last approved complete text. The user approved
folding round 12's four Important findings and one Minor finding into this revision
before the correction plan. R7 supersedes proposed r6 at `c36e7b7`; it does not
implement a reader change or close any outstanding evidence gate.
Task: relay-a27e7c, extending relay-f58531 for ops-cb50a8 milestone 4.

## Intent and authority

Answer an ordinary Codex Plan-mode question from the existing private phone inbox,
or defer it and answer in Codex's native desktop UI. Keep the saved answer distinct
from confirmed receipt, retain retry identity, and never deliver an old answer to a
recovery turn's new question.

The accepted [typed-interaction spec](2026-10-11-typed-interaction-messages.md)
§9.3 supplies the architecture: a connector inside `relay serve` joins the shared
Codex app-server. Its async route remains later scope. This addendum refines the
blocking route only. It does not change Claude or detached-question semantics.

The source session's human asked for follow-ups after the Claude acceptance; its
agent filed this Plan-mode-first slice. The parent goal supplies the phone answer
and native-desktop defer requirements. The choices below are the current author's
recommendations where changed below; the remaining contract retains its approval.

## Evidence and unresolved feasibility

Code inspected at relay `1019183`: `src/routes/index.js` supports Claude and detached
questions; `src/serve/inbox.js` serializes writes; the lifecycle's confirmation
compares actual native answers. Socket waiter recovery assumes a hook process,
which cannot serve as Codex thread liveness.

The installed CLI is 0.165.0. Its generated experimental TypeScript protocol says:

- `ToolRequestUserInputParams` carries `threadId`, `turnId`, `itemId`, `questions`,
  `isBlocking`, and deprecated `autoResolutionMs`.
- Each question has a native `id`, `isOther`, `isSecret`, and nullable options.
  Native answers are a map from question ids to `{answers: string[]}`.
- `ServerRequestResolvedNotification` carries only `threadId` and `requestId`.
  Every subscribed connection receives the same request id. The first response
  wins; a later one is logged and gets no reply, so a client cannot learn whose
  answer was accepted.
- Besides the built-in tool, the same request is emitted, with `isBlocking: true`
  in any mode, by the app tool-approval fallback and by the skill
  MCP-dependency prompt. Only naming conventions separate them; no typed field
  names the emitter.
- Raw response events describe calls and outputs with call ids, but only the
  thread's starter can enable them (`thread/start.experimentalRawEvents`). The
  TUI does not, and a joining client cannot. Typed `functionCallOutput` items are
  produced only for injected pending input, never for ordinary tool results.
  History reads drop those outputs too. The 0.165.0 source audit at `4162b6e`
  establishes this; it is not a live observation.
- `codex app-server proxy --sock <path>` forwards raw bytes to the existing daemon.
  It does not translate newline JSON into WebSocket messages. A private 0.165.0
  run timed out on newline JSON; a separate HTTP Upgrade through that proxy
  returned `101 Switching Protocols`. Neither run sent authentication or started
  a model turn. See the [transport probe report](../notes/2026-10-28-codex-question-protocol-report.md).

The [official app-server documentation](https://learn.chatgpt.com/docs/app-server#toolrequestuserinput)
says resolution notifications also occur when a pending request is cleared by turn
start, completion, or interruption. It also describes app approvals using the
question method. Thus a method name alone establishes neither receipt nor an
ordinary clarification. Those are material gaps in the earlier short §9.3.

hq's `answer-server-terminal` and `answer-server-managed` facts were probed on
0.162.1 on 2026-10-11 under hq-d85ede. The terminal fact explicitly records
WebSocket over the Unix control socket and native refusal of the blocking tool in
Default mode. The prior approved spec cited those facts but overlooked the
transport statement; the 0.165.0 check confirms earlier evidence rather than
discovering a new transport. The mode observation is also relevant evidence for
the next probe, not proof of current-version behavior. These facts establish the
earlier route's viability, not current-version support.
hq-25665e remains open, including no-client recovery; this design claims no result
from it. Task notes locate the source transcript and retained generated protocol.
No current-version live question probe has run for this addendum.

## Approaches

1. **Connect directly to the Unix WebSocket, recommended revision.** Use Node
   built-ins for the Unix socket, HTTP Upgrade and bounded WebSocket framing.
   No new runtime dependency or proxy child. Validate the upgrade response and
   acceptance key, mask client frames, handle fragmentation and control frames,
   bound aggregate message size and time, and reject unsupported compression.
   Respect the server's `x-codex-websocket-max-unfragmented-message-bytes` header:
   for the evidenced 0.165.0 route require a valid positive integer, cap outbound
   messages at the smaller of that value and the local message limit, and never
   use fragmentation to evade that ceiling. Keep inbound frame/reassembly limits
   separately bounded. Reject missing/malformed limits for this version; any
   different version's policy needs its own evidence. Test a peer limit smaller
   than the local cap, not just the observed 16 MiB advertisement.
   Test malformed and truncated frames, close/ping/pong, cancellation and reconnect
   before live use. Cost: relay owns a small but security-sensitive transport;
   the next reviewed plan must specify and test that boundary before probing.
2. **Use the existing `ws` library.** Its [IPC API](https://github.com/websockets/ws/blob/master/doc/ws.md#ipc-connections)
   supports Unix sockets directly. The inspected 8.22.0 package has no mandatory
   runtime dependencies; its native peers are optional. It would avoid owning
   the framing implementation but add a second runtime dependency beside
   `jsonc-parser`. Rejected under this repository's Node-builtins runtime rule.
   The intended peer is a trusted local daemon and no extensions are needed;
   that bounds the implementation but does not excuse malformed-frame tests.
   Cost if wrong: relay maintains framing and protocol edge cases the library
   already covers. Reconsider through design review if the bounded client cannot
   be kept small and fully tested; do not add the dependency silently.
3. **Keep the raw proxy and add WebSocket framing.** Technically possible, but
   requires the same framing implementation plus a child lifecycle. Rejected
   because the proxy supplies no framing or local-connection benefit here.
4. **Use detached questions instead of native integration.** Already supported, but
   requires agents to change how they ask and does not answer the native waiting
   tool call. Does not meet this task.

Node's browser-compatible built-in `WebSocket` is not a direct Unix-socket
alternative on the supported Node 22 floor: the installed 22.23.2 rejects the
`ws+unix:` scheme and exposes no public `node:undici` module. Undici's custom
dispatcher extension is not a built-in Unix-socket connector; using an external
Undici agent or a private Node API would change the dependency/API boundary.

The implementation plan starts with a bounded probe phase. Passing the evidence
gates below is required before production connector implementation, not merely
before installation. A failed gate stops that implementation and brings its
evidence back for a revised design; shipping permanently unconfirmed answers is
not an alternative completion criterion.

## Scope and selection

One explicitly configured local daemon, one `relay serve`, Node built-ins, no new
root library export. Configuration names and exact internal function boundaries
are left to the implementation plan. Configuration is opt-in and names an absolute
Codex executable, its home, the control socket, and a validated evidence file.
Do not auto-start, restart, update or reconfigure the daemon. Disabled configuration
does not open a connection. Missing or malformed enablement fields fail early.

Join loaded threads associated with live Codex rows in relay's registry, including
new arrivals; use paginated loaded-thread discovery and bounded refresh. Joining
must not change model, instructions, approvals, workspace or collaboration mode,
nor resurrect an unloaded thread. Confirm these properties in the probe. A
disappearing registry row stops new discovery for that row; it is not proof that
an already tracked native question died. Codex request/turn evidence owns that fact.

Publish only positively identified built-in blocking `request_user_input` calls in
Plan mode, with `isBlocking: true`, nonsecret questions, and a representable form.
Prove their provenance using correlated native call evidence, including when
joining after the question was asked. A guessed tool name from prose or labels is
not provenance. Secret questions, app approvals, permission requests, async/default
questions, and unidentified calls stay native; emit a bounded diagnostic code
without question text or answers. If the protocol cannot distinguish these, the
route does not activate.

The revised feasibility plan must test native mode enforcement as a candidate
way to establish the Plan-mode requirement. hq-d85ede recorded that 0.162.1
refused the blocking built-in tool in Default mode. Re-probe on 0.165.0 with a
Plan positive control and either an actual attempted blocking-tool call in Default
with native refusal, or native evidence that the blocking tool is unavailable in
Default from captured tool-availability data or version-pinned source applicable
to the tested configuration; model prose or merely choosing not to call the tool
does not count.
If the current-version evidence establishes that enforcement for the supported
route, positive built-in-call provenance together with `isBlocking: true` may
establish the question's Plan-mode qualification. This is a candidate proof of
the same requirement, not permission to use `isBlocking` alone or to assume the
historical rule persists. Contradictory, unavailable or incomplete enforcement
evidence leaves the mode gate unknown and returns to design review. The plan
must address mode changes and resumed/late-joined calls before relying on it.

Presence `here` admits no new inbox question. Existing questions retain their
identity when presence changes. When `away`, supported questions enter the inbox;
Codex's native UI may still display them. Unsupported content is never truncated
or silently converted into a different question.

## Identity and translation

Use the exact `(threadId, turnId, itemId)` tuple as native identity. Encode it
unambiguously in `native.callId`, including the thread id; set `sessionId` to the
thread id. The RPC request id is only a connection-local response address, never
the durable identity. Reuse the stored inbox UUID and immutable message on replay;
the same tuple with changed question content is an explicit conflict.

Relay item ids are `q1` onward and option ids `o1` onward, assigned once in native
order. Preserve the native question-id mapping in validated private route metadata,
not public presentation fields. Duplicate native ids or ambiguous option labels
make the entire call unsupported. Copy prompt, header, labels and descriptions
within existing limits; `recommended` stays null. Native options become single
choice with `allowOther = isOther`. On 0.165.0 the built-in rejects null or empty
options before sending a request, and forces Other on admitted choices. Free text
therefore uses Other; a null/empty-options request is unsupported and stays native.
No multiselect is invented. The route's maximum waiting period is 23 hours, as for Claude.

An answer maps back to native ids and exact labels or text. The probe establishes
the native declined representation and receipt; never substitute a guessed empty
object. Until proved, the route cannot activate, since the existing inbox offers
decline. Request bodies, unrelated transcript content, secrets and credentials are
not persisted or logged. Persist only the question, minimal routing metadata and
the actual matching answer observation required by the lifecycle.

## Provenance and receipt from the rollout record

The protocol supplies the request and its resolution. It supplies neither the
call's provenance nor the result the model received. Both come from the thread's
own rollout record, the JSONL file Codex appends for every persistent thread.
This is the route's only evidence channel outside the protocol. It adds no
transport, and the connector never writes to the file.

In 0.165.0 the source shows three properties this channel depends on. The
model's `function_call` item is persisted before the tool is dispatched. Its
`function_call_output` is persisted when the result is recorded. Both kinds
persist in every history mode, including the TUI's paginated mode. After the
first user prompt, each append is written and flushed in turn. Live rollouts
are plain JSONL; compression applies only to rollouts at least seven days old.

- **Locating the file.** Take the path from the thread object that
  `thread/resume` returns. Accept it only as a regular, non-symlink `.jsonl`
  file owned by the user, under the configured Codex home's sessions directory.
  Revalidate its identity on every read. A missing, compressed, replaced,
  shrunk or unreadable file leaves the evidence unknown.
- **Reading.** Every open starts at byte 0 and rebuilds the call table from
  that file; no previous table, classification or offset is reused. Thereafter,
  read appended bytes incrementally from a remembered offset. Inspect only the
  response-item and turn-end fields this contract names. Other line content may
  exist transiently while parsing a bounded line, but is never retained, logged or
  forwarded. An output with no earlier valid call is `unidentified`, not `other`;
  it makes evidence `unknown` and cannot establish receipt.
- **Output content by predicate class (r7 proposal).** Classify the exact earlier
  call by the provenance predicate below, not by whether Codex calls its tool
  built-in or MCP. `view_image`, shell tools and file tools can all be `other`.
  For **every** output shape belonging to an `other` call, discard the content.
  Retain only its call id and a SHA-256 fingerprint of the UTF-8
  `JSON.stringify(output)` value. JSON types and object field order are preserved
  by this fingerprint; same-id/same-hash output is idempotent, while a different
  hash for that id makes evidence sticky `unknown`. Require a present output
  field and valid earlier call/id before hashing. Neither this fingerprint nor
  an `other` output can establish built-in receipt. This discards unrelated string
  output as well as arrays, images and other JSON values; no descriptions, schemas,
  tool output text or inline image data are retained.
  For a positively identified `built-in` call, retain only the version-probed
  string answer output needed for exact receipt. Structured built-in output and
  any output for an unidentified call remain `unknown`. Missing/invalid fields,
  malformed JSON, conflicting duplicate calls/outputs and file-validation failures
  remain fail-closed. No guessed conversion of structured content to answer text
  is permitted.
- **Residual size limits.** A line over 1 MiB or cumulative read/file size over
  64 MiB makes the reader sticky `unknown`, before content classification or
  discard. The bound applies even to a valid `other` output or an ignored event,
  image, compaction or patch record. Reopening the same oversized file from byte 0
  encounters the same limit; that thread stays native while its rollout exceeds
  the bound. R7 accepts this residual limit for this slice. Skipping oversized
  lines by a type prefix, raising limits or adding a different recovery policy
  requires separate review; the content-discard rule does not bypass these bounds.
- **Provenance.** A request qualifies only when the file holds a `function_call`
  whose `call_id` equals the request's `itemId` and whose `name` is exactly
  `request_user_input` with no namespace. App tool approvals carry the MCP
  call's id, and that call's record names a different tool. The skill
  MCP-dependency prompt has no function-call record at all. Both therefore stay
  native. Because the call is enqueued before dispatch, a bounded wait for its
  line covers writer lag. When the wait expires, the request is unidentified and
  stays native.
- **Mode.** For the built-in tool the source sets `isBlocking` exactly when the
  turn is in Plan mode. Positive provenance plus `isBlocking: true` therefore
  establishes the Plan-mode requirement for that version. The probe must confirm
  this against a Default-mode control, as the mode paragraph above requires.
- **Receipt.** `consumed` requires a `function_call_output` for the exact
  native call, classified `built-in`, whose parsed answer map equals the saved
  answer under the version-probed mapping. Scripted native 0.165.0 probes observed
  `{"answers":{}}` for an empty-map decline and a client error response. Source
  also maps a failed response receiver and a response body that cannot deserialize
  to that same empty answer map. The client-error path excludes the explicitly
  handled turn-transition error, which returns without submitting an answer.
  Therefore matching a saved decline to `{}` establishes the model's value only:
  it does not prove whose response won or whether an intentional decline caused
  it. Preserve that limit in presentation and the runbook; no causal/winner claim
  may be derived from empty-map equality. A nonempty saved answer followed by an
  empty native map is a mismatch, never `consumed`.
  Validate the complete native response body against the pinned answer mapping
  before handoff/send: a malformed relay response must fail locally rather than
  silently becoming a native decline. The native TUI decline, receiver-failure
  trigger, competition and activation gates remain outstanding.
- **Recovery.** A matching record found after reconnect or relay restart can
  settle reconciliation for that exact call. The proposed authoritative sign
  that a call is gone without an answer has three parts: protocol completion or
  abort of the request's `turnId`, a rollout read caught up past that point, and
  no matching output. The probe must confirm this, including what an aborted
  call records. An unfinished read or an unknown file state is never a sign of
  disappearance.

The rollout format is undocumented and version-specific. The evidence file must
pin it alongside the protocol, and a version mismatch disables the connector.
Probe fixtures come from captured real lines and are then extended with
malformed, oversized, truncated and rotated cases. Rejected alternatives:

- Leaving handed answers permanently unconfirmed. Why: it contradicts the
  parent's done criterion and this spec's acceptance. Cost if wrong: an
  extra file reader to maintain.
- Starting relay-owned threads with raw events enabled. Why: such threads do not
  serve the user's TUI questions, and the flag is documented for internal use.
  Cost if wrong: none for this route.
- Waiting for an upstream typed result. Why: no such request was found and no
  release date exists. Cost if wrong: if upstream ships one, the file reader
  becomes the second-best channel and should be replaced. A prepared upstream
  request is posted only with the user's approval.

## Delivery, native competition and defer

All inbox transitions use its existing serial queue and durable commit discipline.
Persist `handed` before sending the native response. Send only to a currently
replayed, validated native request of that exact tuple. Uncertain delivery never
permits sending to another request just because its numeric RPC id is equal.

`serverRequest/resolved` closes the pending RPC address; it does not establish who
answered or what the model received. Mark `consumed` only after a native tool result
for the exact call contains the saved answer, using a version-probed mapping. A
matching late result can confirm `unconfirmed` after the existing 60-second window.
For decline, this confirms only empty-map value equality, never the winning client
or the cause of that value.
A different result leaves the saved answer intact, records the actual observed
answer, and reports `unconfirmed`; do not claim the saved answer won. No model prose
or timing inference counts as receipt. If no correlated output is available, the
receipt gate fails and the route remains disabled.

First-answer-wins has two boundaries: relay serializes its own submissions and
replays the same `answerId`; Codex chooses between responses from its native UI and
relay. There is no atomic transaction spanning them. A saved phone answer can lose
at Codex. The existing saved/handed/unconfirmed/consumed labels remain truthful,
with mismatching native values retained in `observed`. The runbook must explain
this race. This is an explicit clarification of §5.3 for a native competing client,
not a claim that saving in relay locks Codex's desktop.

If the native answer arrives before any relay answer, withdraw the inbox question
as `answered-elsewhere`. A request cleared without a known native answer is
`asker-gone`, never guessed to be answered. If a relay answer was already saved,
retain it: before handoff, loss of the request makes it `undeliverable`; after
handoff, absent or mismatching receipt leaves it `unconfirmed`.

Defer uses `handback: true`: the inbox entry becomes `released`, relay sends no
answer or interrupt, and the native question remains available. A subsequent native
answer is recorded for history without changing `released`. Answer/defer races
inside relay retain the existing winner rule. Expiry similarly stops remote delivery
without inventing a native answer. A local withdrawal closes the relay entry only;
it does not cancel an unrelated part of the native turn. Document that the Codex
question can remain visible; native cancellation is outside this slice.

## Disconnection and recovery

The connector is an internal route owner, not a fake hook waiter. Extend the private
route representation only as needed and update validation, stored schema, JSDoc and
recovery together; leave existing hook ownership and local socket commands intact.
Connector operations cannot be invoked as Codex hook-waiter operations.

On transport disconnection stop sending immediately. Reconnect with bounded backoff
while the service lives; shutdown cancels timers and closes its socket. Do not infer
daemon death merely from losing the connection. Reconcile exact pending requests and
correlated outputs before any retry. Replay the same saved answer only if that exact
native call is proven pending; if resolved, obtain its result rather than resend.
Absence from a partial page or an unfinished replay is not proof of disappearance.

The probe must identify an authoritative way to finish this reconciliation, including
late attachment and relay restart. If a changed daemon identity or a completed
reconciliation proves the old call gone, withdraw pending entries as `asker-gone`
and mark saved-but-unhanded answers `undeliverable`. Already handed answers retain
their uncertain receipt state. Re-asks with new item/turn ids get new inbox UUIDs;
never match question text. Unknown liveness cannot authorize replay; existing expiry
and confirmation deadlines still apply. Persistent uncertainty is a failed acceptance
case, not permission to enable an incomplete route.

## Evidence gates and acceptance

The plan must record exact CLI and daemon versions, protocol fixture hashes, native
id/answer mappings, and a verdict for each gate. Version mismatch disables the
connector with an actionable diagnostic; the existing inbox continues serving.
An evidence file must be validated, not just present. No substring version match.

Start the revised native probes with a real WebSocket handshake and `initialize`
round trip against the private foreground server, without authentication or
inference. The earlier 101 response alone is insufficient. Derive subsequent
fake-process transport fixtures from captured real frames, then add malformed
and boundary cases; fake JSON-line success cannot establish the native wire
contract. Confirm from version-pinned source that the managed daemon and private
`--listen unix://` endpoint select the same listener, without connecting to the
live daemon. Listener equivalence does not prove recovery or other lifecycle
equivalence; those gates remain separate.

1. Transport connects to an isolated daemon and closes cleanly; joining loaded threads
   does not change their settings or start work. Test late join and new-thread discovery.
2. Ordinary blocking questions are positively distinguishable from app approvals,
   secret and async requests by the rollout provenance rule. The rule must also
   leave the skill-dependency prompt and unidentified calls native. Exercise all
   forms the translator will admit, including free text, Other, multiple items,
   and decline.
3. A phone-equivalent answer gets a correlated rollout `function_call_output`
   carrying its exact values. The rollout reader's limits, rotation and
   compression refusals and writer-lag wait are tested against captured lines. Test desktop-first and phone-first races, cleanup-only resolution,
   mismatch, interruption, and delayed confirmation. Include empty-map decline
   collisions with client error, failed receiver and malformed response body; test
   the turn-transition-error exception separately. Verify malformed relay bodies
   are refused before send, and nonempty saved answers cannot match an empty map.
   Record value equality without attributing the winning client. Source-shaped
   receiver-failure tests are distinct from native proof of what triggers them.
   No false `consumed` is allowed.
4. Defer leaves the native question usable and advances no turn until the desktop
   answers. Verify history and relay retry responses.
5. Transport reconnects and relay restarts preserve identity; daemon restart/re-ask rejects stale
   answers. Include recovery with no client attached and later attachment, either
   from current hq-25665e evidence or a focused isolated probe owned here. Do not
   wait for that task's unrelated OpenCode or exec probes. Explicitly test whether
   disconnecting a joined relay client while a question is pending causes receiver
   failure or an empty-map result, both with another client attached and with no
   client attached. This effect is unverified; socket loss alone proves neither
   decline nor continued waiting. If it silently declines, keep the gate failed
   and return for design review rather than call disconnect safe.
6. Unit and real local IPC fixtures cover queue ordering, durable restart, duplicate
   delivery, native-id reuse, evidence/version refusal, and child cleanup. Run through
   `just test-one`, `just test-fast` and `just gate`, on Node 22 and the development
   runtime. Build subprocess environments from explicit safe keys and fake credentials.
7. After automated gates, a user-present run answers one real Plan-mode question
   from the phone and separately defers another to the native desktop. Record both
   results, actual receipt, isolation and cleanup. Prepare exact temporary state,
   endpoint and rollback first; obtain host-use/host-change approval at execution.

The first probe is the smallest end-to-end pilot before an extended run. Do not
touch this session's daemon or use the live desktop to probe. Gates 1–5 concern
the protocol and the rollout record, not model behaviour. They run against the
installed Codex binary with a local scripted Responses provider in place of the
model. That spends no subscription turns, needs no credential, and makes each
tool call deterministic. The source's own tests use the same technique. The
model's real behaviour is exercised in gate 7. Mode enforcement stays a source
proof plus a scripted Default-mode control call. A scripted call cannot show
what a real model chooses, and gate 7 covers that. Implementation begins
only after the reviewed plan and passing protocol gates; activation and the human
acceptance remain distinct gates. If native identity, receipt or clarification-only
routing cannot be proved, record the blocker and return for a design decision.

## Change surface and exclusions

Expected code: `src/routes`, `src/serve/{serve,config,inbox,socket}.js`, lifecycle
and stored-entry validation, `src/types.js`, and their test fixtures/type checks.
Reuse the existing inbox, persistence, HTTP guard and event stream. Add only the
internal connector, its read-only rollout-record reader and necessary route
operations; no new HTTP endpoints, root exports, question-policy engine or
second transport implementation.

Update `docs/api.md`, the inbox-service runbook, route-probe instructions and
portable version evidence when implemented. The plan chooses the smallest private
metadata shape after the probes settle the actual native fields. No compatibility
layer or separate general-purpose RPC framework is requested.

Default-mode async/new-turn delivery, `codex exec`, OpenCode, new phone UI, automatic
presence, public exposure, permission/authorization routing, persistent installation
and daemon lifecycle management remain outside this task. None is implicitly
delivered by this addendum or by the existing detached-question route.


## R7 evidence and next gate

R7 adopts the user's approved spec-round-12 review direction; the execution
checkpoint and failed native results at `c36e7b7` remain unchanged. Pinned 0.165.0
source confirms inline-image output in `view_image.rs:238–254` and empty-answer
fallbacks, including the turn-transition exception, in
`bespoke_event_handling.rs:1705–1747`. No new native probe ran for r7.

Discarding all `other` output content with an id/fingerprint record replaces r6's
array-only discard; interpreting arbitrary tool content as answer text is rejected.
Why: unrelated strings and images are not receipt evidence. Cost if wrong: a
misclassified call could hide evidence, so earlier-call validation and the exact
provenance predicate remain mandatory. MCP is one example, not the scope of `other`.

The size limits remain an accepted residual restriction, rather than being bypassed
by type-prefix skipping. Why: preserve bounded fail-closed parsing. Cost: some valid
threads stay native indefinitely. The reviewer reported a size-only local census
of 87/12,697 rollouts with a line over 1 MiB and two files over 64 MiB (largest about
80 MB); this session did not repeat it or inspect live rollout content.

After frozen-text review of r7, the correction plan must cover:

- Byte-0 rebuild; unidentified outputs without an earlier call; strings and arrays
  from `other` retaining only id/hash, including non-MCP image output; identical
  and conflicting duplicates; later built-in receipts without unrelated retention.
- Unknown built-in structured/unidentified output, malformed JSON/IDs and existing
  file/size refusals, including oversized irrelevant lines and oversized-file reopen.
- Gate 3 empty-map collisions, local malformed-body refusal and value-only decline
  receipt; gate 5 proof of disconnect behavior, whose receiver-failure effect is
  unverified. Keep source-shaped tests distinct from native trigger evidence.
- Aggregate deadlines before any delayed case; remaining competition, defer,
  recovery and private-TUI gates; app exclusion/no-execution without approval receipt.

Provider-index and duplicate-prompt minors remain deferred. The stale decline
sentence is replaced by the stronger receipt contract. No correction plan,
production connector or activation is approved here. Simultaneous pending-call
safety, real-model provenance, phone/TUI acceptance and 0.166.0 remain unproved.
