# Typed interaction messages: envelope, kinds, inbox and remote delivery

Status: accepted after spec review round 3 (relay-f58531, under ops-cb50a8).
Implementation Tasks 1–14 are complete and independently reviewed. The user-present
tailnet acceptance (spec acceptance 7) passed phone answer, phone defer and desk
withdrawal; see the [run record](../runbooks/inbox-e2e-2026-10.md).

## 1. Decision and scope

Relay gains a small set of typed interaction messages between agents and the user,
a durable inbox that holds them, and one long-lived per-host process, `relay serve`,
that owns the inbox and delivers it to local clients over a unix socket and to a phone
over the private tailnet. The first route implemented end to end is a Claude Code
`AskUserQuestion` in an interactive terminal session, answered from outside the
terminal (ops-cb50a8 milestone 2). The other harness routes are specified here and
implemented later.

The parent relay design (ops `docs/specs/2026-09-16-relay-design.md` §1) deferred a
daemon, socket and remote delivery because no consumer needed them. This design
revisits that deferral for the first consumer that does. hq-d85ede established that
every working answer route needs a process that outlives a single hook call: Codex
and OpenCode questions are answered by a protocol client that stays connected to the
harness's server, and the Claude Code hook route blocks a hook process on the answer
for as long as the user takes. The registry stays one-shot and lock-based. `relay serve` is a
separate component: it reads the registry and never writes it.

The parent design's line between applications still holds. Host requests and
cross-harness jobs are not built on this inbox. Agent-to-user notification gets a
`notice` kind here because a notice shares the envelope and the client. Ohai remains
the desktop notification client.

What v1 delivers:

- The envelope and five kinds (`question`, `answer`, `defer`, `withdrawal`,
  `notice`), with JSON Schema (Appendix A) and validators built on Node built-ins.
- The question lifecycle (§5), separating an answer saved, handed to the harness and
  confirmed received.
- The inbox store (§6) and `relay serve` with its socket and HTTP surfaces (§7).
- Presence routing (§8): a question goes to the inbox only while the user is away.
- The Claude Code terminal route (§9.1), with the installer binding behind its
  capability gate.
- CLI: `relay serve`, `relay ask`, `relay inbox`, `relay presence`.

Considered alternatives:

| Approach | Decision |
| --- | --- |
| One `relay serve` process as the inbox's only writer; local clients over a unix socket, the phone over loopback HTTP behind `tailscale serve` | Chosen: hq-d85ede's routes need a long-lived process anyway, and a single writer removes contention between writers and the need to poll. |
| Files as the source of truth: hooks write and poll entry files, a separate HTTP process reads and writes under the registry lock | Rejected: saves a daemon only until the Codex or OpenCode route, which cannot be built without one; locking between several writers and polling a hook for up to a day buy nothing. |
| Put the inbox in the phone client's server (ops-dba151) | Rejected: delivery and the interaction contracts are relay's (ops split design §3); the client depends on relay, not the reverse. |
| Route every question to the inbox | Rejected by the user (2026-10-11): the blocking hook hides the native question behind a spinner, which makes work at the desk worse. Presence mode instead (§8). |

## 2. Evidence

Probed by hq-d85ede on 2026-10-11 (hq `facts/capabilities.toml`, facts `answer-*`):

- **Claude Code 2.1.296, terminal.** A PreToolUse hook on `AskUserQuestion` that blocks
  and returns `permissionDecision: "allow"` with `updatedInput` (the original
  `questions` plus an `answers` map from question text to option label) continues the
  same turn. It was answered after 240 s, 660 s and 2100 s, with an explicit hook
  `timeout` of 86400 s. The terminal shows only a spinner. Esc or closing the session
  kills the hook. Resume does not replay the call, and a later re-ask uses a new
  `tool_use_id`, so an answer matched by question text lands on the new question.
- **Claude Code, `-p`.** The hook's `defer` decision ends the run with `tool_deferred`.
  A resume replays the same `tool_use_id` and accepts `allow` plus `updatedInput`, and a
  second resume after the answer is refused. Questions are offered only with
  `--permission-prompt-tool`.
- **Codex 0.162.1.** A client on the shared app-server daemon (WebSocket over its
  unix control socket) receives `item/tool/requestUserInput`, which is replayed to
  late joiners. It answers the request, and every client sees `serverRequest/resolved`.
  A second response is ignored silently. A daemon restart aborts the turn, and a
  recovery turn re-asks under a new `itemId`. The blocking tool runs only in Plan
  mode. The async tool is answerable only as a new turn and cannot be withdrawn
  (hq-5e63d9).
- **OpenCode 2.0.26.** A `form.created` event, then `POST /api/form/<id>/reply` (a
  second reply gets 409 and `DELETE` cancels). A server restart drops forms (404).

Documented, not probed (code.claude.com/docs/en/hooks): multi-select answers join
labels with commas; when PreToolUse hooks disagree, `deny` > `defer` > `ask` > `allow`;
Claude Code always offers a free-text "Other" on `AskUserQuestion`.

The plan probed these on Claude Code 2.1.296; all five route rows passed in
[the evidence record](../evidence/claude-code-answer-routes.json). The observations below
are version-specific; rerun the [probes](../runbooks/answer-route-probes.md) before
installing the route after an upgrade:

- **P1.** A hook that blocks for minutes and then exits 0 with no decision lets the
  native question appear and be answered in the terminal (the release route).
- **P2.** After a hook-supplied answer, `PostToolUse` for `AskUserQuestion` fires with
  the same `tool_use_id` and carries the answers in `tool_response`. The probe also
  measures how soon after the hook's exit it fires, and checks the same for an answer
  given in the terminal after a release.
