---
id: relay-22e22b
title: "Inbox service gaps from the typed-messages review: expiry clamp, stuck answered entries, notify id conflicts, silent cursor fallbacks, UUID case, ancestor sync"
status: doing
priority: 2
size: m
complexity: mid
process: direct
owner: fix/typed-messages-review
created: 2026-10-13T18:15:49Z
updated: 2026-10-13T20:02:34Z
started: 2026-10-13T18:30:55Z
depends: []
tags: []
source: "review:bc4ef2f"
agent: claude-code/claude-opus-5-5
---

Why: the post-merge review of bc4ef2f (2026-10-13) found these gaps in the inbox service. Each one was checked against the code.

1. **Expiry is not clamped** (spec §5.4: "Askers that supply their own expiry are clamped to the route's maximum"). Socket `ask` stores any `expiresAt` (src/serve/inbox.js:51-58), and nothing in src/ clamps it. A socket asker with a far-future expiry never expires, outlives the hook's 24 h outer timeout, and ends `asker-gone`. Clamp at `ask` to createdAt plus the route maximum (23 h for claude-code, src/routes/claude-code.js:4).
2. **`answered` has no deadline.** `nextDeadline` returns null for it (src/interaction/lifecycle.js), and the waiter liveness probe runs once, reattachMs after start (src/serve/socket.js:148-169). The service can restart while an entry is answered, with the hook alive at the recheck but still in reconnect backoff. If the hook then dies before reconnecting (Esc), or the probe returns unknown, the entry stays `answered` forever: never undeliverable, never pruned, always listed. Proposed: an `answered` entry with no accepted waiter becomes `undeliverable` at question.expiresAt. Amend the spec §5.2 table with that row.
3. **`notify` hides an id collision.** It returns any existing entry with the same id as success, even a question or a different notice (src/serve/inbox.js:82-85), while `ask` returns ID_CONFLICT. Return ID_CONFLICT unless the existing entry is the identical notice.
4. **Cursors fall back silently.**
   - SSE `Last-Event-ID`/`since` falls back to 0 on bad input (src/serve/http.js:66), which replays the whole retained history.
   - Socket `watch` coerces a bad `since` to 0 (src/serve/socket.js:101).
   - Socket `list` passes `since`/`states` through unchecked (src/serve/socket.js:86): `since:null` returns every terminal entry, and `states:"answered"` does a substring match.

   Refuse these with INVALID_INPUT, as GET /v1/inbox does (src/serve/http.js:95).
5. **UUID case.** Ids are validated case-insensitively (src/interaction/message.js:13) but compared case-sensitively and stored as `<id>.json`. On a case-insensitive filesystem (the macOS default), two ids that differ only in case overwrite each other's file. Normalize to lowercase at validation, or refuse uppercase. Either way, record the choice and update the schema description.
6. **Startup fails on locked ancestors.** Startup opens every ancestor of RELAY_STATE_DIR up to / with `open(dir, 'r')` in order to fsync it (src/interaction/store.js:15,43-49). An ancestor owned by another user with mode 0711 fails with EACCES, and `relay serve` refuses to start. Relay cannot have created an ancestor it does not own, so sync only the ancestors owned by the current uid. Make that an explicit rule, not error swallowing (refines ruling F35).

Done:
- Each item has a test that fails first.
- Spec §5.2/§5.4 are amended for items 1 and 2, and docs/api.md for items 3 and 4.
- `just test-fast` passes on Node 22 and the dev runtime.

Where: src/serve/inbox.js, src/serve/socket.js, src/serve/http.js, src/interaction/lifecycle.js, src/interaction/message.js, src/interaction/store.js, docs/specs/2026-10-11-typed-interaction-messages.md, docs/api.md.

## Notes

