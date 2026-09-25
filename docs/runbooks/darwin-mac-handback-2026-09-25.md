# relay — Mac hand-back report

Host: macOS 26.7 (build 25G229), arm64, node v25.8.2 (nvm), Apple clang 21, python3 3.14.7 (Homebrew).
Base: bundle `relay-0d56e30.bundle`, main at `0d56e30`. `main` is untouched.

| Task | Branch | Result |
| --- | --- | --- |
| relay-7eef39 | none (empty) | Confirmed: `executableOf` returns `/private/tmp/r7/claude/versions/9.9.9`. Nothing to fix. |
| relay-6e9410 | none (empty) | **Blocked on a lock-semantics decision.** Two root causes found, both reproduced. Both fixes change lock semantics, so per the brief I stopped. |
| relay-661946 | `mac/relay-661946` @ `e58f01a` | Fixed and tested. Verified with `env -i` under launchd's PATH. |

Bundle: `~/Downloads/relay-mac.bundle` (created and verified; it holds only `mac/relay-661946`, because the other two branches were never created, having no commits).

```
~/Downloads/relay-mac.bundle is okay
The bundle contains this ref:
e58f01a6133025415292ce0d7970110155ccb062 refs/heads/mac/relay-661946
The bundle requires this ref:
0d56e304c5f4e96df6c89af16b8ebd64166a0ddc
```

---

## Baseline: `npm test` on main (0d56e30)

`npm ci`, then `npm test`, run twice. Both runs: **330 tests, 323 pass, 7 fail**, the same 7 each time.
None of the 7 is the task-2 failure. The task-2 tests passed both times; the failure is intermittent (see below).

```
✖ SIGINT after a normal D0 packs results, fills D0, and leaves no grandchild          (darwin-probe-orchestrator.test.js:31)
✖ python3 older than 3.11, or none, stops the probe with one line (exit 2)             (darwin-probe-orchestrator.test.js:101)
✖ closing the terminal (/bin/sh) still packs the results and leaves no child           (darwin-probe-orchestrator.test.js:133)
✖ closing the terminal (/bin/dash) still packs the results and leaves no child         (darwin-probe-orchestrator.test.js:133)
✖ a constructed codex parent publishes its own qualified handle and stays alive        (darwin-probe-runtime.test.js:81)
✖ a constructed parent that exits fails its wait at once                               (darwin-probe-runtime.test.js:141)
✖ D8 reap keeps exactly the live half of its own fleet                                 (darwin-probe-stages-c.test.js:34)
```

All 7 are in the `test/darwin-probe-*` suites, and they fail only because this run is on a real Mac. I did not fix them; they are outside the three tasks. Raw evidence:

- **D8** (`127 !== 2` on `o.hook_path.exit`): this is relay-661946 itself. It passes on `mac/relay-661946`.
- **python3 < 3.11**: the test sets `PATH` to a directory holding only a fake `python3`. On Darwin the probe first runs `xcode-select -p`, which is then not on PATH, so it dies earlier with a different message:
  ```
  + 'the Xcode Command Line Tools are required: run xcode-select --install\n'
  - 'python3 >= 3.11 is required (found Python 3.9.6); install one, e.g. brew install python\n'
  ```
  (`xcode-select -p` on this host prints `/Applications/Xcode.app/Contents/Developer`, exit 0.) The test's assumption breaks on Darwin; on Linux the check is skipped.
- **constructed codex parent**: the test asserts `ps -o comm=` is `codex`. Darwin's `comm` is argv[0], here the full path:
  ```
  + '/var/folders/…/T/dp-SU5Hqo/p/codex'
  - 'codex'
  ```
  This is the same argv[0] fact behind relay-7eef39, applied to the test's own premise.
- **constructed parent that exits**: a timing bound of `< 2000` ms; observed `3163ms`, `3505ms` and `3249ms` across three suite runs.
- **closing the terminal (/bin/sh, /bin/dash)**: `AssertionError: no results tarball after the hangup` after about 60 s. The exit-129 assertion before it passed. Not investigated further.
- **SIGINT after a normal D0**: `ENOENT … x/stages/D0.json`. It fails only under full-suite load: run alone it passed 5 of 5 on main and 5 of 5 on the branch.

