# Codex live phone and desktop acceptance

**Prepared only. Do not run without the user's approval of live host use.**
This gate uses the user's existing 0.166.0 daemon, real model and phone. Integration
remains a separate approval afterward. It installs no relay service or hooks,
changes no launcher, and never starts, restarts or configures the Codex daemon.

Allow 10–15 minutes, with a 20-minute relay deadline. The user sees one new Plan
thread in the existing native Codex TUI and one new phone browser tab at a
temporary tailnet HTTPS port. There are two real model turns and two blocking
questions. No desktop capture, keystroke automation or focus change is needed;
the user operates the native UI. Ask separately before any screenshot/capture.

## Approval and preflight

Before asking for approval, freeze the reviewed relay commit, exact native
executable/hash and proposed home, listener, phone client, host/login and port
values. Resolve filesystem facts without connecting; the new native thread and
its existing registry row are identified only after host approval. Record the
client artifact hash and all final values before starting the cases.
The approval must cover the new TUI thread, real model turns, phone tab and
temporary Tailscale Serve mapping. This document grants none of that host use.

Use the existing installed 0.166.0 TUI and daemon. Read-only filesystem preflight
may resolve the default rendezvous
`$CODEX_HOME/app-server-control/app-server-control.sock` to its physical socket;
the connector requires the physical owned mode-0600 Unix socket, not its symlink.
Use the actual canonical Codex home, not an assumed default. Do not run daemon
manager commands, connect merely to discover endpoints, or read authentication
files. A missing/mismatched/ambiguous daemon birth record, executable or listener
stops this gate; do not manufacture private-pilot metadata in the live home.

The four opt-in variables are exactly:

```sh
RELAY_CODEX_HOME="<canonical existing Codex home>"
DAEMON_PID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["pid"])' "$RELAY_CODEX_HOME/app-server-daemon/daemon.pid")"
RELAY_CODEX_BIN="$(realpath "/proc/$DAEMON_PID/exe")"
RELAY_CODEX_SOCKET="<resolved existing physical Unix listener>"
RELAY_CODEX_EVIDENCE="$RELAY/docs/evidence/codex-question-0.166.0.json"
```

`RELAY` is the absolute `.worktrees/codex-question` path, never a shared launcher.
Derive the executable from the live daemon's validated PID record and `/proc`
link, not from the standalone package path. Require its bytes and size to match
the evidence executable pin before connecting. `identity.js` compares executable
realpaths as well as process birth and listener ownership; identical version text
or identical bytes at a different executable path cannot substitute. Require the
evidence digest and executable SHA-256 from the
[private re-proof](codex-question-reproof.md). The socket and temporary
`$STATE/serve.sock` paths must each fit the 103-byte limit. Runtime admission also
checks actual PID birth/executable/listener ownership; a refusal is a failed
preflight, never permission to bypass it.
Recheck the qualified daemon identity and executable before each case and after
each terminal result. Any identity, disable or version diagnostic stops the run
and rolls back. A daemon update during the run makes the affected case interrupted;
do not silently reconnect the acceptance run to another daemon generation.

Choose a fresh mode-0700 `$WORK_ROOT/relay/relay-a27e7c/gate7-<run-id>` directory;
`RUN` names it and `STATE="$RUN/state"` is a fresh mode-0700 child. Keep private
evidence there. Do not copy the real inbox, presence, subscriber configuration,
auth or transcripts. Save current Tailscale Serve configuration read-only and
reserve loopback port 3341 and HTTPS port 8443 only if both are unused. If either
is occupied, settle and record another exact pair before approval. Do not reset
Serve or alter the existing 443 route. Funnel must be off for this route.

Set `TAIL_HOST` to the exact lower-case MagicDNS hostname and `TAIL_LOGIN` to the
user's exact Tailscale login. Supply an absolute `CLIENT` directory containing the
reviewed Transponder static build. Hash the supplied build before the run; do not
rebuild or install another project as part of this gate. Open the phone's new tab
at `https://$TAIL_HOST:8443/`; relative API requests use that same guarded origin.
No forged identity headers, public exposure or HTTP-only phone access.

Known client limit: Transponder at d590c3a renders a native answer map with
`Object.values(observed).join(...)`, so the details can show `[object Object]`.
Its answer controls and lifecycle labels are separate. Do not claim native-value
rendering passed; inspect the exact JSON receipt locally and record the UI defect.
If the user requires corrected details before running, arrange a separately
authorized consumer fix. Relay changes no phone client in this package.

## Isolate admission, then start the temporary relay

After host approval, the user creates a new native thread, selects Plan mode,
and identifies its exact thread id as `G7_THREAD`. No other turn is submitted.
Read the ordinary registry with the explicit worktree CLI under its original
state environment: `node "$RELAY/bin/relay.js" list --json`. It is read-only.
Require exactly one matching Codex session row and `liveness[row.id].status`
equal to `alive`. Copy only that existing row into `$STATE/agents.json`, preserving
its process handle and session id unchanged. Use schema 2, a fresh UUID generation
and revision 1, and mode 0600. This is a filtered snapshot, not a fabricated row.
If no row exists, stop; do not register a fake session or repoint hooks. Before each
case refresh this one-row snapshot from the ordinary registry and recheck the
same alive native session. Never add other sessions. The connector independently
rechecks admission; the snapshot does not prove displayed-thread ownership.
Create and refresh the filtered snapshot with the original registry environment
(no temporary RELAY_STATE_DIR exported into this command):

