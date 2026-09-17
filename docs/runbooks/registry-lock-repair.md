# Repair an abandoned registry lock

Use this only for LOCK_REPAIR_REQUIRED or a diagnosed lock cleanup/ownership
failure. Normal dead main writers recover automatically; age never proves death.
This is an explicit operator procedure, never automatic hook-error recovery.

Repair is required when:

- the main token is empty, old-format or malformed, or the reclaim guard is dead or malformed;
- a hook deadline makes the CLI exit while a writer holds the reclaim guard,
  leaving an abandoned `agents.lock.reclaim`; or
- a lock cleanup or ownership failure has been diagnosed after publication.

1. Prevent new hook invocations and stop **all relay writers**. Work from an ordinary
   operator shell outside the affected harness sessions. Inspect installed hook and
   plugin configurations and process ancestry. Process names alone do not establish
   quiescence. If quiescence cannot be established, stop here.
2. Apply the same RELAY_STATE_DIR override as the affected writers. From the installed
   package's module-resolution context, use its paths function to locate and read
   agents.lock and agents.lock.reclaim for diagnosis. Preserve agents.json, including
   its generation/revision; do not replace it with an empty registry. A valid token
   has schema:1, nonce UUID and qualified writer holder Handle. Empty/old tokens are
   not safely reclaimable automatically.
3. Only after the quiescence precondition, remove exactly the two control files:

```sh
node --input-type=module <<'JS'
import { unlink } from 'node:fs/promises';
import { paths } from 'relay';
const { lockPath, reclaimPath } = paths();
for (const path of [lockPath, reclaimPath]) {
  try { await unlink(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
JS
relay list --json
relay reap
```

4. Verify the preserved snapshot and liveness results. Unknown process evidence
   remains unknown; listing/reaping does not prove guards or terminal reconciliation
   work. Restore hook configuration and begin fresh sessions only after verification.
   R2 hook dispatch is available, but installation is not: do not enable it as a
   live hook. The later installer/cutover task owns that step.

Temporary token names are not swept by pattern. If they need cleanup, inspect and
remove them individually under the same quiescence condition. Never use a wildcard
that could delete another writer's private token or snapshot temporary file.

An existing state directory must be privately owned and mode 0700. Relay rejects
0755 with IO_ERROR and does not silently chmod it. Correct the chosen state leaf
only after verifying ownership and purpose; never chmod unrelated parents.

If a mutation reports publication completed followed by cleanup failure, its
snapshot was published. Preserve it and diagnose the control files; a blind retry
would observe another event, not roll back the prior one.
