# Detached questions

Status: revision 2, draft for user review. Task: relay-8d8e86.

## Intent and inputs

An agent needs to ask a question, stop, and read the answer when it resumes.
Flows' human gates need this without a native tool call or a waiting process.
Store these questions in the existing inbox and acknowledge receipt with an
explicit `take`.

The requirements come from relay-8d8e86 and the flows repository at commit
`9d119d7182b568c7f4e80c9d3181f8e9a647fd26`:

- `docs/specs/2026-10-15-typed-gates-design.md`, sections 5, 7 and 9.
- `docs/plans/2026-10-15-typed-gates.md`, Global Constraints (the CLI calls).

Those documents are on flows' `feat/typed-gates` branch, in its
`.worktrees/typed-gates` workspace; they have not reached flows main.

## Scope and decisions

Extend the existing question lifecycle, socket operations, and inbox CLI.
A question is detached exactly when `question.body.native === null`.
Use that existing discriminator; add no mode field, separate queue, new message
kind, dependency, or root package export. The message schema already permits
`native: null`.

Detached questions have `route: {waiter: null, handback: false}`. They are saved
in both presence modes. Their answers retain the current expiry behavior and
can be consumed from either `answered` or `undeliverable`. This follows the
flows contract instead of exempting saved answers from expiry.

The agent still owns acting on an answer and checking its artifact revision
against the current file. Relay checks an answer against the question's immutable
revision; `take` acknowledges receipt and does not grant authority or inspect
repository files. Flows owns translating receipt into gate notes and decisions.

No HTTP ask/take endpoint, native harness connector, service deployment, hook
installation, phone UI change, or flows implementation is included.

## Socket and service contracts

Requests and responses retain the current newline-delimited socket envelopes.
Every changed entry uses the inbox's serialized queue, clock-before-mutation,
durable sequence allocation, persistence, and publication path.

### Ask

`{op: "ask", reqId, message, waiter: null, handback: false}` stores a detached
question and returns `{reqId, ok: true, entry}`. `message` is the complete existing
question envelope. Validate it with the existing message validator, then apply
the detached ask constraints in the service's serialized ask operation.

- Require `from.kind === "agent"` and `to.kind === "user"` for detached asks;
  otherwise return `INVALID_MESSAGE`. This is an agent asking the user, and
  gives `withdraw --reason asker` a defined sender. Other message kinds and
  native routes keep their current party validation.
- Require explicit null waiter and false handback for a detached ask. Missing
  values, a process handle, or true handback produce `INVALID_MESSAGE` before
  saving anything. Native asks continue to require a valid process handle and
  a boolean handback. Validate the route before an identical-message replay too.
- Before clamping or looking up a replay, refuse a detached question whose
  `createdAt > now + 1000` with `INVALID_MESSAGE`, where `now` is the service's
  clock sampled for this queued ask. Equality is allowed. This one-second
  allowance covers small clock differences; a timestamp in microseconds or
  far in the future cannot create an indefinitely pending entry. Do not change
  the submitted timestamp. This check applies only to detached asks and does
  not add a new load-time rule for durable entries.
- Maximum expiry is `createdAt + 7 * 24 * 60 * 60 * 1000` milliseconds. Keep a
  shorter caller deadline; clamp a longer one before idempotency comparison.
  This uses the same deterministic clamp as the native route. The Claude route
  retains its 23-hour maximum; unsupported native harnesses remain unsupported.
  The resulting deadline is at most seven days plus the one-second allowance
  from acceptance time. A later resend under a nondecreasing service clock still
  passes the timestamp check and clamps identically. If the wall clock moves
  backward beyond the allowance, a resend may be refused until it catches up;
  it does not mutate or delete the saved entry.
- `here` and `away` both save detached questions with inbox presentation. Native
  presence behavior continues through its existing path. A past-deadline detached
  question is created expired, as with a native question stored while away.
- An identical normalized/clamped question under the same id returns the existing
  entry without a new sequence. Different content under that id gets `ID_CONFLICT`.
  Existing supersession rules apply, including same-party ownership and refusing
  an answered predecessor. Detached questions may supersede pending questions
  under those existing rules; there is no new route-type restriction.
