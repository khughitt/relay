---
id: relay-22e22b
title: "Inbox service gaps from the typed-messages review: expiry clamp, stuck answered entries, notify id conflicts, silent cursor fallbacks, UUID case, ancestor sync"
status: todo
priority: 2
size: m
complexity: mid
process: direct
created: 2026-10-13T18:15:49Z
updated: 2026-10-13T18:15:49Z
depends: []
tags: []
source: "review:89cdecb"
agent: claude-code/claude-opus-5-5
---

Why: the post-merge review of 89cdecb (2026-10-13) found these gaps in the inbox service. Each one was checked against the code.

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