Each `npm test` run leaked exactly one `test/fixtures/subscriber.js hang` process; I killed each one after its run.

---

## Task 1: relay-7eef39 (verify only). Confirmed, no commit.

The node binary was copied to `/tmp/r7/claude/versions/9.9.9`, spawned with `spawn(path, ['-e', 'setTimeout(()=>{},60000)'], { argv0: '9.9.9' })`, read, then killed (SIGKILL; `kill(pid, 0)` afterwards → ESRCH). `/tmp/r7` was removed afterwards. Raw output:

```
pid 48635
--- lsof -w -a -p 48635 -d txt -Fn
p48635
ftxt
n/private/tmp/r7/claude/versions/9.9.9
ftxt
n/usr/lib/dyld
--- ps -o comm= / args=
9.9.9
9.9.9 -e setTimeout(()=>{},60000)
executableOf: "/private/tmp/r7/claude/versions/9.9.9"
argvOf: ["9.9.9","-e","setTimeout(()=>{},60000)"]
killed: ESRCH
```

This lsof prints an `ftxt` line before each `n` line, and `parseDarwinExecutable` handles that form.

As an extra check of the "executable is listed first" assumption, I used a process with many non-shared-cache text mappings: Homebrew `python3 -c 'import time,ssl; time.sleep(5)'`. The executable was still first, ahead of dyld, the `lib-dynload` `.so` files and the openssl dylibs, even though those are not in load order:

```
p48662
ftxt
n/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python
ftxt
n/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/lib/python3.14/lib-dynload/_struct.cpython-314-darwin.so
ftxt
n/…/lib-dynload/_ssl.cpython-314-darwin.so
ftxt
n/…/lib-dynload/binascii.cpython-314-darwin.so
ftxt
n/usr/lib/dyld
ftxt
n/…/lib-dynload/_socket.cpython-314-darwin.so
ftxt
n/…/Python.framework/Versions/3.14/Python
ftxt
n/opt/homebrew/Cellar/openssl@3/3.6.4/lib/libssl.3.dylib
ftxt
n/opt/homebrew/Cellar/openssl@3/3.6.4/lib/libcrypto.3.dylib
```

(`/opt/homebrew/bin/python3` is a launcher that execs `Python.app/.../Python`, so that is the true executable.)

**Branch `mac/relay-7eef39`: empty (not created).** The result was as expected, so there was nothing to fix.

---

## Task 2: relay-6e9410. Blocked: root causes found, fix needs a lock-semantics decision

**Branch `mac/relay-6e9410`: empty (not created).** The brief says to stop and report if the right fix changes lock semantics. Both defects below need exactly such a change: one in what counts as an *unknown* owner (or the deadline budget), the other in the reclamation protocol. So I have not chosen a fix.

`ps` itself never failed or ran slowly. Across every trace, the only `ps` failures were calls whose timeout had been cut to a few ms by the caller's deadline, plus `ps -p` exit 1 for owners that had already exited (handled correctly as `dead`).

### Reproduction counts (unmodified main, 0d56e30)

| Loop | Result |
| --- | --- |
| `node --test --test-name-pattern 'the CLI returns inside the outer timeout' test/cli.test.js` ×30, idle | **9 fail / 21 pass**; all 9: `'registry: LOCK_IDENTITY_UNKNOWN: lock owner identity unavailable\n'` |
| same, ×20, instrumented (below) | 6 fail / 14 pass |
| same, ×30, with the eight-worker test looping beside it | 1 fail / 29 pass (LOCK_IDENTITY_UNKNOWN) |
| `…'eight real processes'… test/lock-multiprocess.test.js` ×30, idle | 30 pass |
| same, ×21, beside the CLI loop | 21 pass |
| same, 3 loops in parallel ×15 | 44 pass, 1 fail: `{"type":"error","code":"IO_ERROR"}` |
| same, 4 loops in parallel ×20 | **70 pass, 10 fail**: 8× `{"type":"error","code":"IO_ERROR"}`, **2× `'23' !== '24'` (lost counter update)** |

