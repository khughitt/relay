# Lock Reclamation Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a lock reclaimer from removing a lock that its dead owner released and a new writer took, and stop a released-and-exited guard holder from reading as an abandoned guard.

**Architecture:** Two edits to `withLock` in `src/bus/lock.js`, both the same pattern. After a dead verdict, reread the token and act only if it is identical to the one whose holder was probed. The reclamation path then unlinks only an unchanged main token, and the guard path raises `LOCK_REPAIR_REQUIRED` only for an unchanged guard token. Deterministic tests inject a `probe` that changes the lock files while it "runs", which reproduces the interleaving without timing.

**Tech Stack:** Node built-ins only (`node:test`, `node:fs`, `node:util`'s `isDeepStrictEqual`, already imported by `lock.js`).

**Spec:** `docs/specs/2026-09-25-lock-reclamation-order.md` (amends `docs/specs/2026-09-17-registry-lock-safety.md`).

## Global Constraints

- No new dependency; the runtime stays on Node built-ins.
- No new file operations on the uncontended acquire/release path.
- Owner and guard table outcomes and error codes are unchanged: `LOCK_TIMEOUT`, `LOCK_IDENTITY_UNKNOWN`, `LOCK_REPAIR_REQUIRED`, `IO_ERROR` keep their meanings.
- An unlink that finds no file after the unchanged-token check stays `IO_ERROR` (outside the protocol).
- Conventional commits, no AI attribution. Each task closes its step task (relay-11c1a5, relay-cc98a1) in its own commit; `tasks done relay-5e4d93` lands with Task 2. `just gate` passes before integration.

## Review Focus

1. A dead owner whose token is unchanged must still be reclaimed automatically. The existing test `dead and boot-mismatched main owners recover with eight nonoverlapping racers` pins this; it must pass unchanged.
2. A guard whose holder died while holding it must still require repair. The existing test `old live or unknown guard is never stolen; dead and malformed guards require repair` pins this; it must pass unchanged.
3. A guard released during the probe and immediately retaken by a live reclaimer must be waited on, not treated as abandoned. Task 2's test covers it as its `retaken` case.
4. A main lock changed after the guard is taken but before the reread (the existing `under guard reread leaves changed live owner alone and missing main is already free` test) must keep its outcomes.
5. A killed main owner and a killed guard holder across real processes (`test/lock-multiprocess.test.js`) keep recovery and repair respectively. The full suite covers this.

---

### Task 1: Reclaim only an unchanged main token

**Files:**
- Modify: `src/bus/lock.js` (the `try` block after the guard is acquired, currently `if (observe(current.holder) === 'dead') await io.unlink(lockPath);`)
- Test: `test/lock.test.js`

**Interfaces:**
- Consumes: `withLock(lockPath, fn, { clock, deadline, processOps, sleep, io })`. The test helpers already in `test/lock.test.js` are `ops()`, `token(holder)`, `writeToken(path, value)`, `fakeWait()` (clock starts at 0, deadline 50, `sleep` advances the clock) and `tempState(t)` (gives `lockPath`, `reclaimPath`).
- Produces: nothing new; behavior only.

- [ ] **Step 1: Write the failing test**

Add `import { unlinkSync, writeFileSync } from 'node:fs';` after the `node:fs/promises` import in `test/lock.test.js`. Then add this test after `under guard reread leaves changed live owner alone and missing main is already free`:

```js
test('a reclaimer never removes a lock its dead owner released during the probe', async t => {
  // relay-5e4d93: owner A releases and exits, and in one case writer C acquires, while contender
  // B probes A under the reclaim guard. Rereading before the probe made B unlink C's live lock
  // (two writers inside) or fail on the vanished file (IO_ERROR).
  for (const reacquired of [true, false]) {
    const p = await tempState(t), real = ops(), self = real.handleOf(process.pid);
    const A = token({ ...self, pid: 999991 }), C = token({ ...self, pid: 999992 });
    await writeToken(p.lockPath, A);
    let probesOfA = 0, entered = false;
    const probe = (h, o) => {
      if (h.pid === C.holder.pid) return { status: 'alive', reason: 'qualified process matches' };
      if (h.pid !== A.holder.pid) return real.probe(h, o);
      if (++probesOfA === 2) {
        // B's probe under the guard: A releases and exits; C may acquire.
        unlinkSync(p.lockPath);
        if (reacquired) writeFileSync(p.lockPath, JSON.stringify(C), { mode: 0o600 });
      }
      return { status: 'dead', reason: 'process absent' };
    };
    const attempt = withLock(p.lockPath, () => { entered = true; }, { ...fakeWait(), processOps: { ...real, probe } });
    if (reacquired) {
      await assert.rejects(attempt, { code: 'LOCK_TIMEOUT' });
      assert.equal(entered, false);
      assert.deepEqual(JSON.parse(await fs.readFile(p.lockPath)), C);
    } else {
      assert.equal((await attempt).cleanupError, null);
      assert.equal(entered, true);
      await assert.rejects(fs.stat(p.lockPath), { code: 'ENOENT' });
    }
    assert.equal(probesOfA, 2);
    await assert.rejects(fs.stat(p.reclaimPath), { code: 'ENOENT' });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern 'a reclaimer never removes' test/lock.test.js`
Expected: FAIL. In the `reacquired` case B unlinks C's token and enters, so `assert.rejects` sees a resolved promise ("Missing expected rejection"). Without C it would reject with `IO_ERROR`.

- [ ] **Step 3: Write the implementation**

In `src/bus/lock.js`, replace the reclamation `try` body:

```js
    try {
      const current = await readToken(lockPath,io);
      if (current) {
        if (observe(current.holder) === 'dead') await io.unlink(lockPath);
      }
    } catch (cause) { error = cause.code?.startsWith('LOCK_') ? cause : relayError('IO_ERROR','cannot reclaim lock',cause); }
```

with:

```js
    try {
      // Probe, then confirm the token is unchanged: its holder may have released it, and a new
      // writer taken the lock, while the probe ran. Once the holder is dead, only a guard holder
      // can change a file that still holds its token (docs/specs/2026-09-25-lock-reclamation-order.md).
      const current = await readToken(lockPath,io);
      if (current && observe(current.holder) === 'dead'
          && isDeepStrictEqual(await readToken(lockPath,io),current)) await io.unlink(lockPath);
    } catch (cause) { error = cause.code?.startsWith('LOCK_') ? cause : relayError('IO_ERROR','cannot reclaim lock',cause); }
```

- [ ] **Step 4: Run the lock tests to verify they pass**

Run: `node --test test/lock.test.js test/lock-multiprocess.test.js`
Expected: PASS, including the new test and the unchanged Review Focus tests 1, 4 and 5.

- [ ] **Step 5: Close the step and commit**

```bash
tasks done relay-11c1a5 "Reclamation probes, then rereads, and unlinks only an identical main token; deterministic test for both interleavings"
git add src/bus/lock.js test/lock.test.js tasks/relay-11c1a5.md
git commit -m "fix(lock): reclaim only a main token unchanged after its holder is confirmed dead"
```

### Task 2: Require repair only for an unchanged guard token; record the amendment

**Files:**
- Modify: `src/bus/lock.js` (the guard branch, currently `if (observe(current.holder) === 'dead') throw relayError('LOCK_REPAIR_REQUIRED', …)`)
- Modify: `docs/specs/2026-09-17-registry-lock-safety.md` (the "Main owner confirmed dead" and "Reclamation guard owned by a confirmed-dead process" rows)
- Modify: `docs/specs/2026-09-25-lock-reclamation-order.md` (status line)
- Test: `test/lock.test.js`

**Interfaces:**
- Consumes: Task 1's `unlinkSync`/`writeFileSync` import and the same helpers, plus `deadToken()` (a token for this process with its start time bumped, so the real probe says dead).
- Produces: nothing new; behavior only.

- [ ] **Step 1: Write the failing test**

Add after Task 1's test:

```js
test('a guard released during its holder probe is not an abandoned guard', async t => {
  // relay-5e4d93: reading the guard, then probing its holder dead, raised LOCK_REPAIR_REQUIRED
  // although the holder had released the guard and exited first. A guard retaken by a live
  // reclaimer meanwhile is waited on.
  for (const retaken of [false, true]) {
    const p = await tempState(t), real = ops(), self = real.handleOf(process.pid);
    const G = token({ ...self, pid: 999993 }), G2 = token({ ...self, pid: 999994 });
    await writeToken(p.lockPath, deadToken());
    await writeToken(p.reclaimPath, G);
    const probe = (h, o) => {
      if (h.pid === G2.holder.pid) return { status: 'alive', reason: 'qualified process matches' };
      if (h.pid !== G.holder.pid) return real.probe(h, o);
      // G releases the guard and exits while the contender probes it; another reclaimer may retake it.
      unlinkSync(p.reclaimPath);
      if (retaken) writeFileSync(p.reclaimPath, JSON.stringify(G2), { mode: 0o600 });
      return { status: 'dead', reason: 'process absent' };
    };
    const attempt = withLock(p.lockPath, () => 'entered', { ...fakeWait(), processOps: { ...real, probe } });
    if (retaken) {
      await assert.rejects(attempt, { code: 'LOCK_TIMEOUT' });
      assert.deepEqual(JSON.parse(await fs.readFile(p.reclaimPath)), G2);
    } else {
      assert.equal((await attempt).value, 'entered');
      await assert.rejects(fs.stat(p.reclaimPath), { code: 'ENOENT' });
    }
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern 'a guard released during its holder probe' test/lock.test.js`
Expected: FAIL. Both cases reject with `LOCK_REPAIR_REQUIRED`: `'abandoned reclaim guard; operator repair required'`.

- [ ] **Step 3: Write the implementation**

In `src/bus/lock.js`, replace:

```js
      if (observe(current.holder) === 'dead') throw relayError('LOCK_REPAIR_REQUIRED','abandoned reclaim guard; operator repair required');
      await pause(); continue;
```

with:

```js
      if (observe(current.holder) === 'dead') {
        // Only a holder that died holding the guard leaves its token behind; a changed or missing
        // token was released during the probe.
        if (isDeepStrictEqual(await readToken(guardPath,io),current)) throw relayError('LOCK_REPAIR_REQUIRED','abandoned reclaim guard; operator repair required');
        continue;
      }
      await pause(); continue;
```

- [ ] **Step 4: Run the lock tests to verify they pass**

Run: `node --test test/lock.test.js test/lock-multiprocess.test.js`
Expected: PASS, including Review Focus test 2 (a dead guard still requires repair) unchanged.

- [ ] **Step 5: Record the amendment in the specs**

In `docs/specs/2026-09-17-registry-lock-safety.md`, replace the row

```
| Main owner confirmed dead | Acquire the reclamation guard atomically, reread the current main token under that guard, and remove it only if its current owner is still confirmed dead. Then release the guard and compete for the main lock normally. |
```

with

```
| Main owner confirmed dead | Acquire the reclamation guard atomically, read the current main token under that guard, probe its owner, and remove it only if the owner is confirmed dead and a reread after the probe finds the identical token ([reclamation order](2026-09-25-lock-reclamation-order.md)). Then release the guard and compete for the main lock normally. |
```

and the row

```
| Reclamation guard owned by a confirmed-dead process | Return `LOCK_REPAIR_REQUIRED`; do not race other reclaimers to delete or replace it. |
```

with

```
| Reclamation guard owned by a confirmed-dead process | Return `LOCK_REPAIR_REQUIRED` if a reread after the probe finds the identical guard token; a changed or missing token was released, so compete again. Do not race other reclaimers to delete or replace it. |
```

In `docs/specs/2026-09-25-lock-reclamation-order.md`, replace the status line with:

```
Status: approved 2026-09-25, after correcting the zombie bullet to Linux only; implemented
in relay-5e4d93. The Mac load confirmation is part of relay-c19c0a's probe iteration.
```

- [ ] **Step 6: Run the gate**

Run: `just gate`
Expected: exit 0. The suite leaks one `test/fixtures/subscriber.js hang` process per run (relay-7c134c); kill the one from this worktree afterwards.

- [ ] **Step 7: Close the task and commit**

```bash
tasks done relay-cc98a1 "An abandoned-guard verdict needs an identical guard token after the probe; deterministic test; parent spec rows amended"
tasks done relay-5e4d93 "Reclamation probes, then rereads, and unlinks only an identical main token; an abandoned-guard verdict needs an identical guard token after the probe. Deterministic tests for both races; parent spec rows amended. Mac load confirmation rides relay-c19c0a's probe iteration."
git add src/bus/lock.js test/lock.test.js docs/specs/ tasks/relay-cc98a1.md tasks/relay-5e4d93.md
git commit -m "fix(lock): an abandoned-guard verdict requires an unchanged guard token"
```

## After the plan

The spec's Mac acceptance goes into the next Mac hand-off brief, not into this plan. The brief will ask for four parallel loops of the eight-writer test, 20 iterations each, with no failures, plus the CLI-test loop from relay-6e9410. The probe's D2 in relay-c19c0a remains the release proof.
