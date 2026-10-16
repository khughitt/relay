---
id: relay-8d8e86
title: "Detached ask: a question an agent posts on its own behalf, stored whatever the presence, taken by the asker"
status: todo
priority: 2
size: m
complexity: mid
process: planned
created: 2026-10-16T00:59:56Z
updated: 2026-10-16T01:26:58Z
depends: []
tags: [cross-project]
source: flows-912ac5
agent: claude-code/claude-fable-5-1
---

Piece of ops-cb50a8, needed by flows' typed gates (flows docs/specs/2026-10-15-typed-gates-design.md §9). The inbox refuses a question with native: null as UNSUPPORTED_ROUTE and the ask op requires a waiter; the flow skill posts gate questions itself, with no native call to return to and no process that waits. Wanted: (1) the ask op accepts waiter: null and handback: false for native: null (the store already accepts a null waiter and the restart recheck skips one); route maximum for expiry 7 days; presence does not pass a detached question through, here stores it like away; (2) a take op and relay inbox take <id> that moves an answered or undeliverable detached entry to consumed by a take cause, idempotent on a consumed entry, with consumed allowed without handedAt for a detached entry; handed and unconfirmed never occur for one; (3) relay inbox ask --file <question.json>; (4) relay inbox answer --surface <surface> (the CLI hardcodes cli; the socket keeps the body's surface, the HTTP guard's overwrite untouched); (5) asker loss does not withdraw a detached entry; (6) the entry history records STALE refusals and defers as for any entry. Retention unchanged: a terminal entry is pruned 30 days after its last change, so the takeable window is bounded. Spec section 9 of the flows design has the full list; read it before planning. Done: the ops above with lifecycle tests for every new transition, a socket and CLI test, and docs/api.md updated.

## Notes

- 2026-10-16T01:26:58Z (main): CLI shapes flows' flow-gate calls (flows docs/plans/2026-10-15-typed-gates.md, Global Constraints), every call with --json, success {"entry": …}, failure {"error": {"code", "message"}} and a non-zero exit: relay inbox ask --file <question.json>; relay inbox show <qid>; relay inbox answer <qid> decision=<option> reason=text:<text> --surface terminal; relay inbox withdraw <qid> --reason asker; relay inbox take <qid>. Codes flow-gate reads: NOT_FOUND, SERVE_UNAVAILABLE, ANSWERED, WITHDRAWN, EXPIRED, STALE. take moves answered or undeliverable to consumed (a take cause; consumed without handedAt for a detached entry) and returns a consumed entry unchanged.