### Instrumentation used (uncommitted; removed afterwards)

Every `runDarwinTool` spawn, every lock probe verdict, every guard probe, and the reason at the deadline were appended as JSON lines to `$RELAY_TRACE`. The lock worker was also made to write the full error with its cause. (`took` is only meaningful when `budget < 2000`.)

```diff
--- a/src/bus/proc.js   (in runDarwinTool, before the failure check)
+  if (process.env.RELAY_TRACE) { const fsx = process.getBuiltinModule('node:fs'); fsx.appendFileSync(process.env.RELAY_TRACE, JSON.stringify({ pid: process.pid, tool, args: args.join(' '), budget: Math.floor(remaining), took: Math.round(clock() - (deadline - remaining)), status: result.status, signal: result.signal, error: result.error?.code, stderr: result.stderr?.slice(0, 200) }) + '\n'); }
--- a/src/bus/lock.js
+    if (clock() >= deadline && process.env.RELAY_TRACE) …appendFileSync(…, JSON.stringify({ pid, expired: unknown ? 'LOCK_IDENTITY_UNKNOWN' : 'LOCK_TIMEOUT', over: Math.round(clock() - deadline) }))   (in expired())
+    if (process.env.RELAY_TRACE) …appendFileSync(…, JSON.stringify({ pid, lockProbe: status, left: Math.round(deadline - clock()) }))                                          (after the main-owner probe)
+      if (process.env.RELAY_TRACE) …appendFileSync(…, JSON.stringify({ pid, guardProbe: guardStatus, guardHolder: current.holder.pid, guardFileNow: existsSync(guardPath), left })) (after the guard probe)
--- a/test/fixtures/lock-worker.js
+  } catch(error) { if(process.env.RELAY_TRACE) …appendFileSync(…, JSON.stringify({pid, workerError: error.code, message, cause: {code, message, syscall, path, cause}, stack})) …
```

### Cause A: the CLI test (`LOCK_IDENTITY_UNKNOWN` instead of `LOCK_TIMEOUT`)

**Mechanism.** In `withLock`, each loop pass probes the live owner and then sleeps `min(20, deadline - clock())`. `runDarwinTool` sets the `ps` timeout to `min(2000, deadline - clock())`. So the last probe before the deadline gets whatever budget is left, uniformly 0–20+ ms. `ps -p` normally takes 3–6 ms (p50 3 ms, p90 6 ms, max 33 ms over 306 calls). When fewer than about 5 ms remain, `spawnSync` kills `ps` with `SIGKILL`/`ETIMEDOUT`. The chain from there:

1. `runDarwinTool` throws `PROCESS_UNAVAILABLE`, not `DEADLINE_EXCEEDED`. Its `DEADLINE_EXCEEDED` path only fires when `remaining <= 0` *before* spawning.
2. `darwinRow` sees `kill(pid, 0)` succeed (the owner is alive) and rethrows `PROCESS_UNAVAILABLE`.
3. `probe` turns every exception into `unknown` ("process unreadable"). Even a `DEADLINE_EXCEEDED` would become `unknown` there.
4. `withLock` sets `unknown = true`, and the next `expired()` throws `LOCK_IDENTITY_UNKNOWN`.

This matches the observed rate: roughly the fraction of the 20 ms pause window that is under 5 ms, about 25–30% (9/30). Linux reads `/proc` with no subprocess timeout, so it cannot hit this path.

**Raw trace, failing run 1** (last 8 lines; the owner was `alive` on every earlier probe):