- 2026-10-13T18:16:26Z (main): concerns: relay-f58531 defect — spec §5.4 expiry clamp unimplemented plus inbox lifecycle and validation gaps
- 2026-10-13T18:30:55Z (main): started
  provenance: {"harness_session":"claude-code:cee0471d-7415-41b5-933e-f3803576f4bb","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-13T18:31:24Z (fix/typed-messages-review): resumed
  provenance: {"harness_session":"claude-code:cee0471d-7415-41b5-933e-f3803576f4bb","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-13T18:50:54Z (fix/typed-messages-review): uuid case: refuse uppercase with INVALID_MESSAGE (not normalize), for every interaction UUID field (id, correlationId, supersedes, answerId); normalizing would change the sender's id and break resent-message identity. One lowercase rule (message.js isUuid) now backs validateMessage and validateEntry; schema uuid def gains the same pattern.
- 2026-10-13T18:52:53Z (fix/typed-messages-review): stuck answered: an answered entry becomes undeliverable at question.expiresAt with cause 'expiry' (not a new cause), mirroring how 'asker-gone' already names one event across pending->withdrawn and answered->undeliverable; validateEntry's expiry rule now accepts answered->undeliverable at or after expiresAt. The CLI's undeliverable label shows 'reason: expiry'. ask.js already passes an undeliverable state through to the native UI (UNEXPECTED_STATE).
- 2026-10-13T18:54:37Z (fix/typed-messages-review): expiry clamp: clamp (not refuse) in inbox.ask to message.createdAt + route maximum, before the entry exists; reattach compares the stored question with the resend after the same clamp. Anchor is createdAt, not operation time: the clamp is then a pure function of the message (identical resend always compares equal), it equals the Claude route's own createdAt+23h so route questions are never altered, and it bounds the wait from when the asker began, which is what the hook's 24 h outer timeout measures (a now-anchor would let a question first accepted after the hook's reconnect backoff outlive the hook). Caveat: a future createdAt would stretch the bound; the socket is same-user (0600) and createdAt comes from the same host clock. Two far-future resends that clamp to the same value compare equal (the raw expiry is not stored).
- 2026-10-13T18:54:38Z (fix/typed-messages-review): expiry clamp, other routes: a question with no v1 route (native null, or native.harness codex/opencode) is refused at ask with UNSUPPORTED_ROUTE before any entry exists, rather than given Claude's 23 h. Rationale: v1 defines a maximum only for claude-code; applying it to other harnesses would be a silent fallback, and routes/index.js expectAnswers already refuses the same questions with UNSUPPORTED_ROUTE at confirm. expectAnswers and the new expiryLimit share one route lookup. No v1 producer sends such questions.
- 2026-10-13T19:00:03Z (fix/typed-messages-review): cursors: validation lives in the inbox's snapshot and watch (INVALID_INPUT), so every socket caller gets it; socket watch maps only an absent since to 0 (null is refused). list states accept an array (empty allowed) of QUESTION_STATES plus notice states active/expired. HTTP /v1/events and /v1/inbox share one parser that keeps /v1/inbox's existing numeric rule (Number(), safe integer, >= 0), so both HTTP cursors behave alike; Last-Event-ID wins over ?since= as before and is validated before any stream headers.
- 2026-10-13T19:03:05Z (fix/typed-messages-review): ancestor sync: rule implemented is 'sync an ancestor iff its child on the chain is owned by the current uid AND the ancestor is writable by that uid (stat mode bits: owner/group/other, root always), plus always the state dir and inbox root'; nothing is caught. This refines the brief's 'sync only owned ancestors' because the link of a relay-created dir lives in its PARENT: owned-only would leave unsynced a dir relay creates inside another user's writable dir (sticky /tmp-style, group-shared), breaking F35; child-owned alone would still open root's 0711 /home. Uses io.stat (follows symlinks, like open). Known limit: ACL-only write grants are judged by mode bits. If owned-only is preferred, it is a one-line filter change plus dropping the foreign-writable guard test.
- 2026-10-13T20:02:34Z (fix/typed-messages-review): review: impl round 1 — verdict: revise; findings: Important 1, Minor 3; reviewer: claude-code
