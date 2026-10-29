# Codex question connector: transport prerequisite blocked

Execution of the approved plan at relay `3b668d5` stopped before authentication
or model inference. The installed Codex 0.165.0 proxy carries raw WebSocket bytes,
not newline-delimited JSON. This disproves the transport assumption in the
approved addendum at `77d3aee`; it does not disprove native question routing itself.

This transport was already recorded by hq-d85ede on 2026-10-11 for Codex 0.162.1.
The `answer-server-terminal.harness.codex` fact in hq's `facts/capabilities.toml`
explicitly describes WebSocket over the Unix control socket. The approved spec
cited those facts, but I overlooked that statement when designing the JSON-line
proxy route. The current run confirms earlier evidence; it is not a newly
discovered transport. The same fact records native refusal of the blocking tool
in Default mode, which the revised plan must investigate as current-version mode
evidence. The historical record has not been re-probed on 0.165.0.

## Observations

- The worktree full-suite baseline (`just test`, Node 26.5.0) passed 773/773 tests.
- The partial disposable driver has 19 passing focused checks on Node 26.5.0 and
  Node 22.23.2. They exercise isolation, lifetime checks, credential suppression,
  changed/deleted source login, time budgets, RPC matching, bounded input and
  owned-process cleanup, including a real private tmux server with a fake TUI.
- The initial RED run lacked the driver. Additional RED checks exposed a cleanup
  exception when the auth source disappeared and split-chunk stderr disclosure;
  both were fixed and rerun GREEN. These fake-process checks do not validate the
  assumed native framing. The fake proxy spoke JSON lines and therefore missed it.
- `inventory-01` launched the installed foreground server on a private Unix socket
  and its supplied proxy. Sending JSON-line `initialize` yielded no response within
  the 15-second RPC limit. It sent no authentication message, opened no TUI and
  started zero model turns. All three owned processes were reaped; private state
  was removed. That run charged 15,541 ms and zero turns. The persisted budget now
  conservatively adds 40,000 ms for the two bounded transport diagnostics whose
  exact durations were not recorded: 55,541 ms charged in total, still zero turns.
- A separate, unauthenticated check sent an HTTP WebSocket Upgrade through the same
  proxy and received `HTTP/1.1 101 Switching Protocols`, the expected RFC sample
  acceptance key, and the server's frame-size header. Both processes were reaped.
  Its first attempt failed before the socket appeared because the fresh Codex home
  had not been created; that failed result is retained too.

The exact tagged [0.165.0 CLI source](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/cli/src/main.rs#L1478)
passes the proxy socket to `codex_stdio_to_uds::run`. The tagged
[Unix listener](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/app-server-transport/src/transport/unix_socket.rs#L193)
accepts a WebSocket handshake. Together with the native 101 response, this supports
the transport diagnosis; it is our design error, not an identified Codex defect.

The 0.165.0 source also confirms the managed daemon's transport selection, without
opening the live daemon's socket:

- The [PID backend's command arguments](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/app-server-daemon/src/backend/pid.rs#L392)
  launch `app-server --listen unix://` (with a separate remote-control flag when
  enabled). Its startup path may add the managed-daemon flag.
- The [transport parser](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/app-server-transport/src/transport/mod.rs#L130)
  maps both the default Unix address and an explicit Unix path to `UnixSocket`.
- The [app-server dispatch](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/app-server/src/lib.rs#L832)
  uses `start_control_socket_acceptor` for that variant. Managed operation changes
  options such as shutdown access, not the listener's WebSocket framing.

This establishes the common listener in the tagged source. It is not a live
daemon test or proof that recovery, authentication and lifecycle behavior are
equivalent. Those remain native-probe obligations.

## Limits and task state

The live attempt did not reach app inventory. Linear's read-only search exists in
this harness's metadata; its availability and forced approval in the private native
server remain unknown. Keith approved the exact synthetic search/decline recipe,
retained on relay-a27e7c; that approval does not authorize another tool or a write.
No subscription inference was used, no refresh token was copied, and no login,
live daemon, shared launcher or host service was changed.

Task 1 (relay-dc1f42) is **incomplete**: it contains tested safety scaffolding and
partial pilot observation, not a verified end-to-end pilot. The current driver
explicitly stops on unproven current-turn mode semantics and has no completed
answer/receipt path. Its JSON-line RPC transport must be replaced after design and
plan review. Task 2 (relay-01090a) has not started its matrix; Task 3
(relay-4746ed) remains open for the eventual complete contract report and next plan.
This early blocker report does not complete those children or the parent.

Only the transport premise has been investigated live. Built-in provenance,
question-turn mode, app exclusions, forms/decline, exact receipt, races and recovery
remain unverified. Preserve every acceptance condition; do not qualify questions
using `isBlocking` alone or enable a permanently unconfirmed route.

## Proposed next decision

The [revised addendum](../specs/2026-10-28-codex-question-connector.md) recommends a
bounded Unix WebSocket client using Node built-ins. Keeping the raw proxy would
still require framing plus child cleanup. An embedded stdio server would change
the shared-thread topology and is not a substitute for this task. No replacement
transport has been implemented. User review of the revised spec comes next, then
a revised feasibility plan and framing tests before further native probes.

The `ws` alternative is now recorded explicitly in the spec. Its direct Unix
support and lack of mandatory runtime dependencies make it a real alternative,
but it would be a second runtime dependency; the Node-builtins rule remains in
force. The cost of rejecting it is maintaining framing code ourselves. The local
Node 22.23.2 API check rejects `ws+unix:` and exposes no public `node:undici`
module; no connection was attempted by that check.

The revised plan must carry these concrete requirements forward:

1. First complete a real private-server handshake **and `initialize` round trip**
   without authentication or inference. Build later fake transport fixtures from
   captured real frames, with additional malformed/limit cases. The earlier 19
   fake checks remain useful safety checks, not native transport proof.
2. Honor the advertised frame-size ceiling in addition to local limits, including
   a test where the peer's limit is smaller. The captured 0.165.0 header advertises
   16,777,216 bytes; it must never increase the client's own cap.
3. Use the source-verified common listener above as scoped transport evidence;
   keep the prohibition on contacting the live daemon and test the remaining
   topology/recovery obligations privately.
4. Re-probe hq's native mode-enforcement rule as a candidate: positively identify
   the built-in blocking tool, observe `isBlocking: true`, and demonstrate native
   Default-mode refusal on this version with a Plan positive control. Require an
   actual attempted call and native rejection; a model choosing not to call it is
   not refusal evidence. Account for mode changes and resumed/late-joined calls.
   Only established enforcement may supply the existing Plan-mode qualification;
   this does not permit `isBlocking` alone. Otherwise mode remains unknown.

These are obligations for the next reviewed plan, not a plan approval or a live
capability verdict. No probe or production code changed in this documentation
revision, and no new daemon connection or model turn ran.

## Evidence retained on relay-a27e7c

Task attachments and retained-item records locate the exact bytes, manifests and
source URLs: `transport-check-02.json` (successful upgrade), `transport-check.json`
(failed first setup), `transport-source-evidence.json` (tagged source excerpts and
full-source hashes), `inventory-01-result.json`, its raw/portable capture, the
partial driver/test snapshots, and the development/Node22/baseline test logs.
The plan workspace ledger records the inventory-only preflight ruling. Raw task
scratch remains owned by the open parent; no evidence or worktree was removed.
The review revision additionally retains `hq-answer-route-evidence.json` (frozen
hq fact snapshot and task provenance) and `transport-review-evidence.json`
(tagged listener-selection chain, library metadata and local Node API check).