- **P3.** With a second PreToolUse hook on the same call that denies at once, the probe
  records what Claude does with the still-blocking ask hook (kills it, waits for it, or
  leaves it running) and whether PostToolUse fires.

P1 released to the native UI. P2 observed `tool_response.answers` with matching
`tool_use_id` after hook and terminal answers. P3 awaited the blocking hook; denial
won and no PostToolUse fired. The design retains its fallbacks for failed future probes.

mind6 already exposes a loopback server to the phone through `tailscale serve`, with a
request guard keyed on `Tailscale-User-Login` and `Host` (mind6
`docs/guide/local-deployment.md`, `docs/ARCHITECTURE.md`). Relay's guard copies that
contract (§7.3).

## 3. Ownership

| Owner | Owns here |
| --- | --- |
| relay | Envelope, kinds, lifecycle, inbox, `relay serve`, socket and HTTP surfaces, harness answer routes, presence. |
| flows (flows-912ac5) | Which flow step waits on which kind, review payloads and verdicts, which evidence a gate demands. These are registered on top of relay's kinds, not added to them. |
| lore (lore-6f1efc) | Question policy: when to ask, how to phrase a question, when to name a recommendation. |
| autonomy (autonomy-1aac03) | Authority to act. An inbox answer is never an authorization (§4.3). |
| fam (fam-10b09d), forge | Identity and art the client renders: hue, ramp, member art. |
| hq | The verified capability facts per harness version and session mode. |
| ops-dba151 (home undecided) | The phone client. It depends on relay's HTTP surface only. |

## 4. Envelope and kinds

Types are written in TypeScript notation, as in `docs/api.md`; Appendix A gives the
JSON Schema. Times are Unix milliseconds. Every message `id` is a UUID generated by its
sender, so that a resent message is recognised as the same message.

### 4.1 Envelope

```ts
type Party = { kind: 'agent'; agentId: string } | { kind: 'user' };
type Surface = 'phone' | 'desktop' | 'cli' | 'terminal';
type Kind = 'question' | 'answer' | 'defer' | 'withdrawal' | 'notice';
type Message = {
  schema: 1;
  id: string;            // this message
  kind: Kind;
  correlationId: string; // the question's id; a question's own id; a notice's own id
  from: Party;
  to: Party;
  createdAt: number;
  context: { project: string | null; taskId: string | null; cwd: string | null };
  body: QuestionBody | AnswerBody | DeferBody | WithdrawalBody | NoticeBody;
};
```

`agentId` is the relay agent id `<harness>:<sessionId>`. In `context`, `project` is
the registry's `projectKey` when known, and `taskId` is a tasks id when the asker
supplies one. Unknown optional fields are ignored, and an unknown `schema` or `kind`
is rejected, as for the registry.

### 4.2 Question

```ts
type QuestionBody = {
  class: 'clarification' | 'artifact-review' | 'authorization';
  expiresAt: number;                       // required; §5.4
  native: { harness: Harness; sessionId: string; callId: string } | null;
  artifact: { ref: string; revision: string } | null;
  supersedes: string | null;               // id of a question this one replaces
  items: Item[];                           // 1 to 4
};
type Item = {
  id: string;                              // stable within the question
  header: string;                          // at most 16 characters
  prompt: string;                          // at most 1000 characters
  type: 'boolean' | 'single' | 'multi' | 'text';
  options: Option[];                       // 2 to 4 for single and multi; empty otherwise
  recommended: string | null;              // an option id, or null
  allowOther: boolean;                     // free text beside the options; single and multi only
  maxLength: number | null;                // text only, at most 2000
};
type Option = { id: string; label: string; description: string | null };
```

Answers reference option ids, never labels or positions. An option id is unique
within its item, an item id is unique within its question, and a question is never
mutated after it is created. To change one, ask again with `supersedes`. The
phone renders only this flat form, which corresponds to MCP elicitation's
primitives-and-enums subset. Richer payloads that flows registers for steps between
agents use their own `class` values in a later schema revision. The phone never
renders them.

`recommended` is set by the asker under lore's policy, and the schema does not
require it. `native` identifies the harness call the question came from (Claude
`tool_use_id`, Codex `itemId` with `turnId`, OpenCode form id) and is the key for
re-ask detection (§5.5). `artifact.ref` is an opaque reference (a path, a task id,
a URL) and `artifact.revision` a content identity (a git tree or blob hash, a
document hash).

### 4.3 Answer, defer, withdrawal, notice

```ts
type Value =
  | { type: 'boolean'; value: boolean }
  | { type: 'choice'; optionIds: string[] }        // exactly 1 for single
  | { type: 'other'; text: string }                // only when allowOther
  | { type: 'text'; text: string };
type AnswerBody = {
  answerId: string;                    // client-generated UUID; the idempotency key
  surface: Surface;
  outcome: 'answered' | 'declined';
  artifactRevision: string | null;     // the revision the responder saw
  values: Record<string, Value>;       // every item id when answered; empty when declined
};
type DeferBody = { surface: Surface };
type WithdrawalBody = {
  reason: 'asker' | 'user' | 'asker-gone' | 'superseded' | 'answered-elsewhere';
};
type NoticeBody = { expiresAt: number; title: string; text: string; level: 'info' | 'warn' };
```

An `answer` to an `authorization` question is accepted only from a local surface
(`desktop`, `cli`, `terminal`). A remote surface may defer or decline it. Even an
accepted answer records a decision and grants nothing: relay delivers it to the
asker, and whether any act is permitted is autonomy's question, not something an
inbox entry settles. The Claude adapter classes every `AskUserQuestion` as
`clarification`. The other classes come from askers that state them (flows, later).

