# Codex question connector: transport prerequisite blocked

Execution of the approved plan at relay `3b668d5` stopped before authentication
or model inference. The installed Codex 0.165.0 proxy carries raw WebSocket bytes,
not newline-delimited JSON. This disproves the transport assumption in the
approved addendum at `77d3aee`; it does not disprove native question routing itself.

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
  was removed. The cumulative run record charged 15,541 ms and zero turns.
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

## Evidence retained on relay-a27e7c

Task attachments and retained-item records locate the exact bytes, manifests and
source URLs: `transport-check-02.json` (successful upgrade), `transport-check.json`
(failed first setup), `transport-source-evidence.json` (tagged source excerpts and
full-source hashes), `inventory-01-result.json`, its raw/portable capture, the
partial driver/test snapshots, and the development/Node22/baseline test logs.
The plan workspace ledger records the inventory-only preflight ruling. Raw task
scratch remains owned by the open parent; no evidence or worktree was removed.