```
{"pid":55931,"lockProbe":"alive","left":85}
{"pid":55931,"tool":"/bin/ps","args":"-p 55928 -o pid=,ppid=,tty=,lstart=,comm=","budget":61,"took":5,"status":0,"signal":null,"stderr":""}
{"pid":55931,"lockProbe":"alive","left":56}
{"pid":55931,"tool":"/bin/ps","args":"-p 55928 -o pid=,ppid=,tty=,lstart=,comm=","budget":32,"took":6,"status":0,"signal":null,"stderr":""}
{"pid":55931,"lockProbe":"alive","left":26}
{"pid":55931,"tool":"/bin/ps","args":"-p 55928 -o pid=,ppid=,tty=,lstart=,comm=","budget":3,"took":4,"status":null,"signal":"SIGKILL","error":"ETIMEDOUT","stderr":""}
{"pid":55931,"lockProbe":"unknown","left":-1}
{"pid":55931,"expired":"LOCK_IDENTITY_UNKNOWN","over":1}
```

The same pattern appears in all 6 instrumented failures, with the final `ps` budget at 3, 5, 3, 3, 5 and 2 ms:

```
{"pid":56030,…"budget":5,"took":7,"status":null,"signal":"SIGKILL","error":"ETIMEDOUT"…}
{"pid":56162,…"budget":3,"took":4,"status":null,"signal":"SIGKILL","error":"ETIMEDOUT"…}
{"pid":56227,…"budget":3,"took":4,"status":null,"signal":"SIGKILL","error":"ETIMEDOUT"…}
{"pid":56260,…"budget":5,"took":7,"status":0,"signal":null,"error":"ETIMEDOUT"…}      ← ps had exited 0, but spawnSync still reported ETIMEDOUT
{"pid":56326,…"budget":2,"took":3,"status":null,"signal":"SIGKILL","error":"ETIMEDOUT"…}
```

The one failure under load (run 18) followed the same pattern:

```
{"pid":59794,"lockProbe":"alive","left":25}
{"pid":59794,"tool":"/bin/ps","args":"-p 59759 -o pid=,ppid=,tty=,lstart=,comm=","budget":1,"took":2,"status":0,"signal":null,"error":"ETIMEDOUT","stderr":""}
{"pid":59794,"lockProbe":"unknown","left":0}
{"pid":59794,"expired":"LOCK_IDENTITY_UNKNOWN","over":0}
```

**Why this is a semantics decision.** The owner was never of unknown identity; the probe was cut short by the caller's own deadline. Candidate fixes, each changing what counts as *unknown* or the budget:

1. A `ps` killed by a timeout that was the deadline remainder (not the 2 s cap) raises `DEADLINE_EXCEEDED`, and `probe`/`withLock` let that propagate instead of turning it into `unknown`. The CLI test already accepts `DEADLINE_EXCEEDED`. This changes `probe`'s "never throws" contract.
2. `withLock` ignores a probe cut short by the deadline and keeps the last completed verdict. A live owner at the deadline then gives `LOCK_TIMEOUT` (matching `docs/api.md`: "a live holder exceeding caller patience is LOCK_TIMEOUT"). The change stays local to the lock.
3. Do not start a probe unless a minimum budget (for example 50 ms) remains; stop waiting early instead. This changes the deadline budget.

My recommendation would be (2), or (1) if a deadline-cut probe should surface as a deadline error everywhere. The decision is yours.

### Cause B: the eight-worker test (`error` instead of `done`; also lost updates). A reclamation race

This is almost certainly what run 1 hit (its code was lost). Under load I reproduced `IO_ERROR` 9 times, and twice the counter lost an update. The worker's recorded error:

```
{"pid":81103,"workerError":"IO_ERROR","message":"cannot reclaim lock","cause":{"code":"ENOENT","message":"ENOENT: no such file or directory, unlink '/var/folders/…/T/relay-test-BJt0FB/agents.lock'","syscall":"unlink","path":"/var/folders/…/T/relay-test-BJt0FB/agents.lock"},"stack":"Error: cannot reclaim lock\n    at relayError (file://$HOME/…/relay/src/protocol.js:4:67)\n    at withLock (file://$HOME/…/relay/src/bus/lock.js:93:73)\n    at async process.<anonymous> (file://$HOME/…/relay/test/fixtures/lock-worker.js:21:44)"}
```