`notice` is one-way and has no lifecycle beyond `expiresAt` and a `seen` mark. v1
defines its schema and stores it, but no producer is wired yet.

## 5. Lifecycle

### 5.1 States

A question entry is in exactly one state:

| State | Meaning | Terminal |
| --- | --- | --- |
| `pending` | Waiting for an answer. Its `presentation` is `inbox` or `desktop` (after a defer on a route that cannot hand the question back). | no |
| `answered` | An answer is saved. The asker's route has not yet taken it. | no |
| `handed` | The route took the answer and is about to give it to the harness. Nothing yet says the agent received it. | no |
| `consumed` | The harness confirmed receipt: a successful tool result for the same native call carries the saved answer (§9.1 step 6). | yes |
| `unconfirmed` | Handed, and no confirmation arrived within the route's window. A late matching confirmation still moves it to `consumed`. | yes, except for that |
| `undeliverable` | An answer is saved, but the asker died before its route took it, and nothing can consume it. | yes |
| `released` | The route handed the question back to the harness's own UI after a defer (§9.1). Relay no longer delivers it. | yes |
| `withdrawn` | Voided by the asker, by the user, by the asker's death, or by a superseding question. | yes |
| `expired` | `expiresAt` passed while pending. | yes |

The client labels are fixed:

| State | Label |
| --- | --- |
| `answered` | "answer saved" |
| `handed` | "handed to the agent" |
| `consumed` | "the agent received it" |
| `unconfirmed` | "handed, receipt not confirmed" |
| `undeliverable` | the saved answer, with the reason |

A client never shows "received" for any state but `consumed`. Every transition is
recorded with its time, the message or observation that caused it, and a service-wide
sequence number (§6).

The states that hold an answer are `answered`, `handed`, `consumed`, `unconfirmed` and
`undeliverable`. The rules below call them the *answer-holding* states.

### 5.2 Transitions

| From | Event | To | Response to the sender |
| --- | --- | --- | --- |
| — | question accepted | `pending` (inbox) | entry |
| — | question with an existing `id` and identical body | unchanged | entry (idempotent; a reconnecting waiter reattaches) |
| — | question with an existing `id` and a different body | unchanged | `ID_CONFLICT` |
| `pending` | valid answer (first) | `answered` | entry |
| `pending` | defer, route can hand back | `released` | entry |
| `pending` | defer, route cannot hand back | `pending` (desktop) | entry |
| `pending` | withdrawal | `withdrawn` | entry |
| `pending` | superseded (§5.5) | `withdrawn (superseded)` | — |
| `pending` | clock reaches `expiresAt` | `expired` | — |
| `pending` | asker gone | `withdrawn (asker-gone)` | — |
| `answered` | route takes the answer | `handed` | entry |
| `answered` | asker gone | `undeliverable` | — |
| `handed` | matching confirmation | `consumed` | — |
| `handed` | confirmation window ends | `unconfirmed` | — |
| `unconfirmed` | matching confirmation | `consumed` | — |
| `handed`/`unconfirmed` | confirmation that does not match the saved answer | `unconfirmed`, with the observed answer recorded | — |
| answer-holding | answer with the same `answerId` | unchanged | entry (idempotent replay) |
| answer-holding | answer with another `answerId` | unchanged | `ALREADY_ANSWERED` + the winning answer |
| answer-holding | defer | unchanged | `ALREADY_ANSWERED` + the winning answer |
| answer-holding | withdrawal | unchanged | `ANSWERED` + the saved answer |
| `withdrawn`/`expired`/`released` | answer or defer | unchanged | `WITHDRAWN` / `EXPIRED` / `RELEASED` |
| `pending` | answer with a non-matching `artifactRevision` | unchanged | `STALE` + the question's revision |
| `pending` | answer failing validation | unchanged | `INVALID_ANSWER` |

The checks for an answer run in this order: idempotent replay (any state), then
terminal or answer-holding state, then validation, then revision. So a retry of an
answer that was already saved returns the saved entry in every answer-holding state,
`undeliverable` included. A phone whose response was lost therefore recovers the
outcome of its own answer instead of competing with it.

A waiter attached through `ask` (§7.2) receives a `state` line on every transition of
its entry. It never has to infer a change from silence.

### 5.3 Ordinary cases

- **Phone and desktop both answer.** The service serializes every write, so the first
  answer saved wins and the second gets `ALREADY_ANSWERED`, and the client shows the
  winning answer with its surface and time.
- **Answer races a defer.** Whichever is applied first wins. A defer that loses gets
  `ALREADY_ANSWERED`, and an answer that loses to a release gets `RELEASED`.
- **Retry after a lost connection.** The client resends the same `answerId`. If the
  first attempt was saved, the reply is the saved entry in whatever answer-holding
  state it has reached. If it was not, this attempt is the first. A client keeps the
  `answerId` until it sees a response.
- **The asker withdraws while an answer is in flight.** Whichever reaches the service
  first wins. A withdrawal that loses gets `ANSWERED` with the answer, and an answer
  that loses gets `WITHDRAWN`.
- **The session ends before delivery.** The answer stays saved. A route whose harness
  keeps the request alive (a Codex thread, an OpenCode session, a `-p` run that can be
  resumed) takes it when it reconnects. On the Claude terminal route a dead hook has
  no successor, so the entry becomes `withdrawn (asker-gone)` while pending, or
  `undeliverable` once answered and not yet handed.
- **Expiry.** It is checked when the service starts, on a timer, and before every write.
  On a host that wakes from sleep, overdue questions expire before any queued answer
  is applied.

