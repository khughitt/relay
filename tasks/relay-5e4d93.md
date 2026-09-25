---
id: relay-5e4d93
title: "Lock reclamation can delete a successor's live lock: a released-then-exited owner reads as dead"
status: todo
priority: 1
size: m
complexity: high
process: planned
created: 2026-09-25T20:04:03Z
updated: 2026-09-25T20:04:03Z
depends: []
tags: [lock]
source: relay-6e9410
agent: claude-code/claude-opus-5-5
---

Found by the Mac session for relay-6e9410 (docs/runbooks/darwin-mac-handback-2026-09-25.md, 'Cause B'), on every platform. withLock's reclaim path is check-then-unlink: under the reclaim guard it rereads the main token, probes its holder, then unlinks. The guard excludes other reclaimers but not the owner's own release() or a new acquire(). If owner A releases and exits between B's reread and B's probe, and C acquires meanwhile, B's probe says dead and B unlinks C's live lock: two writers inside (a lost counter update, 2 of 80 eight-worker runs under 4x load on the Mac). Without a new acquirer the unlink hits ENOENT: IO_ERROR 'cannot reclaim lock' (8 of 80). Darwin's ps-based probe (3-33 ms) widens a window Linux's /proc read keeps to microseconds. The report holds a deterministic repro (reclaim-race.mjs, injected processOps and io) that runs on Linux against main. The approved spec docs/specs/2026-09-17-registry-lock-safety.md ('Main owner confirmed dead') assumes a reread token whose holder is then confirmed dead cannot have been released in between; the fix changes the lock protocol (candidates: release takes the reclaim guard; rename-based take-over; native advisory lock, previously rejected), so it needs a spec addendum reviewed before implementation. Treating ENOENT as already free removes the IO_ERROR but not the lost update.