and the lost updates (`test/lock-multiprocess.test.js:30`), in 2 of 80 runs:

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
'23' !== '24'
```

**Mechanism.** A lock owner that *releases normally and then exits* is indistinguishable from a *crashed* owner once it has exited. The reclaim path is check-then-unlink: under the guard it rereads the main token, probes that token's holder, then unlinks. The guard excludes other reclaimers, but not the owner's own `release()` or a new `acquire()`. Interleaving:

1. B, holding the reclaim guard, rereads the main token: owner A.
2. A finishes its callback, releases (unlinks `agents.lock`) and exits.
3. C acquires (links a fresh `agents.lock`).
4. B's probe of A answers `dead` (A has exited).
5. B unlinks `agents.lock`, which is now C's, and B and C are both inside the critical section, which is the lost update. If step 3 has not happened yet, the unlink hits ENOENT, giving `IO_ERROR: cannot reclaim lock`.

On Linux the gap between steps 1 and 5 is a `/proc` read (microseconds). On Darwin it is a `/bin/ps` spawn (3–33 ms), which is long enough for a worker's release and exit. Traces show the normal precondition is common: owners exit between a contender's token read and its probe (`ps -p <owner>` exit 1 → `lockProbe: dead`) in 10 of 21 loaded runs:

```
{"pid":59171,"tool":"/bin/ps","args":"-p 59170 -o pid=,ppid=,tty=,lstart=,comm=","budget":2000,…,"status":1,"signal":null,"stderr":""}
{"pid":59171,"lockProbe":"dead","left":11912}
```

The reclaim guard's own race (a guard holder that exits after releasing the guard) did not occur: 188 guard probes, all `alive` (`Counter({('alive', True): 108, ('alive', False): 80})`).

**Deterministic repro (runs on Linux too, injected `processOps` and `io`)**, `node reclaim-race.mjs <relay checkout> [reacquired|released]`, against unmodified main:

```js
// Deterministic interleaving: owner A releases and exits, and writer C acquires, while
// contender B's under-guard probe of A is running. B then unlinks C's live lock.
import * as fs from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const root = process.argv[2];
const { withLock } = await import(join(root, 'src/bus/lock.js'));
const { createProcessOps } = await import(join(root, 'src/bus/proc.js'));
const dir = mkdtempSync(join(tmpdir(), 'reclaim-')), lockPath = join(dir, 'agents.lock');
const real = createProcessOps(), me = real.handleOf(process.pid);
const A = { ...me, pid: 999991 }, C = { ...me, pid: 999992 };
const tokenA = { schema: 1, nonce: randomUUID(), holder: A }, tokenC = { schema: 1, nonce: randomUUID(), holder: C };
await fs.writeFile(lockPath, JSON.stringify(tokenA), { mode: 0o600 });
let probesOfA = 0;
const processOps = { ...real, probe: (h, o) => {
  if (h.pid === A.pid) {
    probesOfA++;
    if (probesOfA === 1) return { status: 'alive', reason: 'A still holding' }; // B waits
    if (probesOfA === 2) return { status: 'dead', reason: 'A exited' };          // B heads for reclamation (A had released and exited)
  }
  if (h.pid === C.pid) return { status: 'alive', reason: 'C holds the lock' };
  return real.probe(h, o);
} };
// Read 1 and 2 are B's main-loop reads; read 3 is B's reread under the reclaim guard.
const variant = process.argv[3] ?? 'reacquired';
let reads = 0;
const io = { ...fs, readFile: async (p, enc) => {
  const text = await fs.readFile(p, enc);
  if (p === lockPath && JSON.parse(text).holder.pid === A.pid && ++reads === 3) {
    // B has just re-read A's token under the guard. Before B's probe of A answers, A releases
    // (unlink) and exits, and C acquires with a fresh complete token.
    await fs.unlink(lockPath);
    if (variant === 'reacquired') await fs.writeFile(lockPath, JSON.stringify(tokenC), { mode: 0o600 });
  }
  return text;
} };
let cInside = true, bEnteredWhileC = false;
const r = await withLock(lockPath, async () => { bEnteredWhileC = cInside; }, { io, processOps, deadline: performance.now() + 2000 })
  .catch((e) => ({ error: e.code }));