### 5.4 Expiry

`expiresAt` is required on every question. The Claude terminal route sets it to the
creation time plus 23 h. That falls within the hook's 24 h outer timeout, so the
service expires the question and notifies the hook before Claude kills it. Askers that
supply their own expiry are clamped to the route's maximum.

### 5.5 Re-asks, supersession and stale answers

The asker generates a question's `id` (a UUID), and the question is keyed to
`native.callId`. It is never matched by its text. After a harness restart, a re-ask
arrives under a new call id as a new question, and the old entry has already been
withdrawn because its asker is gone. A late answer to the old id gets `WITHDRAWN`.

When the asker knows a question replaces an earlier one (the artifact changed, the plan
moved on), it sets `supersedes`. Only the asker of the earlier question, with the same
`from`, may supersede it, and only while that question is `pending`. Otherwise the new
question is refused: with `ANSWERED` and the saved answer if one exists, or with
`NOT_SUPERSEDABLE`. A Claude terminal asker is blocked inside its own call and never
supersedes.

Supersession touches two entry files. It is published in a fixed order that can be
recovered after a crash:

1. Check the rule above against the in-memory state. No other write can run between
   this check and step 3, because the service is the only writer and applies one
   request at a time.
2. Write the replacement entry N (`pending`, `supersedes: X`).
3. Write X as `withdrawn (superseded)`, with `supersededBy: N`.
4. Only then respond to the asker and publish both changes to watchers.

On start, before the service accepts any connection, it reconciles: for every
non-terminal N whose `supersedes` names an X that is not `withdrawn (superseded)` by N,
it completes step 3 if X is `pending`. If X is in any other state, the service
cannot reach that state through steps 1 to 3, so it treats N as corrupt: it moves N
to `inbox/rejected/`, reports it, and leaves X untouched. A crash before step 2
leaves nothing, and the asker retries its question with the same `id`.

Reconciliation can always find X because pruning keeps it (§6): a terminal entry named
by the `supersedes` of a retained non-terminal entry is never pruned. So a missing X
under a non-terminal N is corruption, never age, and is handled like the other corrupt
case. X becomes prunable once N is terminal, and each is then pruned on its own 30-day
clock.

A question with an `artifact` requires every answer to echo `artifactRevision`, and the
service rejects a mismatch as `STALE`. Because a question is immutable, the only way to
put a new revision under decision is a superseding question, and that keeps an answer
bound to what its responder saw. The asker checks the revision again when it consumes
the answer, since relay cannot see every artifact change.

## 6. Inbox store

`relay serve` is the store's only writer. It takes an exclusive service lock at
`$STATE/serve.lock`, using the same lock primitives as the registry, so a second
`relay serve` fails with `SERVE_RUNNING`. Layout under the existing 0700 state
directory:

```
$STATE/inbox/
  seq                  # highest sequence number ever allocated, decimal
  entries/<id>.json    # one entry per question or notice
  rejected/            # entries that failed validation or reconciliation
```

An entry holds the original message, every later message on its correlation id, the
current state, `presentation`, the transition log and, for a waiter, the route's
recovery data (§9.1). Each write goes to a temporary file, which is fsynced and
renamed, and then the directory is fsynced. That is the registry's publication
discipline applied per entry.

**Sequence numbers.** For each change, the service allocates the next number and
writes `seq` before it writes the entry that carries the number. On start, the counter
is the larger of the persisted `seq` and the highest number in the retained entries. So
neither a crash between the two writes nor pruning the entry that held the highest
number can make a number repeat. Gaps are allowed. A client resuming from a number
receives every retained change above it.

On start the service does the following, in order, before accepting connections:

1. Recover `seq`.
2. Reconcile supersessions (§5.5).
3. Expire overdue questions.
4. Move `handed` entries whose confirmation window has passed to `unconfirmed`.
5. Begin the waiter checks (§9.1).

Terminal entries older than 30 days are pruned at start and daily, except a
predecessor still named by a non-terminal replacement (§5.5). An entry that fails
validation is moved to `inbox/rejected/` and reported, never loaded or deleted silently.

Raw harness payloads, transcripts and environment values never enter the store. A
question stores only the fields of §4.2.

## 7. Service and surfaces

### 7.1 Process

`relay serve` runs in the foreground and is supervised by a systemd user unit
(`relay-serve.service`, documented in a runbook, not installed by relay). On SIGTERM it
stops accepting connections, finishes the write in progress and exits. It holds no
answer only in memory: every acknowledged write is on disk.

### 7.2 Local socket

`$STATE/serve.sock` is created with mode 0600. The protocol is newline-delimited JSON:
one request object per line and one response per line, correlated by a client `reqId`.

