# Interaction Messages, Inbox Service, and Question Routes

Type: protocol, data model; document types 1.

`relay serve` maintains a durable interaction inbox under `$STATE/inbox/`, exposed over a private Unix domain socket (`$STATE/serve.sock`), the CLI (`relay ask`, `relay inbox`, `relay presence`), and an optional guarded loopback/Tailscale HTTP surface. No root package export is added for interaction modules; the packaged JSON Schema is `schemas/interaction/message.schema.json` and the shipped operator runbook is [`inbox-service.md`](runbooks/inbox-service.md). See [api.md](api.md) for CLI summaries and error codes.

## Messages and entries

Times are Unix milliseconds; message IDs and `answerId` are sender-generated lowercase UUIDs (uppercase UUID text fails with `INVALID_MESSAGE`). `Harness` in native question metadata is `'claude-code' | 'codex' | 'opencode'`.

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

type QuestionBody = {
  class: 'clarification' | 'artifact-review' | 'authorization';
  expiresAt: number;
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

type QuestionState = 'pending' | 'answered' | 'handed' | 'consumed' | 'unconfirmed'
  | 'undeliverable' | 'released' | 'withdrawn' | 'expired';
type EntryState = QuestionState | 'active';
type EntryFrame = {
  schema: 1;
  id: string;
  seq: number; // positive, durable service-wide sequence; gaps are allowed
  updatedAt: number;
  log: { seq: number; at: number; state: EntryState; cause: string }[];
};
type QuestionEntry = EntryFrame & {
  kind: 'question';
  question: Message;
  state: QuestionState;
  presentation: 'inbox' | 'desktop';
  route: { handback: boolean; waiter: Handle | null };
  answer: Message | null;
  handedAt: number | null;
  observed: Record<string, string> | { answers: Record<string, { answers: string[] }> } | null;
  withdrawal: WithdrawalBody | null;
  supersededBy: string | null;
  messages: { at: number; message: Message }[];
  observations: { at: number; surface: 'terminal'; answers: Record<string, string> | { answers: Record<string, { answers: string[] }> } }[];
};
type NoticeEntry = EntryFrame & {
  kind: 'notice';
  notice: Message;
  state: 'active' | 'expired';
  seen: boolean;
};
type Entry = QuestionEntry | NoticeEntry;
type Presence = { mode: 'here' | 'away'; updatedAt: number };
```

Questions contain 1–4 items; `single` and `multi` items have 2–4 options. Item IDs and option IDs are unique within their containers, and answers use option IDs rather than labels or positions. Unknown optional message fields are ignored, whereas unknown durable entry fields on disk are rejected. An `'answered'` outcome supplies every item; `'declined'` supplies `{}`. An `'authorization'` answer is local-only (`LOCAL_ONLY` over proxied HTTP), and even a saved answer grants no authority; a remote client may decline or defer. Raw harness payloads, transcripts, and environment values are never persisted.

## Lifecycle

| State | Meaning / human `--pretty` label |
| --- | --- |
| `pending` | Waiting, presented in the inbox or on the desktop. |
| `answered` | `answer saved` |
| `handed` | `handed to the agent` |
| `consumed` | `the agent received it` |
| `unconfirmed` | `handed, receipt not confirmed` |
| `undeliverable` | Saved answer shown with its recorded reason. |
| `released` | Returned to the harness's native question UI. |
| `withdrawn` | Voided by withdrawal, asker loss, or supersession. |
| `expired` | Deadline passed while `pending`. |

Only `consumed` means confirmed receipt. A valid first answer moves `pending -> answered`; the recorded waiter moves `answered -> handed` before writing the harness reply. A matching native confirmation moves `handed` or `unconfirmed -> consumed`; a mismatching confirmation or 60 s without confirmation after handoff yields `unconfirmed` (a late matching confirmation still moves `unconfirmed -> consumed`).

Detached questions (`native: null`, `from: { kind: 'agent', ... }`, `to: { kind: 'user' }`, `route: { waiter: null, handback: false }`) are stored in both `here` and `away` presence modes and survive connection close and asker loss. `take` moves a detached `answered` or `undeliverable` entry to `consumed` with cause `'take'`; a repeated `take` returns the `consumed` entry unchanged. Pending `take` fails with `NOT_ANSWERED`, closed `take` fails with `WITHDRAWN` or `EXPIRED`, and taking a native question fails with `UNSUPPORTED_ROUTE`.

`defer` releases a handback route (`pending -> released`); otherwise it leaves `pending` with `presentation: 'desktop'`. Asker loss or reaching `expiresAt` while an answer is saved (`state: 'answered'`) transitions to `undeliverable`. A retry with the saved `answerId` returns the entry in every answer-holding state; a competing answer or defer fails with `ALREADY_ANSWERED` (returning the winning entry), and withdrawal after answer fails with `ANSWERED`. An `artifactRevision` mismatch logs a `refusal:STALE` attempt row before returning `STALE` with the expected revision.

`relay serve` is the sole inbox writer (`src/interaction/store.js`). Startup `fsync`s `$STATE`, `$STATE/inbox`, and writable same-uid ancestors, allocates monotonic sequence numbers in `inbox/seq` before publishing entries, prunes terminal entries older than 30 days at startup and daily (measured from `updatedAt`; taking an `undeliverable` answer restarts its 30-day window), and quarantines invalid durable entries in `inbox/rejected/`.

## Local socket protocol

`$STATE/serve.sock` (`src/serve/socket.js`) is privately owned with mode `0600`. Its path must fit the platform's `sun_path` less a terminating NUL (107 UTF-8 bytes on Linux, 103 on Darwin): serve refuses a longer one with `INVALID_CONFIG` before taking its lock or opening the inbox, and clients before connecting (`src/serve/socket-path.js`). Linux itself accepts a 108-byte path; relay reserves the NUL so one rule holds on both platforms, and past the full `sun_path` Node either fails with a bare `EINVAL` or, on Node 22, silently truncates the path to another file. On any other platform the check refuses with `INVALID_CONFIG`. Each newline-delimited JSON request is `{reqId, op, ...fields}` (capped at 1 MiB in UTF-8 bytes per line); responses are `{reqId, ok: true, ...result}` or `{reqId, ok: false, error: {code, message}, entry?, ...detail}`.

| `op` | Fields | Result / pushes / errors |
| --- | --- | --- |
| `ask` | `message` (question), `waiter` (`Handle \| null`), `handback` (`boolean`) | Detached asks require `waiter: null` and `handback: false`, always return `entry`, and create no waiter subscription. Native asks return `passthrough: true` while `here`, or `entry` with later `{type: "state", entry}` pushes. Expiry is clamped to `createdAt + 7d` (detached) or `createdAt + 23h` (Claude Code). Identical resends with the same waiter return the saved entry; a resend of an existing native question whose `waiter` handle does not match the recorded waiter fails with `NOT_WAITER`, and reusing an existing entry ID with different question content fails with `ID_CONFLICT`. |
| `handed` | `id`, `waiter` (`Handle`) | `entry`; only the recorded waiter may take the answer (`NOT_WAITER` otherwise); replay is idempotent. |
| `take` | `id` (question UUID) | `entry`; consumes a detached `answered` or `undeliverable` question, or returns its `consumed` entry unchanged. |
| `confirm` | `harness`, `callId`, `observed` (native answers map) | `entry`. |
| `answer` / `defer` / `withdraw` | `message` of the matching kind | `entry`; socket withdrawal permits only `'user'` and `'asker'` reasons. |
| `notify` | `message` (notice) | `entry`; identical resend returns the saved notice, and any different content under that ID fails with `ID_CONFLICT`. |
| `list` | optional `since` and `states` | `{seq, entries}`: nonterminal entries plus terminal entries changed after `since`, filtered by `states`. |
| `get` | `id` | `entry`, including terminal entries (`NOT_FOUND` if absent). |
| `presence.get` / `presence.set` | none / `mode` (`'here' \| 'away'`) | `presence`. |
| `watch` | optional `since` (default `0`) | Replays `{type: "entry", entry}` changes after `since`, subscribes atomically, returns `{seq}`, and streams live `entry` and `presence` pushes. |

Restart grants recorded waiters 10 s to reattach before confirmed-dead waiter sweeps withdraw pending questions or mark saved answers `undeliverable`. Detached `ask` messages validate party direction, route, and `createdAt <= serviceNow + 1000` (`INVALID_MESSAGE` otherwise) before replay lookup.

## HTTP protocol and guard

HTTP (`src/serve/http.js`) is off unless `RELAY_HTTP_PORT` (`1..65535`) is set, and always binds IPv4 loopback (`127.0.0.1`). `RELAY_SERVE_HOST` and `RELAY_SERVE_LOGIN` must be set together and require `RELAY_HTTP_PORT`; `RELAY_CLIENT_DIR`, if set, must be an absolute path and also requires `RELAY_HTTP_PORT`.

Every path, including static assets, is guarded:

- Any header starting with `X-Forwarded-`, `Tailscale-User-Login`, or `Tailscale-Funnel-Request` marks the request as proxied. Proxied requests require `Tailscale-User-Login` and `Host` to match `RELAY_SERVE_LOGIN` and `RELAY_SERVE_HOST` exactly, and must not carry `Tailscale-Funnel-Request`.
- Unproxied requests must have a loopback `Host` (`127.0.0.1`, `localhost`, or `[::1]`) on `RELAY_HTTP_PORT`.
- Guard failure returns `403 FORBIDDEN`.
- Every `POST` and `PUT` requires `Content-Type: application/json`, a body of at most 64 KiB (`413 TOO_LARGE` if exceeded, `415 UNSUPPORTED_MEDIA` if non-JSON), and an exact `Origin`: `https://<RELAY_SERVE_HOST>` for proxied traffic or `http://<Host>` for loopback traffic.
- The server assigns `surface: 'phone'` to proxied answer/defer requests and `surface: 'desktop'` to local loopback requests, overriding client-supplied surface values.

| Method and path | Request / response |
| --- | --- |
| `GET /v1/inbox?since=<seq>` | `{seq, entries}`; `since` must be plain decimal digits (`400 INVALID_INPUT` otherwise). |
| `GET /v1/inbox/<id>` | `{entry}`, including terminal entries (`404 NOT_FOUND` if absent). |
| `POST /v1/inbox/<id>/answer` | `AnswerBody` -> `200 {entry}`, or `409 {error: {code, message}, entry}` plus winning `answer` or expected `revision`. |
| `POST /v1/inbox/<id>/defer` | `DeferBody` -> `200 {entry}`, or `409 {error: {code, message}, entry}`. |
| `GET /v1/events` | SSE stream; `entry` events carry full entries with `id: <seq>` (resumed via `Last-Event-ID` or `?since=`, defaulting to `0`), and `presence` events carry no `id`. |
| `GET /v1/presence` | `{presence}`. |
| `PUT /v1/presence` | `{mode: "here" \| "away"}` -> `{presence}`. |
| `GET /v1/agents` | `{agents: [{id, harness, project, state}]}` for display. |
| `GET /...` | Read-only static files from `RELAY_CLIENT_DIR` when configured. |

## Claude Code question route

`relay ask --harness claude-code [--handback] PreToolUse|PostToolUse` (`src/routes/claude-code.js`) bridges Claude Code `AskUserQuestion` tool calls to `relay serve`:

- **Exit codes:** `relay ask` exits `0` on all runtime failures (stdout is the hook reply; runtime errors emit a `relay:` diagnostic on stderr and pass through with empty stdout so the native terminal UI handles the question) and exits `2` on argv usage errors.
- **`PreToolUse` reply encoding:**
  - When an answer is delivered (`outcome: 'answered'`), `allowReply` returns `hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { questions, answers } }`, where `updatedInput.answers` maps each question's prompt text to the selected option label(s) or free text.
  - When declined (`outcome: 'declined'`), `allowReply` returns `permissionDecision: "allow"` with `updatedInput: { questions, answers: {} }` and `additionalContext: "The user declined to answer AskUserQuestion in the relay inbox."`
  - When released via `--handback` (`state: 'released'`) or passed through while `presence` is `'here'`, `relay ask` exits `0` with empty stdout.
  - When withdrawn, expired, or `undeliverable` without `--handback`, `denyReply` returns `permissionDecision: "deny"` with a `permissionDecisionReason` explaining that the question closed in the relay inbox and the agent should not retry or wait.
- **`PostToolUse` receipt confirmation:** Reads `tool_response.answers` (or `tool_input.answers`) and sends `confirm` to `relay serve`.
- **Duplicate question text refusal:** Because Claude Code keys `tool_input.answers` and `tool_response.answers` by prompt text (`question`), an `AskUserQuestion` call carrying duplicate `question` text within the same form fails `toQuestion` with `INVALID_INPUT` (`AskUserQuestion carries duplicate question text`), logs a diagnostic on stderr, and passes through to the native terminal UI even while presence is `'away'`.
- **Capability gate:** `docs/evidence/claude-code-answer-routes.json` records the five passing capability rows (`terminal-answer`, `deny-stops`, `receipt`, `release`, `under-denial`) for Claude Code `2.1.296`, and user-present tailnet acceptance passed phone answer, phone defer, and desk withdrawal with this version. Installing the route via `relay install --harness claude-code ... --with ask` requires this evidence file (see [`inbox-service.md`](runbooks/inbox-service.md#installing-the-question-route); for re-probing an upgraded version, see `docs/runbooks/answer-route-probes.md` in the repository).

## Codex question route

`relay serve` includes an opt-in, exact-version (`0.166.0`) Codex `app-server` connector (`src/routes/codex.js`, `src/serve/codex/*.js`) for `item/tool/requestUserInput` calls:

- **Activation and admission:** Off unless all four environment variables are set: `RELAY_CODEX_BIN`, `RELAY_CODEX_HOME`, `RELAY_CODEX_SOCKET`, and `RELAY_CODEX_EVIDENCE` (pointing to `docs/evidence/codex-question-0.166.0.json`). Startup verifies the binary version (`0.166.0`) and evidence record (`CODEX_DISABLED` diagnostic when disabled or mismatched).
- **Thread join and projection:** Joins admitted `Active` threads holding `WaitingOnUserInput` flags and maps `requestUserInput` questions into the inbox while presence is `'away'`. Public responses project a connector-owned Codex entry's route to `{ handback: true, waiter: null }` and omit private rollout paths, terminal proof, and connector generation metadata.
- **Observation and confirmation shape:** Codex's native answer map preserves full string arrays (`{ answers: Record<string, { answers: string[] }> }`, including empty arrays) in `observed` and `observations[].answers`, never flattened into Claude Code's string map. Moving `handed -> consumed` requires both the exact-call answer map and the observed protocol turn end. For re-probing Codex versions, see `docs/runbooks/codex-question-reproof.md` in the repository.

## Failure modes

For `relay ask`, an `undeliverable` entry (including one replayed on waiter reattach) or a `handed` refusal with `UNDELIVERABLE` follows expiry handling: with `--handback`, `relay ask` exits `0` with empty stdout to release to the terminal UI; without `--handback`, it returns a `deny` hook reply so the agent does not wait.

| Codes | Meaning |
| --- | --- |
| `ALREADY_ANSWERED`, `ANSWERED` | A saved answer won; it is retained on `error.entry` / HTTP `409`. |
| `WITHDRAWN`, `EXPIRED`, `RELEASED`, `UNDELIVERABLE` | The requested lifecycle action cannot run in that terminal state. |
| `STALE`, `INVALID_ANSWER`, `LOCAL_ONLY` | Artifact revision mismatch (`refusal:STALE` logged), invalid item values, or remote authorization answer. |
| `NOT_WAITER`, `NOT_ANSWERED`, `NOT_HANDED`, `NOT_SUPERSEDABLE` | Waiter handle mismatch on `ask`/`handed`, pending `take`, or transition precondition failure. |
| `ID_CONFLICT`, `NOT_FOUND`, `NOT_A_QUESTION` | Conflicting message content for an existing ID, missing entry/call, or wrong entry kind. |
| `INVALID_MESSAGE`, `INVALID_INPUT`, `INVALID_REQUEST`, `UNKNOWN_OP` | Invalid message schema/party/timestamp, duplicate `AskUserQuestion` prompt text, invalid cursor/presence, or malformed socket frame. |
| `SERVE_RUNNING`, `SERVE_UNAVAILABLE`, `STORE_FAILED` | Existing live `relay serve`, unavailable `$STATE/serve.sock`, or failed durable write requiring restart. |
| `INVALID_CONFIG`, `INVALID_ENTRY`, `HARNESS_UNAVAILABLE`, `UNSUPPORTED_ROUTE`, `UNEXPECTED_STATE` | Invalid serve configuration, corrupt durable entry, failed harness probe, or unsupported route/state. |
| `FORBIDDEN`, `UNSUPPORTED_MEDIA`, `TOO_LARGE`, `INTERNAL`, `UNAVAILABLE` | HTTP guard rejection (`403`), non-JSON mutation (`415`), body > 64 KiB (`413`), internal fault (`500`), or shutdown (`503`). |