console.log(JSON.stringify({ variant, result: r.error ?? 'entered', bEnteredWhileCHeld: bEnteredWhileC, probesOfA, lockFileAfter: await fs.readFile(lockPath, 'utf8').catch((e) => e.code) }));
```

Output:

```
{"variant":"reacquired","result":"entered","bEnteredWhileCHeld":true,"probesOfA":3,"lockFileAfter":"ENOENT"}
{"variant":"released","result":"IO_ERROR","bEnteredWhileCHeld":false,"probesOfA":3,"lockFileAfter":"ENOENT"}
```

The third probe of A is the real `probe` on a nonexistent pid, so it returns `dead` naturally. `reacquired` shows B deleting C's live lock and entering while C holds it. `released` is the `IO_ERROR` seen in the multiprocess test.

**Why this is a semantics decision.** The approved spec (`docs/specs/2026-09-17-registry-lock-safety.md`, "Main owner confirmed dead") assumes that a token rereads under the guard whose holder is then confirmed dead cannot have been released in between. A normal release-then-exit breaks that assumption. The spec's own Alternatives section already warns that "a second check-then-unlink race does not establish exclusive ownership". Options I see, none chosen:

- Make `release()` of the main lock also take the reclaim guard, so an owner cannot release, and therefore cannot exit after releasing, while a reclaimer is between its reread and its unlink. This changes release semantics: an abandoned guard would then block releases too.
- Treat ENOENT on the reclaim unlink as "already free" (the spec does say "A missing main lock under the reclamation guard is already free"). That removes the `IO_ERROR` but **not** the lost update, so it is not a fix on its own.
- A rename-based take-over, or a native advisory lock (the spec's rejected alternative).

This is a correctness bug on every platform: Darwin's slow probe only widens the window. It should probably go into its own task with a spec addendum, rather than a Darwin fix.

---

## Task 3: relay-661946. Fixed on `mac/relay-661946`

**Root cause.** `planHooks` rendered `'<relay.js>' hook --harness …`, which the shell runs through relay.js's `#!/usr/bin/env node`. A GUI-launched harness inherits launchd's `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, which contains no nvm or Homebrew node. Reproduced with main's rendered form:

```
$ env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin RELAY_STATE_DIR=… sh -c "'$HOME/Downloads/relay-test/relay/bin/relay.js' hook --harness codex --outer-ms 600000 --subscribers '…/subscribers.json' PreToolUse" < payload.json
env: node: No such file or directory
exit=127
```

**Commit** `e58f01a fix(install): run hook commands through the installer's absolute node`:

- `src/install/hooks.js`: `planHooks` takes `nodeBin` (default `process.execPath`; it must be absolute) and renders `'<node>' '<relay.js>' hook …`, with both paths quoted by `shellQuote`. The ownership regex accepts an optional leading executable, so entries written before this change (relay.js alone) are still recognized as relay's own and replaced on reinstall, not duplicated.
- `src/install/claude-code.js`, `src/install/codex.js`: accept and validate `nodeBin` (default `process.execPath`) and pass it through.
- `bin/relay.js`: `relay install` passes `nodeBin: process.execPath` explicitly.
- `docs/api.md`: one paragraph on the node path and its cost.
- `test/install-hooks.test.js`: two existing assertions updated for the node prefix, plus two new tests:
  - *every relay entry runs relay.js with the installer's node, and older entries are replaced*: a custom node path with an apostrophe renders quoted for both harnesses; a legacy relay.js-only entry is replaced (one entry, not two); re-planning is idempotent; a relative `nodeBin` is rejected by `planHooks`, `planClaudeCode` and `planCodex`.
  - *a rendered hook command runs under launchd's minimal PATH*: renders the real PreToolUse command for claude-code and codex with a deny guard, then runs it with `spawnSync('/bin/sh', ['-c', command], { env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, RELAY_STATE_DIR } })`. It expects exit 2 and a `deny` decision. When no `node` exists on that PATH (true on macOS, and on Linux hosts without a system node), it also checks that the command without the node prefix exits 127 with `node: No such file or directory`. The test runs on Linux; only that control assertion is conditional.