| Op | Request | Response |
| --- | --- | --- |
| `ask` | a question message, `waiter` (process handle) and `handback` (whether the route can return the question to the harness's UI) | the entry, then a `state` line on every later transition of the entry, until the connection closes |
| `handed` | `{ id, waiter }`, sent by the waiter before it gives the answer to the harness; idempotent for that waiter (§9.1) | entry, or `NOT_WAITER` |
| `confirm` | `{ harness, callId, observed }` from the route's post-call observation | entry or `NOT_FOUND` |
| `answer` / `defer` / `withdraw` | message | entry or error |
| `notify` | notice message | entry (no v1 producer is wired) |
| `list` | `{ since?: seq, states?: [...] }` | entries |
| `get` | `{ id }` | entry |
| `presence.get` / `presence.set` | `{ mode? }` | presence |
| `watch` | `{ since?: seq }` | entries as they change |

The socket's 0600 mode is the only local authentication: any process running as the
user is trusted, as it already is with the registry.

### 7.3 HTTP surface for remote clients

The service listens on `127.0.0.1:<port>` only (`RELAY_HTTP_PORT`, no default: the HTTP
surface is off unless configured). `tailscale serve --bg --https=443
http://127.0.0.1:<port>` exposes it to the tailnet. The request guard copies mind6's:

- **Proxied requests.** A request carrying `X-Forwarded-*`, `Tailscale-User-Login` or
  `Tailscale-Funnel-Request` is proxied. It is refused with 403 unless
  `RELAY_SERVE_HOST` and `RELAY_SERVE_LOGIN` are both set, its `Tailscale-User-Login`
  equals the login, its `Host` equals the host, and it carries no
  `Tailscale-Funnel-Request`.
- **Local requests.** Any other request is local and must carry a loopback `Host` on
  the configured port.
- **Configuration.** Setting one of the two variables without the other stops the
  service at start, naming the missing one.
- **POST and PUT requests.** Each needs an `Origin` equal to the matched origin and an
  `application/json` body at most 64 KiB in bytes. Host and Origin include any
  non-443 tailnet port. Any `X-Forwarded-*` header marks a request as proxied.

The guard sets an answer's or defer's `surface`: `phone` for a proxied request and
`desktop` for a local one. A value the client sent is overwritten.

| Method and path | Effect |
| --- | --- |
| `GET /v1/inbox?since=<seq>` | non-terminal entries plus terminal ones changed since `seq` |
| `GET /v1/inbox/<id>` | one entry |
| `POST /v1/inbox/<id>/answer` | `AnswerBody`; §5.2 responses, as HTTP 200 or 409 with `{error:{code,message}, entry}` |
| `POST /v1/inbox/<id>/defer` | `DeferBody` |
| `GET /v1/events` | Server-Sent Events; each event's id is its `seq`, and `Last-Event-ID` resumes |
| `GET` / `PUT /v1/presence` | read or set presence |
| `GET /v1/agents` | the registry snapshot's agent ids, harnesses and project labels, for display |

There is no HTTP withdrawal or seen route in v1.

The service also serves a single static directory read-only at `/` when
`RELAY_CLIENT_DIR` is set, so that a client built elsewhere (ops-dba151) shares the
service's origin. Relay ships no client and no presentation code.

**Host asleep.** A suspended host serves nothing. The phone shows the time of its last
sync, and a client may hold an answer and retry it with the same `answerId` after
reconnecting. Expiry is applied before the queued answer (§5.3), so an answer to a
question that expired while the host slept gets `EXPIRED`. Waking the host is out of
scope.

### 7.4 CLI

| Command | Contract |
| --- | --- |
| `relay serve` | Run the service. |
| `relay ask --harness claude-code PreToolUse\|PostToolUse` | The question route's two hook commands (§9.1). |
| `relay inbox [--json] [list\|show <id>\|answer <id> ...\|defer <id>\|withdraw <id>]` | The minimal desktop surface. |
| `relay presence [here\|away]` | Read or set presence. |

`relay inbox` and `relay presence` talk to the socket and fail with `SERVE_UNAVAILABLE`
when the service is not running.

## 8. Presence routing

Presence is `here` or `away`. It is stored in `$STATE/presence.json`, changed only
through the service, and settable from any surface, the phone included.

- **`here`.** The question route passes the call through at once (§9.1): the native
  question appears as it does today, and no inbox entry is created.
- **`away`.** The question goes to the inbox. A defer on a route that can hand the
  question back moves the entry to `released`, and the route returns the question to
  the harness's own UI (the Claude terminal route, with P1, §9.1). On any other route
  the defer sets `presentation: desktop`, and the entry stays pending for desktop
  surfaces (`relay inbox`).

If the service is unreachable when the hook asks, the hook passes through to the
native question and prints `SERVE_UNAVAILABLE` on stderr. Passing through is the safe
direction: the question is shown where the user would see it anyway, and nothing is
answered for them. Automatic presence (idle detection, desktop lock) is out of v1.

## 9. Adapter routes

### 9.1 Claude Code, interactive terminal (v1)

`relay ask --harness claude-code` is the route's command, installed as two hook
entries of its own, outside `relay hook`'s dispatch (whose budgets assume sub-minute
work):

- **PreToolUse** on matcher `AskUserQuestion`, timeout 86400 s. This entry asks and
  waits.
- **PostToolUse** on matcher `AskUserQuestion`, timeout 10 s. This entry confirms
  receipt.

The current adapter maps no PostToolUse event and the installer's binding table has no
PostToolUse row, so both are new work in this route. They are added as the route's own
rows, and the twenty normalized registry mappings are left unchanged. The installer
adds both rows behind the capability rows of §11. Installing them stays the user's act,
as for every live hook.

1. **Read the call.** The PreToolUse hook reads the native payload through the existing
   bounded reader and derives the agent id from `session_id`.
2. **Translate.** It turns `tool_input.questions` into a question with a fresh UUID
   `id`. Each Claude question becomes an item: `question` becomes `prompt`, and
   `multiSelect` makes it `single` or `multi`. Item ids are `q1` to `q4` and option ids
   are `o1` to `o4`, in the asker's order, so they are stable for this immutable
   question. `header` and `description` are copied, `allowOther` is true and
   `recommended` is null. `native.callId` is the `tool_use_id`.
3. **Ask.** The hook sends `ask` with its own process handle as `waiter`, and with
   `handback: true` when P1 holds. It then holds the connection. A `here` presence
   returns `passthrough` immediately, and no entry is created.
