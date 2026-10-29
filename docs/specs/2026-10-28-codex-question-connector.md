# Codex blocking question connector — addendum

Status: transport revision proposed; user review required before replanning.
The nontransport contract was approved at relay `77d3aee`; this revision replaces
the proxy/framing assumption disproved during execution of plan `3b668d5`.
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
- Raw response events can describe calls and outputs with call ids; typed thread
  items include `functionCallOutput`. Availability and exact id correspondence on
  this shared-daemon route remain unprobed.
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
0.162.1. They establish the earlier route's viability, not current-version support.
hq-25665e remains open, including no-client recovery; this design claims no result
from it. Task notes locate the source transcript and retained generated protocol.
No current-version live question probe has run for this addendum.

## Approaches

1. **Connect directly to the Unix WebSocket, recommended revision.** Use Node
   built-ins for the Unix socket, HTTP Upgrade and bounded WebSocket framing.
   No new runtime dependency or proxy child. Validate the upgrade response and
   acceptance key, mask client frames, handle fragmentation and control frames,
   bound aggregate message size and time, and reject unsupported compression.
   Test malformed and truncated frames, close/ping/pong, cancellation and reconnect
   before live use. Cost: relay owns a small but security-sensitive transport;
   the next reviewed plan must specify and test that boundary before probing.
2. **Keep the raw proxy and add WebSocket framing.** Technically possible, but
   requires the same framing implementation plus a child lifecycle. Rejected
   because the proxy supplies no framing or local-connection benefit here.
3. **Use detached questions instead of native integration.** Already supported, but
   requires agents to change how they ask and does not answer the native waiting
   tool call. Does not meet this task.

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
choice with `allowOther = isOther`; null options become bounded text. No multiselect
is invented. The route's maximum waiting period is 23 hours, as for Claude.

An answer maps back to native ids and exact labels or text. The probe establishes
the native declined representation and receipt; never substitute a guessed empty
object. Until proved, the route cannot activate, since the existing inbox offers
decline. Request bodies, unrelated transcript content, secrets and credentials are
not persisted or logged. Persist only the question, minimal routing metadata and
the actual matching answer observation required by the lifecycle.

## Delivery, native competition and defer

All inbox transitions use its existing serial queue and durable commit discipline.
Persist `handed` before sending the native response. Send only to a currently
replayed, validated native request of that exact tuple. Uncertain delivery never
permits sending to another request just because its numeric RPC id is equal.

`serverRequest/resolved` closes the pending RPC address; it does not establish who
answered or what the model received. Mark `consumed` only after a native tool result
for the exact call contains the saved answer, using a version-probed mapping. A
matching late result can confirm `unconfirmed` after the existing 60-second window.
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

1. Transport connects to an isolated daemon and closes cleanly; joining loaded threads
   does not change their settings or start work. Test late join and new-thread discovery.
2. Ordinary blocking questions are positively distinguishable from app approvals,
   secret and async requests. Exercise all forms the translator will admit, including
   free text, Other, multiple items, and decline.
3. A phone-equivalent answer gets a correlated native result carrying its exact
   values. Test desktop-first and phone-first races, cleanup-only resolution,
   mismatch, interruption, and delayed confirmation. No false `consumed` is allowed.
4. Defer leaves the native question usable and advances no turn until the desktop
   answers. Verify history and relay retry responses.
5. Transport reconnects and relay restarts preserve identity; daemon restart/re-ask rejects stale
   answers. Include recovery with no client attached and later attachment, either
   from current hq-25665e evidence or a focused isolated probe owned here. Do not
   wait for that task's unrelated OpenCode or exec probes.
6. Unit and real local IPC fixtures cover queue ordering, durable restart, duplicate
   delivery, native-id reuse, evidence/version refusal, and child cleanup. Run through
   `just test-one`, `just test-fast` and `just gate`, on Node 22 and the development
   runtime. Build subprocess environments from explicit safe keys and fake credentials.
7. After automated gates, a user-present run answers one real Plan-mode question
   from the phone and separately defers another to the native desktop. Record both
   results, actual receipt, isolation and cleanup. Prepare exact temporary state,
   endpoint and rollback first; obtain host-use/host-change approval at execution.

The first probe is the smallest end-to-end pilot before an extended run. Do not
touch this session's daemon or use the live desktop to probe. Implementation begins
only after the reviewed plan and passing protocol gates; activation and the human
acceptance remain distinct gates. If native identity, receipt or clarification-only
routing cannot be proved, record the blocker and return for a design decision.

## Change surface and exclusions

Expected code: `src/routes`, `src/serve/{serve,config,inbox,socket}.js`, lifecycle
and stored-entry validation, `src/types.js`, and their test fixtures/type checks.
Reuse the existing inbox, persistence, HTTP guard and event stream. Add only the
internal connector and necessary route operations; no new HTTP endpoints, root
exports, question-policy engine or second transport implementation.

Update `docs/api.md`, the inbox-service runbook, route-probe instructions and
portable version evidence when implemented. The plan chooses the smallest private
metadata shape after the probes settle the actual native fields. No compatibility
layer or separate general-purpose RPC framework is requested.

Default-mode async/new-turn delivery, `codex exec`, OpenCode, new phone UI, automatic
presence, public exposure, permission/authorization routing, persistent installation
and daemon lifecycle management remain outside this task. None is implicitly
delivered by this addendum or by the existing detached-question route.