- A detached ask creates no waiter ownership record and subscribes to no state
  pushes. Closing its connection cannot call asker loss on its behalf. Clients
  can use the existing get/list/watch operations to observe it.
- Restart's waiter recheck already skips null waiters. Also make the shared
  asker-loss lifecycle operation a no-op for detached entries, so pending and
  answered entries survive any such invocation. Explicit withdrawal,
  supersession, and clock expiry still apply.

### Take

Add `{op: "take", reqId, id}` returning `{reqId, ok: true, entry}`. Validate `id`
as a message UUID at the socket boundary (`INVALID_MESSAGE` if malformed).
This operation applies only to detached questions:

| Entry before take | Result |
| --- | --- |
| Missing | `NOT_FOUND`. |
| Notice | `NOT_A_QUESTION`. |
| Native question, any state | `UNSUPPORTED_ROUTE`; no entry change. |
| Detached `pending` | `NOT_ANSWERED`; no entry change. |
| Detached `answered` | Move to `consumed`, retaining the answer. |
| Detached `undeliverable` | Move to `consumed`, retaining the answer. |
| Detached `consumed` | Return it unchanged, with the same sequence and timestamps. |
| Detached `withdrawn` / `expired` | `WITHDRAWN` / `EXPIRED`; no entry change. |

Clock application comes first: a pending question whose deadline has passed
becomes expired; an answered question becomes undeliverable and can then be
consumed in the same serialized operation. Each clock or take transition is
durable and visible to watchers. Concurrent takes serialize; only the first adds
a `take` row. A dropped success reply can be retried without another transition.

Use cause `take` for both new transitions. Keep `handedAt: null`, `observed: null`,
and empty native observations. Detached entries never enter `handed`,
`unconfirmed`, or `released`, and cannot be consumed through native confirmation.
The socket remains private to the host user: any same-user client can take by id,
as it can already answer or withdraw. This adds no claimed-agent authentication.

## Durable invariants and history

Keep entry schema 1 and its current fields. Update durable validation to accept
exactly the new histories and route combinations:

- A detached entry always has agent sender, user recipient, null waiter and
  false handback, and null `handedAt` and `observed`, with no native observations.
- A detached consumed entry has an answer and a `take` transition from `answered`
  or `undeliverable`. Reject a take transition on any native entry, from pending,
  or as a second consumed-to-consumed history row.
- Reject detached histories containing handoff, confirmation, confirmation
  timeout, native receipt, release, or asker-loss transitions. Keep all existing
  validation of native histories, including `handedAt` evidence for consumption.
- Existing accepted-message, answer, withdrawal, and supersession evidence checks
  remain in force. `take` is an operation and log cause, not a stored message.

Defer already logs `defer:<surface>` and retains its accepted message. Detached
defer leaves the entry pending with desktop presentation. An identical defer
message remains an idempotent replay.

Currently `STALE` is returned without any durable record. Add a
`refusal:STALE` log cause to the shared answer lifecycle, for native and detached
questions. After the existing state, value, and authorization checks find an
artifact revision mismatch, append a same-state pending row with the attempt's
service time and a new sequence, persist it, then return the existing `STALE`
error and expected revision. Keep `answer: null`; do not append the refused
message or its values to the accepted-message history. Validation permits this
cause only for pending artifact-bound questions. It does not require an accepted
message for a refusal row. Old entries without such rows stay valid.

Every request actually refused as stale adds one row, including an identical
retry; this counts refusal attempts rather than unique answers. Already-answered
replays and other refusal codes retain their current behavior. The current inbox
CLI always copies the stored question's revision, including for `flow-gate answer`,
so it cannot generate a revision mismatch. Among current client paths, HTTP
clients can submit a stale revision; direct socket clients can also send one.
The refusal row records no answer id, message id, surface, or rejected values;
obs cannot deduplicate retries or attribute a refusal to a surface from these
rows. Its measure must be refusal attempts, not distinct rejected answers.
A failed refusal
write follows the existing fail-stop `STORE_FAILED` path, rather than reporting
that an unrecorded refusal was saved. List/watch expose the new sequence while
the question remains pending, so obs can count it after restart.