4. **Resolve.** The hook acts on the `state` lines for its entry:
   - **Answered,** or a handoff this waiter began but did not finish (below). The hook
     sends `handed` and waits for the acknowledgement. Then it maps
     option ids back to labels, joins multi choices with `, `, passes an `other` value
     as its text, writes `allow` with `updatedInput` (the original `questions` plus
     `answers`) and exits 0. `handed` is sent before the reply is written, because once
     the reply is written the hook may be killed at any moment. If the hook dies after
     `handed` but before writing, the entry reads "handed, receipt not confirmed" and
     never "received". That is true, if pessimistic.

     *Handoff retry.* `handed` is idempotent for the entry's recorded waiter. A `handed`
     from the waiter whose handle matches the entry's, on an entry already `handed` or
     `unconfirmed`, is acknowledged again and changes nothing. A `handed` from any other
     process is refused with `NOT_WAITER`. When that waiter reattaches (by resending
     `ask` with the same `id`), the service sends the entry's current state and saved
     answer as usual. A hook that has not yet written its reply treats `handed` or
     `unconfirmed` as an unfinished handoff: it resends `handed` and, once acknowledged,
     writes its reply. A hook writes its reply at most once and then exits, so a retry
     can never deliver twice. Without this rule, a service crash after `handed` is
     persisted but before it is acknowledged leaves a live hook holding an undelivered
     answer until Claude's outer timeout. With it, the hook finishes on reattach. The
     entry may already read `unconfirmed` if the reattach took longer than the window,
     and a later PostToolUse still moves it to `consumed`.
   - **Declined.** Same order, with an `answers` map in which each question maps to
     `(declined)`, plus `additionalContext` saying the user chose not to answer. P2
     confirms it like any answer.
   - **Released** (a defer, on a route with `handback: true`). The hook exits 0 with no
     output, so the native question appears in the terminal (P1).
   - **Expired.** With P1, the same as released: the user at the desk still sees the
     question. Without P1, the hook denies (below).
   - **Withdrawn.** On this route only the user can withdraw (`relay inbox withdraw`),
     because the asker is blocked and never supersedes (§5.5). The hook must stop the
     call, not release it. It returns `deny` with the reason "question withdrawn by the
     user; do not wait for an answer". hq-d85ede observed that a denied
     `AskUserQuestion` is seen by the model as a hook error, and that the model stops
     its turn. A withdrawal therefore ends the turn and leaves the session at the
     prompt, which is the intent: the user withdrew the question from the desk.
5. **Detect a dead hook.** The hook's socket connection is the liveness signal. If it
   closes while the entry is `pending`, the entry becomes `withdrawn (asker-gone)`. If
   it closes while `answered`, the entry becomes `undeliverable`. Closing after
   `handed` is the normal end. Esc, session close and a guard's denial all kill or end
   the hook (P3), and all look like a closed connection. The entry also records the
   hook's process handle (relay's `Handle`). If the service restarts while a hook
   waits, the hook reconnects with backoff until its own outer timeout and resends
   `ask` with the same `id`, which reattaches. A pending or answered waiter that has
   not reattached within 10 s of service start is probed with relay's liveness probe,
   and only a confirmed death applies the rule above. A live waiter that is slow to
   reattach keeps its entry. A `handed` entry whose waiter never returns needs no
   probe: its confirmation window moves it to `unconfirmed`.
6. **Confirm receipt.** The PostToolUse hook sends `confirm` with the `tool_use_id` and
   the answers from `tool_response` (P2), then exits 0 with no output.
   - If the entry is `handed` or `unconfirmed` and the answers equal the saved
     answer's labels, the entry becomes `consumed`.
   - If the answers differ, the entry becomes `unconfirmed`, and the observed answer is
     recorded.
   - If the entry is `released` or `expired`, the native answer is recorded with
     `surface: terminal` for the history only, and the state is unchanged.

   The confirmation window is 60 s from `handed`. Without P2 this route has no
   confirmation: every handed answer becomes `unconfirmed`, and clients show that this
   route cannot confirm receipt.

A guard denial from the ordinary `relay hook` PreToolUse dispatch still wins by
Claude's precedence (`deny` > `allow`). P3 establishes what Claude does with the
blocking ask hook when another hook has already denied. If Claude kills it, step 5
withdraws a pending entry. If Claude waits for it, the answer is handed and no
PostToolUse follows, so the entry ends `unconfirmed`. Either way, the phone never
shows "received" for a call that did not run.

### 9.2 Claude Code, `claude -p` (specified, later)

The same translation, but the hook returns `defer` at once, and the entry records that
the run can be resumed. A launcher that owns the `-p` run resumes it once the entry is
`answered`, and the hook (now with the answer) returns `allow` with `updatedInput`. The
replayed `tool_use_id` matches the entry. The resumed hook sends `handed`, and the
matching PostToolUse confirms the entry as in §9.1. A second resume is refused by
Claude.

### 9.3 Codex, app-server (specified, later)

A connector inside `relay serve` attaches to the shared app-server daemon. Each
`item/tool/requestUserInput` becomes a question keyed to `itemId` plus `turnId`.
An answer is sent as the request's response, and `serverRequest/resolved` with no
relay answer means `withdrawn (answered-elsewhere)`. On a daemon restart, pending entries
are withdrawn (`asker-gone`) and the recovery turn's re-ask is a new question. Codex
options carry no ids, so they are assigned as for Claude, and `isOther` maps to
`allowOther`. The async tool has no withdrawal (hq-5e63d9): its question becomes an
entry whose answer is delivered as a new turn. The entry is `handed` when relay starts
that turn, and `consumed` when the turn's start is acknowledged on the thread.

