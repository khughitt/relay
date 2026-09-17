# Registry lock safety during extraction

Status: approved by the user on 2026-09-17; not implemented.
Task: `relay-06b1da`.
Parent design: ops `docs/specs/2026-09-16-relay-design.md`, approved after `d7e2c33`.
Scope: the registry lock's recovery behavior; all other approved contracts remain.

## Finding

Familiar's `src/bus/lock.js` is an extraction input. Its `isStaleText` first checks
the owner, then also declares a live owner's lock stale after `staleMs` (10 seconds
by default). A slow or suspended writer can therefore lose its lock while inside
the critical section. The finally block's token comparison prevents deletion of a
replacement lock; it cannot undo overlapping read/modify/write transactions.

The `.reclaim` guard has a related limitation: it is created empty and deleted by
age after five seconds. Age cannot distinguish a crashed reclaimer from a paused
one. Merely removing the main lock's live-owner expiry leaves this recovery path
using the same assumption.

Verified against familiar's lock implementation retained at `cb7aed4` (runtime
source unchanged from the approved design's `70ae8ed` baseline). An isolated
reproduction held the first callback open, advanced the contender's injected
clock eleven seconds, and observed two callbacks inside the critical section.
The reproduction used a temporary directory and changed no live state.

Run from familiar's checkout to reproduce against the existing implementation:

```sh
node --input-type=module <<'JS'
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withLock } from './src/bus/lock.js';
const root = await mkdtemp(join(tmpdir(), 'relay-lock-proof-'));
const lockPath = join(root, 'agents.lock');
let release, entered;
const held = new Promise(resolve => { release = resolve; });
const firstEntered = new Promise(resolve => { entered = resolve; });
let active = 0, maximum = 0;
const first = withLock(lockPath, async () => {
  maximum = Math.max(maximum, ++active);
  entered();
  await held;
  active--;
});
try {
  await firstEntered;
  await withLock(lockPath, async () => {
    maximum = Math.max(maximum, ++active);
    active--;
  }, { now: () => Date.now() + 11000, retries: 5, delayMs: 1 });
  console.log({ expectedMaximum: 1, observedMaximum: maximum });
} finally {
  release();
  await first;
  await rm(root, { recursive: true, force: true });
}
JS
```

Observed result: `{ expectedMaximum: 1, observedMaximum: 2 }`. The accelerated
clock is a deterministic age-policy test; it does not measure actual hook latency.

## Approved decision

Keep Node built-ins and familiar's atomic hard-link publication plus serialized
reclamation of a confirmed-dead writer. Remove time-based ownership revocation.
Choose explicit operator repair for an abandoned reclamation guard instead of
adding another automatic lock-recovery layer.

| Situation | Relay behavior |
| --- | --- |
| Main lock absent | Publish the complete owner token atomically and enter only after acquisition succeeds. |
| Main owner alive | Wait within the caller's monotonic acquisition deadline; never steal because of age. |
| Main owner unknown | Wait within the deadline, then report unavailable identity; never treat unknown as dead. |
| Main owner confirmed dead | Acquire the reclamation guard atomically, reread the current main token under that guard, and remove it only if its current owner is still confirmed dead. Then release the guard and compete for the main lock normally. |
| Reclamation guard owned by a live or unknown process | Wait within the deadline; do not delete it by age. |
| Reclamation guard owned by a confirmed-dead process | Return `LOCK_REPAIR_REQUIRED`; do not race other reclaimers to delete or replace it. |
| Malformed/empty main token or reclamation token | Return `LOCK_REPAIR_REQUIRED`; do not guess ownership. |
| Read, permission or filesystem error | Report the error; it is not evidence that a lock is free. |

The guard rules apply when a contender needs reclamation; acquiring an absent
main lock needs no reclamation. Both main and reclamation tokens carry a fresh per-acquisition nonce and the
approved process Handle of the **writer**, not the harness agent. Publish both
complete tokens using a private 0600 file plus an atomic hard link; there is no
empty-token publication interval. Establish the writer's qualified identity before
acquiring either lock; unavailable proof is an observation error. This uses the
existing Linux boot/start and Darwin epoch-second qualifications, without claiming
stronger Darwin precision than the approved Handle contract.

The release path verifies the entire ownership token before unlinking. A missing
main lock under the reclamation guard is already free: do not unlink a newly
acquired lock. If guard cleanup fails, report it; a completed snapshot publication
still occurred and must not be represented as rolled back. No subscriber runs
under either lock. The caller's deadline bounds waiting, not another live owner's
right to finish; an expired caller must not enter its callback.

This is an availability tradeoff. An ordinary writer crash remains automatically
recoverable. A crash while reclaiming can require operator intervention. Relay
must still run configured guards before this optional registry work: unavailable
registry locking cannot bypass a guard or replace an already determined denial.
Reconciliation can resume after repair. No extra repair CLI is proposed.

Repair is a bounded operator procedure prepared with the installer: stop relay
writers and prevent new hook invocations, verify quiescence outside all harnesses
using this registry, preserve the snapshot, and remove only the abandoned lock
and reclamation files. Never delete lock files while writers may be active. The
implementation plan will provide the exact paths and checks; the eventual cutover
runbook will include the procedure. Do not import familiar's old lock files.

## Alternatives

- Keep the current ten/five-second leases: rejected because live processes can
  outlast them and overlap; a larger timeout only changes when that happens.
- Add automatic recovery of the recovery guard: rejected for this extraction;
  a second check-then-unlink race does not establish exclusive ownership.
- Use a native advisory-lock dependency/helper: a possible future replacement if
  automatic recovery through every crash point becomes necessary. It changes the
  approved built-in-only runtime boundary and is unnecessary for this bounded
  first version. This addendum does not approve such a dependency.

## Acceptance and regression changes

The focused implementation plan must preserve existing ordinary contention,
dead-writer recovery, PID-reuse and real multiprocess lost-update coverage. Add
tests that hold a live writer/reclaimer beyond the old age limits, verify the
contender times out without entering, release the holder, and verify the next
caller succeeds. Include reboot and unreadable-owner evidence, atomic publication
of the guard token, cancellation before callback entry, and cleanup failure.

Two groups of existing familiar tests intentionally change: empty-token reclamation becomes
an explicit repair error, and automatic recovery of the five-second abandoned
reclaimer becomes an explicit repair error. Replace their expected behavior;
do not silently drop these cases while claiming all source behavior is preserved.
Kill a real child while it owns the main lock and verify automatic recovery; kill
it while owning the guard and verify the repair error without snapshot mutation.

This addendum is approved. The extraction implementation plan requires separate
user review before code changes. No familiar code, live lock files, hook settings
or registry snapshot has been changed by this investigation.
