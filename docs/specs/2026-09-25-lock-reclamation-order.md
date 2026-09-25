# Lock reclamation order

Status: approved 2026-09-25, after correcting the zombie bullet to Linux only.
Task: `relay-5e4d93`.
Amends: [Registry lock safety during extraction](2026-09-17-registry-lock-safety.md), the
"Main owner confirmed dead" and "Reclamation guard owned by a confirmed-dead process" rows.
Everything else in that spec stands.

## Finding

A Mac session reproduced two failures of the eight-writer lock test under load
([evidence](../runbooks/darwin-mac-handback-2026-09-25.md), "Cause B"). Over 80 runs at four
parallel loops it saw 8 `IO_ERROR: cannot reclaim lock` failures, the unlink finding no file.
It also saw 2 lost counter updates (`'23' !== '24'`), meaning two writers were inside the
lock at once. A deterministic script, using injected process and file operations, reproduces
both outcomes against main on Linux too.

The approved rule is: acquire the guard, reread the main token, and remove it only if its
owner is still confirmed dead. The code does this in the order reread, probe, unlink. That
order assumes the token read before the probe is still the file on disk after it. A normal
release breaks the assumption:

1. Contender B, holding the reclamation guard, rereads the main token: owner A.
2. A finishes its callback, releases (unlinks its own lock) and exits.
3. Writer C acquires, linking a fresh token at the main path.
4. B probes A: dead, correctly, since A has exited.
5. B unlinks the main path, which now holds C's token. B enters while C is still inside.

If step 3 has not happened yet, step 5 finds no file, which is the `IO_ERROR`. The guard
excludes other reclaimers but not an owner's release or a new acquisition. The window is the
probe. On Linux that is a `/proc` read of microseconds; on Darwin it spawns `ps` (3–33 ms),
long enough for a writer to release and exit. The bug exists on both platforms.

## Decision

Under the guard, probe first, then confirm the token is unchanged, then remove it:

1. Read the main token, T. If there is none, the lock is already free: remove nothing.
2. Probe T's holder. If it is alive or unknown, remove nothing and release the guard; the
   contender then waits as the owner table already says.
3. If it is dead, read the main token again. Remove the main lock only if that second read
   is identical to T, the same whole-token comparison release uses. Otherwise the owner
   released it, or a new writer acquired it, while the probe ran: remove nothing and compete
   again.

**Why step 3 closes the race.** T's nonce is unique to one acquisition, so a second read
equal to T means the file held T continuously. After a dead verdict, nothing can change
a file that holds T:
- its owner has exited, so it cannot release it;
- an acquirer's hard link fails because the path exists;
- another reclaimer must hold the guard, which B holds.

So the file B unlinks is the one whose owner it confirmed dead. Step 3 must come after the
probe returns. Moving the existing read later is the whole change.

A throwaway check on a scratch copy of main added step 3 as one line and reran the
deterministic script. The "reacquired" case then ends in `LOCK_TIMEOUT`, with the new
writer's token intact, and the "released" case enters normally.

**The guard gets the same order.** A contender that finds the guard held probes its holder.
Today a dead verdict returns `LOCK_REPAIR_REQUIRED` at once. But a reclaimer can release the
guard and exit between the contender's read and its probe. That is a false repair error:
nothing is deleted, but writers stop until an operator intervenes. After a dead verdict, the
contender rereads the guard token. The error is returned only if the token is unchanged, since
only a holder that died while holding the guard leaves its token behind. A missing or
different token means the guard was released, and the contender competes again.

Nothing else changes:
- no new file operations on the uncontended path;
- no new dependency;
- the owner and guard tables' outcomes and error codes;
- the repair procedure.

An unlink that finds no file in step 3 can only come from an actor outside the protocol,
such as an operator removing files during active writers. It stays `IO_ERROR`, as today.

## Assumption

Correctness rests on a dead verdict being true, which the process-handle contract already
requires of every reclamation. That contract judges a process dead when:
- it is absent;
- on Linux, it is a zombie (Darwin's probe reads no process state, so there a zombie whose
  start matches reads as alive until it is reaped: recovery waits longer, but the verdict
  is never falsely dead);
- its start time differs from the handle's (PID reuse);
- or, on Linux, the boot changed.

Darwin's start time has one-second precision, so a PID reused within the same second
reads as alive, never as dead. That errs toward waiting.

## Alternatives

- **Release takes the guard** (the Mac session's first option). It closes the race by
  stopping any removal of the main lock while a reclaimer holds the guard. Rejected: it adds
  guard file operations to every release. It also turns a writer killed mid-release into an
  abandoned guard needing operator repair, and the reordering closes the race without either
  cost.
- **Acquisition takes the guard.** The same costs, plus contention: every contended acquire
  would wait on the guard and probe its holder, a `ps` spawn on Darwin.
- **Treat a missing file at unlink as already free.** This removes the `IO_ERROR` but not the
  lost update, so it is not a fix on its own. The reordering makes that case impossible within
  the protocol.
- **Rename-based take-over** (move the main file aside, then inspect it). Rejected: if the
  moved file turns out to be a live owner's lock, there is no way to put it back without a
  moment when the path is empty and a third writer can acquire it.
- **A native advisory lock** (`flock`/`fcntl`). The kernel releases it on process death, so
  there would be no reclamation and no repair. It stays the future option the parent spec
  names. It is not needed to fix this race and would cross the built-in-only runtime
  boundary.

## Acceptance

- **Deterministic tests** (injected process and file operations, running on Linux):
  - **"Reacquired":** the owner releases and exits and a new writer acquires, both while the
    reclaimer's probe runs. The reclaimer must not remove the new lock or enter; the new
    writer's token must survive.
  - **"Released":** the same interleaving without the new writer. The reclaimer must not
    fail; it acquires normally.
  - **Guard:** a guard holder releases and exits during a contender's probe. The contender
    must not return `LOCK_REPAIR_REQUIRED`.
  - Each test fails on current main.
- **Existing coverage stays unchanged:** dead-owner recovery, the killed guard needing
  repair, and the empty-token repair cases.
- **On a Mac:** repeat the hand-back's load test, four parallel loops of the eight-writer test
  for 20 iterations each, with no failures (it was 10 of 80 before). The Darwin probe's D2
  release gate must pass.
