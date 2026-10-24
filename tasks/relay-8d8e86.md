---
id: relay-8d8e86
title: "Detached ask: a question an agent posts on its own behalf, stored whatever the presence, taken by the asker"
status: doing
priority: 2
size: m
complexity: mid
process: planned
owner: feat/detached-ask
created: 2026-10-16T00:59:56Z
updated: 2026-10-24T15:05:54Z
started: 2026-10-24T13:58:59Z
depends: []
tags: [cross-project]
source: flows-912ac5
agent: claude-code/claude-fable-5-1
spec: docs/specs/2026-10-24-detached-ask-design.md
plan: docs/plans/2026-10-24-detached-ask.md
---

Piece of ops-cb50a8, needed by flows' typed gates (flows docs/specs/2026-10-15-typed-gates-design.md §9). The inbox refuses a question with native: null as UNSUPPORTED_ROUTE and the ask op requires a waiter; the flow skill posts gate questions itself, with no native call to return to and no process that waits. Wanted: (1) the ask op accepts waiter: null and handback: false for native: null (the store already accepts a null waiter and the restart recheck skips one); route maximum for expiry 7 days; presence does not pass a detached question through, here stores it like away; (2) a take op and relay inbox take <id> that moves an answered or undeliverable detached entry to consumed by a take cause, idempotent on a consumed entry, with consumed allowed without handedAt for a detached entry; handed and unconfirmed never occur for one; (3) relay inbox ask --file <question.json>; (4) relay inbox answer --surface <surface> (the CLI hardcodes cli; the socket keeps the body's surface, the HTTP guard's overwrite untouched); (5) asker loss does not withdraw a detached entry; (6) the entry history records STALE refusals and defers as for any entry. Retention unchanged: a terminal entry is pruned 30 days after its last change, so the takeable window is bounded. Spec section 9 of the flows design has the full list; read it before planning. Done: the ops above with lifecycle tests for every new transition, a socket and CLI test, and docs/api.md updated.

## Notes