```sh
node --input-type=module - "$RELAY" "$STATE" "$G7_THREAD" <<'JS'
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const [relay,state,thread]=process.argv.slice(2);
const {listAgents}=await import(pathToFileURL(join(relay,'src/index.js')));
const {snapshot,liveness}=await listAgents();
const rows=Object.values(snapshot?.agents??{}).filter(a=>a.harness==='codex'&&a.scope==='session'&&a.sessionId===thread);
if(rows.length!==1||liveness[rows[0].id]?.status!=='alive')throw Error('GATE7_REGISTRY');
await mkdir(state,{mode:0o700}); // First snapshot only; omit on refresh.
await writeFile(join(state,'agents.json'),JSON.stringify({schema:2,generation:randomUUID(),revision:1,agents:{[rows[0].id]:rows[0]}})+'\n',{mode:0o600});
JS
```

The fresh RUN parent must already exist mode0700. On refresh omit mkdir and
replace only this run's one-row agents.json; never write the ordinary registry.
Record a new generation for the replacement snapshot. Preserve the original
registry environment in the driving shell; all temporary-state CLI assignments
below apply to individual commands only.

In a harness-tracked foreground command, with a timeout covering the entire run:

```sh
timeout --signal=TERM --kill-after=10s 20m env -i \
  PATH="$(dirname "$(command -v node)"):/usr/bin:/bin" HOME="$HOME" \
  RELAY_STATE_DIR="$STATE" \
  RELAY_CODEX_BIN="$RELAY_CODEX_BIN" RELAY_CODEX_HOME="$RELAY_CODEX_HOME" \
  RELAY_CODEX_SOCKET="$RELAY_CODEX_SOCKET" RELAY_CODEX_EVIDENCE="$RELAY_CODEX_EVIDENCE" \
  RELAY_HTTP_PORT=3341 RELAY_SERVE_HOST="$TAIL_HOST:8443" \
  RELAY_SERVE_LOGIN="$TAIL_LOGIN" RELAY_CLIENT_DIR="$CLIENT" \
  "$(command -v node)" "$RELAY/bin/relay.js" serve \
  >"$RUN/relay.stdout" 2>"$RUN/relay.stderr"
```

Record the owned timeout/relay PIDs immediately. No detached shell or persistent
user unit. Continue driving the run through the tracked command; do not end the
session while it lives. In a second tracked command, use the same explicit state:

```sh
RELAY_STATE_DIR="$STATE" node "$RELAY/bin/relay.js" presence away
tailscale serve --bg --https=8443 http://127.0.0.1:3341
```

The Serve mapping is the approved temporary host change; record its exact target
and rollback immediately. Confirm private tailnet identity/Host/Origin behavior
from the phone; existing mappings must match their saved state. Any connector
disable/identity diagnostic stops the cases. No new native turn begins until the
phone is connected, the temporary inbox is empty and presence is away.

## The two cases

1. **Phone answer with receipt.** In the selected native Plan thread, ask:
   “Use request_user_input to ask one single-choice question: ‘Gate 7 color?’
   with Blue and Red options. Wait for my selection, then report the selected
   value without using other tools.” The model may decline to call the tool;
   that is an incomplete case, not permission to fabricate it. Require one
   eligible pending entry and matching native question. Select Blue on the
   phone once. Expect saved, handed, then consumed only after the exact-call
   rollout map and exact protocol terminal agree. Allow two minutes for the
   case; unconfirmed is not a pass. Read the entry with
   `RELAY_STATE_DIR="$STATE" node "$RELAY/bin/relay.js" inbox show ID --json`
   and retain its public JSON. Record UUID/native tuple, phone outcome, native
   model continuation and exact observed answer. Never use model prose as receipt.
2. **Desktop defer.** After the first turn ends and the row is refreshed, submit
   the same instruction with ‘Gate 7 shape?’ and Circle/Square options. Require
   a new tuple and UUID. Press the phone's defer action once. Expect released,
   no relay answer/interrupt and the same pending native question. The user
   selects Square in the native TUI. Expect native continuation and released
   history with the exact native answer; it must not reopen or become consumed
   as a relay answer. Allow two minutes. If handback or native UI is unusable,
   record failure and stop rather than substituting a socket answer.

Keep content limited to these fixed questions/answers and minimal public entry
evidence; do not copy full sessions, credentials or unrelated notifications.
Record both verdicts, identities, cleanup and any UI defect separately. The
scripted pilot and a successful CLI answer cannot substitute for either case.

## Stop and rollback

On failure, timeout or user cancellation, stop submitting and perform rollback
immediately. Set only temporary presence to here, then TERM only the recorded
owned relay process (or interrupt its tracked foreground command) and await it;
verify serve.sock/lock release and no owned survivors. A pending native question
remains for the user to answer or cancel in the native UI. Stopping relay does
not retract a saved/handed answer or erase real model usage.

Read back the dedicated 8443 mapping. If it still equals this run's exact
`http://127.0.0.1:3341` target and was absent before, remove only it:

```sh
tailscale serve --https=8443 off
```

If somebody changed it, stop and report rather than overwrite their change.
Verify all pre-existing mappings remain, close the new phone tab, and let the
user close the test thread. Do not stop Codex or the ordinary relay service.
Keep `$RUN` private for a directory-manifest checkpoint; remove nothing until
the task's evidence disposition is agreed. Temporary environment assignments
do not persist; no global opt-in variables, units, hooks or pointers are changed.
Report actual receipt/defer results and limits before requesting integration.