Retention remains unchanged: terminal entries are eligible for pruning 30 days
after their last durable change, subject to existing supersession retention.
An answer becoming undeliverable starts that terminal retention period; taking
it restarts the period at consumption. Idempotent take does not extend it.
After pruning, take returns `NOT_FOUND`. Replay guarantees cover retained entries.

Older relay binaries reject the new take/refusal histories under strict entry
validation. Returning to one against this state store can quarantine those
entries; deployment must use a version that understands this lifecycle. No
compatibility layer or migration is part of this change.

## CLI contract

Add commands and options to the existing command declaration and parser:

| Command | Behavior |
| --- | --- |
| `relay inbox ask --file PATH` | Read one UTF-8 JSON question envelope, validate it, require `native: null`, send ask with null waiter and false handback, print the saved entry, then exit. No positional arguments or stdin mode. |
| `relay inbox take ID` | Send take and print the consumed entry. No wait loop or item arguments. |
| `relay inbox answer ID ITEM=VALUE... [--surface cli\|terminal]` | Use the declared local CLI surface; default remains `cli`. Applies to `--decline` too. `phone` and `desktop` are usage errors for this flag. |
| `relay inbox withdraw ID [--reason user\|asker]` | Default remains `user`; `asker` builds the withdrawal with the question's agent as sender and the user as recipient. |

File reads use Node built-ins. Malformed JSON, non-question envelopes, or native
questions supplied to inbox ask fail before connecting (`INVALID_MESSAGE` for
JSON/envelope errors; `UNSUPPORTED_ROUTE` for a valid native question). Missing
or unreadable files fail with their filesystem error code and a CLI-authored
message naming the file, for example `cannot read question file "missing.json"`.
Wrap the filesystem exception with that code and message; do not reuse Node's
code-prefixed message as the detail. The existing envelope then emits one prefix,
for example `ENOENT: cannot read question file "missing.json"`. Unknown options, invalid
enum values, missing required arguments, duplicates, or extra positional
arguments fail as usage errors before connecting, with exit 2. Service or
operation failures exit 1. Existing global `--json`/`--pretty` positioning applies.

Every successful new command prints `{entry: ...}` on stdout with `--json`.
Errors retain stderr `{error: {kind: "<cmd>_failed", detail: "<CODE>: <message>"}}`
and existing winning-entry details where present. No new envelope or error-code
alias is added. Pretty output uses existing human state labels.

The CLI exposes only `cli` and `terminal`, matching flows' distinction between
a desk command and a human answer relayed through a session. Surface remains a
declared origin on the trusted local socket, not authenticated proof; the socket
still accepts all four existing surfaces.
The HTTP guard continues to assign phone/desktop from the request path and
continues to enforce authorization answers as local-only. The new CLI flag does
not alter it. Defer keeps its current CLI surface.

The withdrawal option completes a call already named in the task's CLI note and
the flows plan. Use the corresponding user sender for reason `user`, preserving
today's default. The socket still permits only user and asker reasons.

## Change reach and verification

Implementation reaches the existing lifecycle and validator, route expiry
selection, inbox service, socket handler, CLI declarations/parser/desk code,
shared JSDoc contracts as needed, `tools/cli.toml` and its surface/enum checks,
affected fixtures and contract checks, `docs/api.md`, and
`docs/runbooks/inbox-service.md`. Update the runbook's presence explanation to
limit native passthrough to native questions, document detached questions being
saved in either mode, and add ask/take and the surface/reason options to its
desk commands. Inspect callers before changing these shared functions. The
packaged message schema needs no new field or kind; detached party restrictions
are ask/entry constraints, not a change to generic message validation.

Use the current lifecycle/store, inbox, socket, CLI, and HTTP test patterns:

1. Lifecycle tests cover answered and undeliverable take, consumed replay,
   pending and closed refusals, native/notice refusal, no-op detached asker loss,
   defer, withdrawal, expiry, supersession, and stale refusal history. Validate
   accepted durable histories and reject forged take, native receipt, route,
   and handedAt histories. Existing native tests must remain green.
