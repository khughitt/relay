# Typed interaction messages: envelope, kinds, inbox and remote delivery

Status: draft for review (relay-f58531, under ops-cb50a8).

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
- The question lifecycle (§5), including the saved/consumed distinction.
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

Not yet known, and probed first by the plan (§12):

- **P1.** A hook that blocks for minutes and then exits 0 with no decision lets the
  native question appear and be answered in the terminal (the release route).
- **P2.** `PostToolUse` for `AskUserQuestion` carries the user's answers in
  `tool_response`.

The design names its fallback where it depends on these probes.

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
JSON Schema. Times are Unix milliseconds. Ids that relay assigns are UUIDs.

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
  reason: 'asker' | 'asker-gone' | 'superseded' | 'answered-elsewhere';
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
| `pending` | Waiting for an answer. Its `presentation` is `inbox` or `desktop` (after a defer). | no |
| `answered` | An answer is saved. The asker has not yet confirmed receipt. | no |
| `consumed` | The asker's route confirmed it handed the answer to the harness. | yes |
| `undeliverable` | An answer is saved, but the asker is gone and its route has no successor that could consume it. | yes |
| `released` | The route handed the question back to the harness's own UI (§8, §9.1). Relay no longer delivers it. | yes |
| `withdrawn` | Voided by the asker, by the asker's death, or by a superseding question. | yes |
| `expired` | `expiresAt` passed while pending. | yes |

Clients show `answered` as "answer saved" and `consumed` as "delivered to the
agent", and they show `undeliverable` with the saved answer and the reason. Every
transition is recorded with its time, the message that caused it and a
service-wide sequence number (§6).

### 5.2 Transitions

| From | Event | To | Response to the sender |
| --- | --- | --- | --- |
| — | question accepted | `pending` (inbox) | entry |
| `pending` | valid answer (first) | `answered` | entry |
| `pending` | defer | `pending` (desktop); route acts (§9) | entry |
| `pending` | withdrawal | `withdrawn` | entry |
| `pending` | clock reaches `expiresAt` | `expired`; route releases or reports | — |
| `answered` | route confirms delivery | `consumed` | — |
| `answered` | asker gone, no successor | `undeliverable` | — |
| `answered` | withdrawal by the asker | unchanged; the asker receives the saved answer | `ANSWERED` + answer |
| `answered`/`consumed` | answer with the same `answerId` | unchanged | entry (idempotent replay) |
| `answered`/`consumed`/`undeliverable` | answer with another `answerId` | unchanged | `ALREADY_ANSWERED` + the winning answer |
| `withdrawn`/`expired`/`released` | any answer | unchanged | `WITHDRAWN` / `EXPIRED` / `RELEASED` |
| any | answer with a non-matching `artifactRevision` | unchanged | `STALE` + the current revision |
| any | answer failing validation | unchanged | `INVALID_ANSWER` |

The checks run in this order: terminal state, idempotent replay, validation, revision.
So a retried answer is replayed even after the question's revision has been
superseded.

### 5.3 Ordinary cases

- **Phone and desktop both answer.** The service serializes every write, so the first
  answer saved wins and the second gets `ALREADY_ANSWERED`, and the client shows the
  winning answer with its surface and time.
- **Retry after a lost connection.** The client resends the same `answerId`. If the
  first attempt was saved, the reply is the saved entry. If it was not, this attempt
  is the first. A client keeps the `answerId` until it sees a terminal response.
- **The asker withdraws while an answer is in flight.** Whichever reaches the service
  first wins. A withdrawal that loses gets `ANSWERED` with the answer, and an answer
  that loses gets `WITHDRAWN`.
- **The session ends before delivery.** The answer stays saved. A route whose harness
  keeps the request alive (a Codex thread, an OpenCode session, a `-p` run that can be
  resumed) consumes it when it reconnects. On the Claude terminal route a dead hook
  has no successor, so the entry becomes `withdrawn (asker-gone)` while pending, or
  `undeliverable` once answered.
- **Expiry.** It is checked when the service starts, on a timer, and before every write.
  On a host that wakes from sleep, overdue questions expire before any queued answer
  is applied.

### 5.4 Expiry