### 9.4 OpenCode, server (specified, later)

A connector subscribes to `form.created` and posts `form/<id>/reply`. A 409 means
`withdrawn (answered-elsewhere)`, and a 404 after a restart means `asker-gone`. A
defer leaves the form open in the TUI.

## 10. Relation to `tasks park --waiting-on user`

A pending question and a park are different statements. A question says one decision
is waiting, and the agent may go on with independent work. A park says the agent has
stopped. In v1 neither writes the other. An agent that stops because of a question
parks under the tasks protocol, and the question's `context.taskId` lets a later
client show the two together. Whether a deferred question should prompt a park is
lore's policy (lore-6f1efc).

## 11. Capability facts

Relay's evidence record (`schema: 1`) gains rows for the routes this design uses:

- `answer-hook-terminal` (Claude, referencing hq-d85ede)
- `answer-hook-deny-stops` (Claude, hq-d85ede: a denied question stops the turn)
- P1 `answer-release-native`
- P2 `answer-receipt-observed`
- P3 `answer-hook-under-denial`

The installer refuses the `relay ask` PreToolUse binding unless `answer-hook-terminal`
and `answer-hook-deny-stops` are `probed` and true for the installed version. It
refuses the PostToolUse binding unless P2 is. P1 decides the route's `handback`, and P3
is recorded for the lifecycle's interpretation and gates nothing. This is the same
practice the installer follows for existing bindings. hq's consolidated view takes relay's rows by reference (ops split
design §5.3).

## 12. Out of v1, and acceptance

**Out of v1:**
- The Claude `-p`, Codex and OpenCode routes (specified above)
- Notice producers
- Automatic presence
- A phone or desktop client beyond `relay inbox`
- Familiar identity in the HTTP feed
- Payloads for steps between agents
- Push notifications
- Waking a sleeping host
- Multiple users
- Any authorization semantics

**Acceptance:**
1. Probes P1, P2 and P3 run on the installed Claude Code first, and their results are
   recorded as evidence rows. Where they fail, the plan follows the named fallbacks
   before any route code.
2. Schemas and validators, with fixture tests for every kind and every rejection.
3. The store and lifecycle as a pure state machine, tested for every transition in
   §5.2, with crash recovery tested for:
   - a crash between `seq` and the entry;
   - a crash between the two writes of a supersession;
   - pruning the highest-numbered entry, then a restart;
   - pruning past 30 days while a replacement is still `answered` and waiting for its
     asker: the predecessor is retained, the restart reconciles cleanly, and both are
     pruned once the replacement is terminal and old enough.

   Replay of the same `answerId` is tested in every answer-holding state.
4. `relay serve` with the socket and the waiter liveness, tested with real processes
   and sockets, including:
   - a hook killed mid-wait, before and after `handed`;
   - a service crash between persisting `handed` and acknowledging it, with the hook
     reattaching both inside and after the 60 s window: the hook writes its reply once,
     and a later confirmation moves the entry to `consumed`;
   - `handed` from a process that is not the waiter, refused;
   - a service restart under a waiting hook;
   - a defer reaching a waiting hook as `released`.
5. The HTTP surface and guard, tested for every proxied and local case of §7.3 and for
   SSE resume.
6. `relay ask` translation both ways, its release, withdrawal (deny) and confirmation
   paths, and its two installer bindings behind the capability rows.
7. End to end on the host with the user present: one real Claude Code
   `AskUserQuestion` while `away`, run three times:
   - answered from another tailnet device through the HTTP API, and seen there as
     `consumed`;
   - deferred to the native terminal question;
   - withdrawn from the desk, ending the turn.

The plan decomposes along these seven, Node 22 floor included.

## Appendix A. JSON Schema