The D8 probe stage, which calls `planHooks` without `nodeBin`, gets the fix through the default, and `darwin-probe-stages-c.test.js` "D8 reap keeps exactly the live half of its own fleet" now passes.

**Check that the tests catch the regression**: with `src/` and `bin/` reverted to main and the new tests kept, `node --test test/install-hooks.test.js` gives `pass 7, fail 4`: the minimal-PATH test, the node-prefix test, and the two updated assertions.

**Manual verification on this Mac** (`env -i`, sample PreToolUse payload, deny guard; home redacted):

```
== claude-code rendered: '$HOME/.nvm/versions/node/v25.8.2/bin/node' '$HOME/Downloads/relay-test/relay/bin/relay.js' hook --harness claude-code --outer-ms 600000 --subscribers '$SCRATCH/t3/config/subscribers.json' PreToolUse
exit=2
stdout: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"denied by fixture"}}
stderr: denied by fixture
== codex rendered: '$HOME/.nvm/versions/node/v25.8.2/bin/node' '$HOME/Downloads/relay-test/relay/bin/relay.js' hook --harness codex --outer-ms 600000 --subscribers '$SCRATCH/t3/config/subscribers.json' PreToolUse
exit=2
stdout: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"denied by fixture"}}
stderr: denied by fixture
== control (main's form, relay.js only):
env: node: No such file or directory
exit=127
```

**Tests on the branch**:

- `node --test test/install-hooks.test.js test/install-claude-code.test.js test/install-codex.test.js test/install-cli.test.js`: 16 tests, 16 pass.
- `npm test`: **332 tests, 327 pass, 5 fail.** The 5 are the pre-existing darwin-probe failures listed in the baseline (python3/xcode-select, both closing-the-terminal tests, constructed codex parent `comm`, exiting-parent timing). D8 is fixed, and the SIGINT/D0 test passed in this run (it is load-flaky, see baseline). No new failures.

**Cost of this fix.** The rendered node path is the installer's `process.execPath` at install time. Under nvm it is always version-specific (`~/.nvm/versions/node/v25.8.2/bin/node` here). After `nvm uninstall` of that version, every installed hook fails to start until `relay install` is re-run. Claude Code then reports a non-blocking startup failure and lets the action proceed; Codex reports a hook failure and continues. Guards stop guarding silently in that state. Switching the default nvm version does *not* break hooks; it just keeps them on the old node. A Homebrew node may have the same problem if `process.execPath` resolves into a versioned `Cellar` path. I could not check that here, because Homebrew node is not installed on this Mac.

---

## Not verified / notes

- I did not run the Darwin probe itself, and did not start any live Claude Code or Codex session or touch `~/.codex/auth.json`. `npm test` runs the probe's own unit and self-test suites (`probe.mjs --self-test-hang`, stages D5/D8 against constructed parents). D0 in self-test mode runs `claude --version` and `codex --version` if they are on PATH. That is part of the suite as shipped, not something I added.
- Task 2's cause A was reproduced on unmodified main and fully traced. For cause B, the `IO_ERROR` and the lost updates were reproduced on unmodified code (only the trace lines added), and the interleaving was confirmed deterministically. I did not capture a trace of the exact moment of a lost update in the multiprocess test, since it is rare (2/80 under 4× load).
- Run 1's original eight-worker failure lost its error code. I attribute it to cause B by elimination (IO_ERROR is the only non-`done` outcome seen in 176 runs of that test here), not by direct evidence.
- The instrumentation was never committed; the working tree was reset to main after tracing.
- Commits carry no AI attribution, home paths or usernames. The repo has no `core.hooksPath` configured, so no git hooks ran.