`expiresAt` is required on every question. The Claude terminal route sets it to the
creation time plus 23 h. That falls within the hook's 24 h outer timeout, so relay
releases the question before Claude kills the hook. Askers that supply their own
expiry are clamped to the route's maximum.

### 5.5 Re-asks and stale answers

A question is identified by its relay id and keyed to `native.callId`, never matched
by its text. After a harness restart, a re-ask arrives under a new call id as a new
question, and the old entry has already been withdrawn because its asker is gone. A
late answer to the old id gets `WITHDRAWN`. When the asker knows a question replaces
an earlier one (the artifact changed, the plan moved on), it sets `supersedes`, and the
earlier entry is withdrawn with reason `superseded` in the same write.

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
  seq                  # last sequence number, decimal
  entries/<id>.json    # one entry per question or notice
```

An entry holds the original message, every later message on its correlation id, the
current state, `presentation`, the transition log and, for a waiter, the route's
recovery data (§9.1). Each write goes to a temporary file, which is fsynced and
renamed, and then the directory is fsynced. That is the registry's publication
discipline applied per entry. `seq` is written after the entry. On start, the
service sets `seq` to the maximum it finds in the entries, so a crash between the
two writes cannot reuse a number.

On start the service loads every non-terminal entry, expires any whose time has
passed, and checks each recorded waiter (§9.1). Terminal entries older than 30 days
are pruned at start and daily. An entry that fails validation is moved to
`inbox/rejected/` and reported, never loaded or deleted silently.

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
| `ask` | a question message | the entry, then later one `resolution` line when the entry leaves `pending` (§9.1) |
| `consumed` | `{ id }` after the route delivers | entry |
| `answer` / `defer` / `withdraw` | message | entry or error |
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
- **POST requests.** A POST needs an `Origin` equal to the matched origin and an
  `application/json` body under 64 KiB.

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
| `relay ask --harness claude-code` | The PreToolUse hook command for the question route (§9.1). |
| `relay inbox [--json] [list\|show <id>\|answer <id> ...\|defer <id>\|withdraw <id>]` | The minimal desktop surface. |
| `relay presence [here\|away]` | Read or set presence. |

`relay inbox` and `relay presence` talk to the socket and fail with `SERVE_UNAVAILABLE`
when the service is not running.

## 8. Presence routing

Presence is `here` or `away`. It is stored in `$STATE/presence.json`, changed only
through the service, and settable from any surface, the phone included.

- **`here`.** The question route passes the call through at once (§9.1): the native
  question appears as it does today, and no inbox entry is created.
- **`away`.** The question goes to the inbox. A defer sets `presentation: desktop`, and
  the route hands the question to the harness's own UI where it can (the Claude
  terminal route releases, §9.1). Otherwise it stays pending for desktop surfaces
  (`relay inbox`).

If the service is unreachable when the hook asks, the hook passes through to the
native question and prints `SERVE_UNAVAILABLE` on stderr. Passing through is the safe
direction: the question is shown where the user would see it anyway, and nothing is
answered for them. Automatic presence (idle detection, desktop lock) is out of v1.

## 9. Adapter routes

### 9.1 Claude Code, interactive terminal (v1)

`relay ask --harness claude-code` is a separate hook entry: PreToolUse, matcher
`AskUserQuestion`, timeout 86400 s. It is not part of `relay hook`'s dispatch,
whose budgets assume sub-minute work. The installer adds it as its own binding row,
behind a capability row recording `answer-hook-terminal` and P1. Installing it stays
the user's act, as for every live hook.

1. **Read the call.** The hook reads the native payload through the existing bounded
   reader and derives the agent id from `session_id`.
2. **Translate.** It turns `tool_input.questions` into a question. Each Claude question
   becomes an item: `question` becomes `prompt`, and `multiSelect` makes it `single` or
   `multi`. Item ids are `q1` to `q4` and option ids are `o1` to `o4`,
   in the asker's order, so they are stable for this immutable question. `header` and
   `description` are copied, `allowOther` is true and `recommended` is null.
   `native.callId` is the `tool_use_id`.
3. **Ask.** The hook sends `ask` on the socket and holds the connection. A `here`
   presence returns `passthrough` immediately.
4. **Resolve.**
   - **Answered.** The hook maps option ids back to labels and joins multi choices with
     `, `. An `other` value is passed as its text. It writes `allow` with `updatedInput`
     (the original `questions` plus `answers`), flushes stdout, sends `consumed` and
     exits 0.
   - **Declined.** The hook writes `allow` with an `answers` map in which each question
     maps to `(declined)` and adds `additionalContext` saying the user declined. The
     plan checks this rendering against P1/P2. The fallback is to release.
   - **Released.** Released means deferred, expired or `passthrough`. The hook exits 0
     with no output, so the native question appears (P1). If P1 fails, a defer on this
     route leaves the entry pending for `relay inbox`, and expiry withdraws it with no
     native fallback.
   - **Withdrawn.** A live hook sees this only when the entry is withdrawn by a
     superseding question or by `relay inbox withdraw`. The hook exits 0 with no
     output, as for a release.
5. **Detect a dead hook.** The hook's socket connection is the liveness signal. If it
   closes while the entry is pending, the entry becomes `withdrawn (asker-gone)`. If
   it closes while answered and not consumed, the entry becomes `undeliverable`. Esc and
   session close kill the hook (hq-d85ede), and both look like a closed connection.
   The entry also records the hook's process handle (relay's `Handle`). If the service
   restarts while a hook waits, the hook reconnects with the entry id and keeps
   waiting. A pending waiter that has not reconnected within 10 s of service start is
   probed with relay's liveness probe, and only a confirmed death withdraws it.
6. **Observe the native answer.** When P2 holds, the existing `relay hook` PostToolUse
   observer for `AskUserQuestion` closes a `released` entry's record with the native
   answer (`surface: terminal`), for the history only. It stays `released`.

A guard denial from the ordinary `relay hook` PreToolUse dispatch still wins by
Claude's precedence. If the guard denies after the ask hook has created an entry, the
ask hook is killed with the call, and step 5 withdraws the entry.

### 9.2 Claude Code, `claude -p` (specified, later)

The same translation, but the hook returns `defer` at once, and the entry records that
the run can be resumed. A launcher that owns the `-p` run resumes it once the entry is
`answered`, and the hook (now with the answer) returns `allow` with `updatedInput`. The
replayed `tool_use_id` matches the entry, and resume marks it `consumed`. A second
resume is refused by Claude.

### 9.3 Codex, app-server (specified, later)

A connector inside `relay serve` attaches to the shared app-server daemon. Each
`item/tool/requestUserInput` becomes a question keyed to `itemId` plus `turnId`.
An answer is sent as the request's response, and `serverRequest/resolved` with no
relay answer means `withdrawn (answered-elsewhere)`. On a daemon restart, pending entries
are withdrawn (`asker-gone`) and the recovery turn's re-ask is a new question. Codex
options carry no ids, so they are assigned as for Claude, and `isOther` maps to
`allowOther`. The async tool has no withdrawal (hq-5e63d9): its question becomes an
entry whose answer is delivered as a new turn, and the entry is `consumed` when that
turn starts.

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
`answer-hook-terminal` (Claude, referencing hq-d85ede), P1 `answer-release-native`, and
P2 `answer-native-observed`. The installer refuses the `relay ask` binding unless the
rows its route needs are `probed` and true for the installed version, as it does for
existing bindings. hq's consolidated view takes relay's rows by reference (ops split
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
1. Probes P1 and P2 run on the installed Claude Code first, and their results are
   recorded as evidence rows. Where they fail, the plan follows the named fallbacks
   before any route code.
2. Schemas and validators, with fixture tests for every kind and every rejection.
3. The store and lifecycle as a pure state machine, tested for every transition in
   §5.2 and for crash recovery (a write interrupted between the entry and `seq`).
4. `relay serve` with the socket and the waiter liveness, tested with real processes
   and sockets, including a hook killed mid-wait and a service restart under a waiting
   hook.
5. The HTTP surface and guard, tested for every proxied and local case of §7.3 and for
   SSE resume.
6. `relay ask` translation both ways and its installer binding, behind the capability
   rows.
7. End to end on the host with the user present: one real Claude Code
   `AskUserQuestion` while `away`, answered once from another tailnet device through
   the HTTP API, and once deferred to the native terminal question.

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
    "withdrawal": { "type": "object", "required": ["reason"], "properties": { "reason": { "enum": ["asker", "asker-gone", "superseded", "answered-elsewhere"] } } },
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
