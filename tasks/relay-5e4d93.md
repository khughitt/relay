---
id: relay-5e4d93
title: "Lock reclamation can delete a successor's live lock: a released-then-exited owner reads as dead"
status: doing
priority: 1
size: m
complexity: high
process: planned
owner: relay-5e4d93
created: 2026-09-25T20:04:03Z
updated: 2026-09-25T21:21:21Z
started: 2026-09-25T21:02:11Z
depends: []
tags: [lock]
source: relay-6e9410
agent: claude-code/claude-opus-5-5
spec: docs/specs/2026-09-25-lock-reclamation-order.md
plan: docs/plans/2026-09-25-lock-reclamation-order.md
---

Found by the Mac session for relay-6e9410 (docs/runbooks/darwin-mac-handback-2026-09-25.md, 'Cause B'), on every platform. withLock's reclaim path is check-then-unlink: under the reclaim guard it rereads the main token, probes its holder, then unlinks. The guard excludes other reclaimers but not the owner's own release() or a new acquire(). If owner A releases and exits between B's reread and B's probe, and C acquires meanwhile, B's probe says dead and B unlinks C's live lock: two writers inside (a lost counter update, 2 of 80 eight-worker runs under 4x load on the Mac). Without a new acquirer the unlink hits ENOENT: IO_ERROR 'cannot reclaim lock' (8 of 80). Darwin's ps-based probe (3-33 ms) widens a window Linux's /proc read keeps to microseconds. The report holds a deterministic repro (reclaim-race.mjs, injected processOps and io) that runs on Linux against main. The approved spec docs/specs/2026-09-17-registry-lock-safety.md ('Main owner confirmed dead') assumes a reread token whose holder is then confirmed dead cannot have been released in between; the fix changes the lock protocol (candidates: release takes the reclaim guard; rename-based take-over; native advisory lock, previously rejected), so it needs a spec addendum reviewed before implementation. Treating ENOENT as already free removes the IO_ERROR but not the lost update.

## Notes

- 2026-09-25T21:02:11Z (main): started
  provenance: {"harness_session":"claude-code:e2e5c9ac-0117-427a-bf31-489aecc94355","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T21:05:36Z (relay-5e4d93): Spec addendum drafted (docs/specs/2026-09-25-lock-reclamation-order.md): under the guard, probe then reread and unlink only an identical token; same recheck before declaring an abandoned guard. Mac repro reproduces on Linux against main; a throwaway reorder on a scratch copy fixes both variants. Awaiting user review.
- 2026-09-25T21:05:42Z (relay-5e4d93): parked (waiting on user, review): User reviews docs/specs/2026-09-25-lock-reclamation-order.md in .worktrees/relay-5e4d93; on approval the agent writes the implementation plan (writing-plans), then implements
  provenance: {"harness_session":"claude-code:e2e5c9ac-0117-427a-bf31-489aecc94355","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T21:10:02Z (relay-5e4d93): resumed
  provenance: {"harness_session":"claude-code:e2e5c9ac-0117-427a-bf31-489aecc94355","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T21:10:02Z (relay-5e4d93): Spec approved by the user after correcting the zombie bullet to Linux only (Darwin's probe reads no process state). Next: implementation plan for review.
- 2026-09-25T21:12:30Z (relay-5e4d93): parked (waiting on user, review): User reviews docs/plans/2026-09-25-lock-reclamation-order.md in .worktrees/relay-5e4d93 and picks the execution method; then the agent executes Task 1 (relay-11c1a5) and Task 2 (relay-cc98a1)
  provenance: {"harness_session":"claude-code:e2e5c9ac-0117-427a-bf31-489aecc94355","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T21:21:21Z (relay-5e4d93): resumed
  provenance: {"harness_session":"claude-code:e2e5c9ac-0117-427a-bf31-489aecc94355","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