Draft 2020-12. Files: `schemas/interaction/message.schema.json`, with one `$defs` entry
per body. Shown here condensed; the files are normative once committed, and the
validators are tested against them.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "relay:interaction/message/1",
  "type": "object",
  "required": ["schema", "id", "kind", "correlationId", "from", "to", "createdAt", "context", "body"],
  "properties": {
    "schema": { "const": 1 },
    "id": { "$ref": "#/$defs/uuid" },
    "kind": { "enum": ["question", "answer", "defer", "withdrawal", "notice"] },
    "correlationId": { "$ref": "#/$defs/uuid" },
    "from": { "$ref": "#/$defs/party" },
    "to": { "$ref": "#/$defs/party" },
    "createdAt": { "$ref": "#/$defs/ms" },
    "context": {
      "type": "object", "required": ["project", "taskId", "cwd"],
      "properties": {
        "project": { "type": ["string", "null"] },
        "taskId": { "type": ["string", "null"], "pattern": "^[a-z0-9-]+-[0-9a-f]{6}$" },
        "cwd": { "type": ["string", "null"] }
      }
    },
    "body": { "type": "object" }
  },
  "allOf": [
    { "if": { "properties": { "kind": { "const": "question" } } }, "then": { "properties": { "body": { "$ref": "#/$defs/question" } } } },
    { "if": { "properties": { "kind": { "const": "answer" } } }, "then": { "properties": { "body": { "$ref": "#/$defs/answer" } } } },
    { "if": { "properties": { "kind": { "const": "defer" } } }, "then": { "properties": { "body": { "$ref": "#/$defs/defer" } } } },
    { "if": { "properties": { "kind": { "const": "withdrawal" } } }, "then": { "properties": { "body": { "$ref": "#/$defs/withdrawal" } } } },
    { "if": { "properties": { "kind": { "const": "notice" } } }, "then": { "properties": { "body": { "$ref": "#/$defs/notice" } } } }
  ],
  "$defs": {
    "uuid": { "type": "string", "format": "uuid" },
    "ms": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
    "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{0,31}$" },
    "surface": { "enum": ["phone", "desktop", "cli", "terminal"] },
    "party": {
      "oneOf": [
        { "type": "object", "required": ["kind", "agentId"], "properties": { "kind": { "const": "agent" }, "agentId": { "type": "string", "pattern": "^(claude-code|codex|opencode):.+$" } } },
        { "type": "object", "required": ["kind"], "properties": { "kind": { "const": "user" } } }
      ]
    },
    "option": {
      "type": "object", "required": ["id", "label", "description"],
      "properties": { "id": { "$ref": "#/$defs/id" }, "label": { "type": "string", "minLength": 1, "maxLength": 80 }, "description": { "type": ["string", "null"], "maxLength": 400 } }
    },
    "item": {
      "type": "object", "required": ["id", "header", "prompt", "type", "options", "recommended", "allowOther", "maxLength"],
      "properties": {
        "id": { "$ref": "#/$defs/id" },
        "header": { "type": "string", "minLength": 1, "maxLength": 16 },
        "prompt": { "type": "string", "minLength": 1, "maxLength": 1000 },
        "type": { "enum": ["boolean", "single", "multi", "text"] },
        "options": { "type": "array", "items": { "$ref": "#/$defs/option" }, "maxItems": 4 },
        "recommended": { "type": ["string", "null"] },
        "allowOther": { "type": "boolean" },
        "maxLength": { "type": ["integer", "null"], "minimum": 1, "maximum": 2000 }
      },
      "allOf": [
        { "if": { "properties": { "type": { "enum": ["single", "multi"] } } }, "then": { "properties": { "options": { "minItems": 2 }, "maxLength": { "const": null } } }, "else": { "properties": { "options": { "maxItems": 0 }, "recommended": { "const": null }, "allowOther": { "const": false } } } },
        { "if": { "properties": { "type": { "const": "boolean" } } }, "then": { "properties": { "maxLength": { "const": null } } } }
      ]
    },
    "question": {
      "type": "object", "required": ["class", "expiresAt", "native", "artifact", "supersedes", "items"],
      "properties": {
        "class": { "enum": ["clarification", "artifact-review", "authorization"] },
        "expiresAt": { "$ref": "#/$defs/ms" },
        "native": { "oneOf": [ { "type": "null" }, { "type": "object", "required": ["harness", "sessionId", "callId"], "properties": { "harness": { "enum": ["claude-code", "codex", "opencode"] }, "sessionId": { "type": "string", "minLength": 1 }, "callId": { "type": "string", "minLength": 1 } } } ] },
        "artifact": { "oneOf": [ { "type": "null" }, { "type": "object", "required": ["ref", "revision"], "properties": { "ref": { "type": "string", "minLength": 1 }, "revision": { "type": "string", "minLength": 1 } } } ] },
        "supersedes": { "oneOf": [ { "type": "null" }, { "$ref": "#/$defs/uuid" } ] },
        "items": { "type": "array", "items": { "$ref": "#/$defs/item" }, "minItems": 1, "maxItems": 4 }
      }
    },
    "value": {
      "oneOf": [
        { "type": "object", "required": ["type", "value"], "properties": { "type": { "const": "boolean" }, "value": { "type": "boolean" } } },
        { "type": "object", "required": ["type", "optionIds"], "properties": { "type": { "const": "choice" }, "optionIds": { "type": "array", "items": { "$ref": "#/$defs/id" }, "minItems": 1, "maxItems": 4, "uniqueItems": true } } },
        { "type": "object", "required": ["type", "text"], "properties": { "type": { "const": "other" }, "text": { "type": "string", "minLength": 1, "maxLength": 2000 } } },
        { "type": "object", "required": ["type", "text"], "properties": { "type": { "const": "text" }, "text": { "type": "string", "maxLength": 2000 } } }
      ]
    },
    "answer": {
      "type": "object", "required": ["answerId", "surface", "outcome", "artifactRevision", "values"],
      "properties": {
        "answerId": { "$ref": "#/$defs/uuid" },
        "surface": { "$ref": "#/$defs/surface" },
        "outcome": { "enum": ["answered", "declined"] },
        "artifactRevision": { "type": ["string", "null"] },
        "values": { "type": "object", "additionalProperties": { "$ref": "#/$defs/value" } }
      }
    },
    "defer": { "type": "object", "required": ["surface"], "properties": { "surface": { "$ref": "#/$defs/surface" } } },
    "withdrawal": { "type": "object", "required": ["reason"], "properties": { "reason": { "enum": ["asker", "user", "asker-gone", "superseded", "answered-elsewhere"] } } },
    "notice": {
      "type": "object", "required": ["expiresAt", "title", "text", "level"],
      "properties": { "expiresAt": { "$ref": "#/$defs/ms" }, "title": { "type": "string", "minLength": 1, "maxLength": 80 }, "text": { "type": "string", "maxLength": 2000 }, "level": { "enum": ["info", "warn"] } }
    }
  }
}
```

Some rules JSON Schema cannot express, and the validators enforce them:

- Option and item ids are unique within their scope.
- `recommended` names one of the item's options.
- Every item has a value when the outcome is `answered`, and `values` is empty when it
  is `declined`.
- A value fits its item: `choice` only for `single` or `multi`, with exactly one id for
  `single`, and every id must be an option of the item. `other` only when `allowOther`.
  `text` is within `maxLength`.
- `artifactRevision` is non-null exactly when the question has an `artifact`.
- `correlationId` equals `id` for a question and a notice.