2. Store/inbox tests reload taken and stale-refused entries, exercise expiry
   before take, concurrent take and answer behavior, deterministic seven-day
   clamp and resend, both presence modes, startup sweep, and retention/pruning.
   With a controlled clock, accept `createdAt === now + 1000`, reject
   `now + 1001` and a microsecond timestamp without storing an entry or allocating
   a sequence, and replay an accepted ask later with the original timestamp
   and sequence. Cover the stated clock-rollback refusal without entry mutation.
   A stale refusal must publish durably even though the request returns an error;
   fault injection must prove the existing fail-stop behavior still applies.
3. Socket tests post without a waiter, close the asking socket, restart with
   detached pending and answered entries, answer on another connection, take,
   and retry take. Check invalid route pairs and party direction before replay,
   reject user-originated and agent-addressed detached questions, and retain
   native party behavior. Check unsupported native
   routes, no waiter ownership/pushes, and watch visibility.
4. CLI tests drive the real executable and private test service through ask-file,
   show, answer with terminal surface, take twice, and withdraw with asker reason.
   Cover defaults, decline, files/JSON, a missing file with one error-code prefix
   and its filename, invalid args/enums (including phone/desktop surface refusal), unavailable service,
   and exact existing JSON success/error envelopes. Preserve the HTTP surface
   override and local-only authorization regression coverage.
5. Run the full-suite baseline during execution Setup before code changes.
   Follow `just test-one` for focused tests, `just test-fast` before commits,
   `just check`, and `just gate` before integration. Test Node 22 and the
   development runtime. New subprocess tests build their environment key by key
   with a test-owned HOME and fake credentials; reuse the isolated fixtures.

No live host service or installed launcher is changed for these checks. Flows'
real phone gate acceptance remains its own task after this relay change lands.

## Builder discretion

The controller chose the existing shared lifecycle, `refusal:STALE` log-only
evidence, the one-second future-clock allowance, explicit route/party validation,
the two CLI surfaces, the take refusal codes above, and inclusion of the
documented withdrawal option. These are implementation recommendations
for user review, not additional requirements claimed from the user.
The builder chooses helper placement and test grouping within existing modules.
There are no unresolved product decisions required to write the plan.

## Revision 2 review dispositions

Round 2 reviewed relay `feea755`: revise, Important 1 and Minor 5;
reviewer `claude-code/claude-opus-5-5`. All six findings are addressed in this
revision; none is deferred.

- Ruling: Important 1 accepted; add the service-time future-timestamp check with
  a one-second allowance, retaining the message-based clamp. Why: caller-authored
  future dates otherwise defeat the pending deadline. Cost: legitimate dates
  more than one second ahead, including after a clock rollback, are refused.
- Ruling: Minor 2 accepted; expose only `cli|terminal` on the CLI flag. Why:
  flows uses phone/desktop for its HTTP surface measure and needs only terminal
  as a new CLI value. Cost: users wishing to submit another declared surface
  must use the existing socket protocol.
- Ruling: Minor 3 accepted; require an agent sender and user recipient for
  detached asks. Why: that is the intended direction and gives asker withdrawal
  a defined sender. Cost: user-originated or agent-addressed detached questions
  are outside this route.
- Ruling: Minor 4 accepted with a source qualification; document HTTP and direct
  socket stale submissions, identical retries, and no deduplication evidence.
  Why: the CLI copies the immutable revision, but the socket also accepts
  caller-chosen revisions. Cost: obs measures attempts and cannot recover unique
  answers or surfaces from the log-only rows.
- Ruling: Minor 5 accepted; wrap file-read errors with the original code and a
  CLI-authored filename message. Why: the existing formatter already adds the
  code prefix. Cost: the user-facing message omits Node's raw diagnostic; the
  exception may remain its internal cause.
- Ruling: Minor 6 accepted; include the service runbook in implementation scope.
  Why: its unconditional native-passthrough statement and desk command list would
  become stale. Cost: another reference document must be kept consistent.