- 2026-10-16T01:26:58Z (main): CLI shapes flows' flow-gate calls (flows docs/plans/2026-10-15-typed-gates.md, Global Constraints), every call with --json, success {"entry": …}, failure {"error": {"code", "message"}} and a non-zero exit: relay inbox ask --file <question.json>; relay inbox show <qid>; relay inbox answer <qid> decision=<option> reason=text:<text> --surface terminal; relay inbox withdraw <qid> --reason asker; relay inbox take <qid>. Codes flow-gate reads: NOT_FOUND, SERVE_UNAVAILABLE, ANSWERED, WITHDRAWN, EXPIRED, STALE. take moves answered or undeliverable to consumed (a take cause; consumed without handedAt for a detached entry) and returns a consumed entry unchanged.
- 2026-10-16T01:38:52Z (main): Correction to the CLI note above: flow-gate reads relay's existing --json failure envelope as it is, on stderr, {"error": {"kind": "<cmd>_failed", "detail": "<CODE>: <message>"}}, taking the code from the detail's head; no change to the envelope is asked for. It also treats ALREADY_ANSWERED like ANSWERED.
- 2026-10-24T13:58:59Z (main): started
  provenance: {"harness_session":"codex:01a16e34-23e9-7383-a3ce-8a9e9991a96a","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-24T13:59:12Z (feat/detached-ask): resumed
  provenance: {"harness_session":"codex:01a16e34-23e9-7383-a3ce-8a9e9991a96a","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-24T14:02:38Z (feat/detached-ask): Planning in .worktrees/detached-ask (feat/detached-ask); just setup succeeded. Full-suite baseline deferred to execution Setup as required for planned work. Required flows spec found on feat/typed-gates at 9d119d7182b568c7f4e80c9d3181f8e9a647fd26, docs/specs/2026-10-15-typed-gates-design.md section 9; its plan Global Constraints also requires withdraw --reason asker. Existing applyAnswer returns STALE without persistence; design will specify refusal history explicitly.
- 2026-10-24T14:05:07Z (feat/detached-ask): review: spec round 1 — verdict: accept; findings: none; reviewer: codex/gpt-6.1-sol
- 2026-10-24T14:05:09Z (feat/detached-ask): attached: builder-check-report.md (631 bytes): Full read-only builder check: spec feea755 accepted with no material questions; reviewer codex/gpt-6.1-sol
- 2026-10-24T14:05:11Z (feat/detached-ask): parked (waiting on user, review): User: review docs/specs/2026-10-24-detached-ask-design.md at relay commit feea75566eb471a4c8affcf5c25e9c044805a728 in .worktrees/detached-ask. After approval, agent drafts and reviews the implementation plan; implementation baseline has not run and must precede code changes.
  provenance: {"harness_session":"codex:01a16e34-23e9-7383-a3ce-8a9e9991a96a","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-24T14:27:47Z (feat/detached-ask): resumed
  provenance: {"harness_session":"codex:01a16e34-23e9-7383-a3ce-8a9e9991a96a","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-24T14:27:50Z (feat/detached-ask): review: spec round 2 — verdict: revise; findings: Important 1, Minor 5; reviewer: claude-code/claude-opus-5-5
- 2026-10-24T14:30:30Z (feat/detached-ask): attached: spec-round-2-report.md (5229 bytes): Full spec round 2 review against feea755: revise, Important 1 and Minor 5; reviewer claude-code/claude-opus-5-5
- 2026-10-24T14:30:33Z (feat/detached-ask): Spec revision 2 frozen at 94555165894c8bb47d314020aa1296b3895911fe, docs/specs/2026-10-24-detached-ask-design.md. Important 1 and Minors 2-6 addressed with Ruling/Why/Cost entries in the spec. Minor 4 qualified: direct socket clients also submit stale revisions; identical retries count attempts without deduplication or surface attribution. No findings deferred. just check and git diff --check passed; scoped fresh builder re-review dispatched.
- 2026-10-24T14:31:52Z (feat/detached-ask): review: spec round 3 — verdict: accept; findings: none; reviewer: codex/gpt-6.1-sol
- 2026-10-24T14:31:57Z (feat/detached-ask): attached: spec-round-3-report.md (1760 bytes): Full scoped spec re-review against 9455516: accept, no findings; all six round-2 findings resolved; reviewer codex/gpt-6.1-sol
- 2026-10-24T14:31:59Z (feat/detached-ask): parked (waiting on user, review): User: approve revised spec at relay commit 94555165894c8bb47d314020aa1296b3895911fe, .worktrees/detached-ask/docs/specs/2026-10-24-detached-ask-design.md. All round-2 findings addressed; scoped round 3 accepted with no findings. After approval, agent drafts the implementation plan for review. Full-suite baseline remains deferred to execution Setup before code changes.
  provenance: {"harness_session":"codex:01a16e34-23e9-7383-a3ce-8a9e9991a96a","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-24T14:42:02Z (feat/detached-ask): resumed
  provenance: {"harness_session":"codex:01a16e34-23e9-7383-a3ce-8a9e9991a96a","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-24T14:42:05Z (feat/detached-ask): review: spec round 4 — verdict: accept; findings: Minor 1; reviewer: human
- 2026-10-24T14:42:07Z (feat/detached-ask): User approved relay spec 94555165894c8bb47d314020aa1296b3895911fe for planning. Nonblocking Minor: a detached question file with wrong sender/recipient reaches service validation (one connection), whereas a native question file is refused by the CLI before connecting. Record this boundary in the plan; no spec revision required.
- 2026-10-24T14:53:14Z (feat/detached-ask): review: plan round 1 — verdict: accept; findings: none; reviewer: codex/gpt-6.1-sol
- 2026-10-24T14:53:16Z (feat/detached-ask): attached: plan-round-1-report.md (3802 bytes): Plan self-review at d9a405d: accept, no findings; spec coverage, interfaces, five failure cases and validation-boundary nit checked; reviewer codex/gpt-6.1-sol
- 2026-10-24T14:53:18Z (feat/detached-ask): parked (waiting on user, review): User: review and approve frozen relay plan d9a405dde5cda86bdcc01f2ab2d5ea42f354357a at .worktrees/detached-ask/docs/plans/2026-10-24-detached-ask.md. Spec 9455516 is approved. Plan self-review round 1 accepted with no findings; inline execution is the recommended default. After approval agent re-enters worktree Setup, runs just test baseline and records count, unblocks relay-1aee2b/relay-420059/relay-83f587, then implements them in dependency order. No code or runtime tests changed yet.
  provenance: {"harness_session":"codex:01a16e34-23e9-7383-a3ce-8a9e9991a96a","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-24T15:05:54Z (feat/detached-ask): resumed
  provenance: {"harness_session":"codex:01a16e34-23e9-7383-a3ce-8a9e9991a96a","harness_session_source":"CODEX_THREAD_ID"}
