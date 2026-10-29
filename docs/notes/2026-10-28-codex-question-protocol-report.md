# Codex question connector: app discovery prerequisite blocked

Execution of approved feasibility plan `7d55697` against approved spec `741a546`
proved the private Unix WebSocket handshake and `initialize` round trip on Codex
0.165.0. The next prerequisite, account-connected app discovery, stopped at the
approved 15-second RPC deadline. No model turn or app operation ran. This is an
inconclusive discovery attempt, not evidence that Linear is unavailable or that
native question routing is unsupported. The parent relay-a27e7c remains open;
production implementation and phone acceptance remain owed.

## Verified work and its limits

Task 1 (relay-dc1f42) contains the disposable probe driver and its safety checks:
81/81 focused tests passed on Node 26.5.0 and Node 22.23.2; the fresh repository
`just test-fast` run passed 773/773. The recorded full-suite baseline also passed
773/773. The tests cover bounded framing/RPC, explicit child environments,
access-only authentication, refresh refusal, source-login change detection,
owned-process cleanup, budgets, lightweight history, synthetic per-thread size
failure/recovery, and rejection of stale-mode and model-silence evidence.

Native `transport-01` passed before real-wire-derived fake-process fixtures were
built. It opened an owned private foreground server, validated the Upgrade,
received `initialize`, confirmed the private Codex home, and closed cleanly.
The peer advertised 16,777,216 bytes; the driver retains its stricter local caps
(1 MiB outbound, 8 MiB incoming). This run read no authentication source and
started no TUI or model. Its raw wire capture is retained. Post-initialize fake
scenarios are explicitly synthetic, not native capability evidence.

The first independent execution review found three driver gaps after the original
76/76 tests passed: capture bytes omitted JSON escaping and the portable copy;
a removal error could skip later cleanup; and inventory checked property names
without validating the authorized arguments. Regression tests reproduced each
problem, including an actual filesystem permission failure. Corrections count
exact persisted bytes with space reserved inside the cap for a verdict, continue
independent cleanup stages with a failed result, and conservatively validate the
exact approved argument object. Unsupported schema constraints fail closed. The
81-test suite includes these corrections; the original native evidence is unchanged.

The pilot orchestration exists but has not run against a real model. Later matrix
cases are not yet implemented: they are deliberately refused until the pilot
establishes native mappings. History pagination and isolation have only synthetic
coverage. No production connector, public API or dependency changed.

## The blocked inventory

`inventory-02`, 2026-10-29 11:03:50–11:04:07 UTC, used the same private Unix
WebSocket route and access-token-only login. Its result is `unknown`, reason
`rpc-deadline`:

1. `initialize` returned the expected 0.165.0 user agent and private home.
2. `account/login/completed` reported success. The driver supplied no refresh
   token and received no refresh request.
3. `app/list` was sent at 11:03:52.001 UTC. An `app/list/updated` notification
   arrived at 11:03:56.288, but the matching RPC response did not arrive within
   15 seconds. The driver stopped and cleaned up.
4. That notification listed eight accessible apps and did not include Linear.
   It is a partial update, not a completed catalog or proof of absence. Tool
   schema, effective app approval policy and model availability checks were
   not reached. The configured model is `gpt-6-astra`; its availability in this
   private server remains unconfirmed.

The [tagged app-list implementation](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/app-server/src/request_processors/apps_processor.rs#L186)
loads accessible apps and the directory separately, can notify before both finish,
and returns the RPC result only after both finish. Its load timeout is 90 seconds.
This explains why a partial notification is insufficient and identifies a mismatch
between the probe's deadline and the server's permitted wait. It does not establish
which backend was slow, that waiting longer would succeed, or an upstream defect.

Both owned inventory processes were reaped (2570855, 2570819), with no survivors;
private credentials/runtime state were removed. Both transport processes were
also reaped (2183596, 2183556). No live daemon socket, desktop, launcher or service
was changed. No source-login change was detected. The persisted cumulative budget
is **73,256 ms and zero model turns**, including the earlier conservative 40-second
diagnostic charge, out of the existing 30-minute/30-turn allowance. No extension
is requested by this report.

## Gate disposition

| Spec gate | Verdict and missing native evidence |
| --- | --- |
| 1: transport and join | Partial: private handshake/initialize/cleanup passed; ordinary TUI discovery, early/late join, settings preservation, lightweight native history and subscription isolation unobserved. |
| 2: clarification-only routing and forms | Unknown: built-in provenance, native Plan positive control, Default/async and secret exclusions, app approval, dedicated permission example/path audit, forms and decline unobserved. |
| 3: receipt and races | Unknown: exact accepted-answer result mapping, desktop/client orderings, cleanup-only resolution, mismatch, interruption and delayed receipt unobserved. |
| 4: defer | Unknown: native handback and unchanged pending turn unobserved. |
| 5: reconnect/restart | Unknown: pending replay, authoritative reconciliation completion, daemon generation, stale-answer rejection and no-client recovery unobserved. |
| 6–7: production and phone | Not attempted: production fixture/integration suite and user-present phone answer/defer belong to later work. |

There is no established native request/answer mapping, decline encoding, receipt
extractor, late-join source, replay barrier, daemon-generation discriminator or
same-call retry rule. Synthetic fixture mappings must not become production code.
The 10-page/20-item receipt lookup is a probe bound only; a production plan must
use observed result distance and failure behavior. No native history samples yet
support selecting a production incoming-message cap.

## Mode evidence prepared for the pilot

The retained [0.165.0 built-in handler](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/core/src/tools/handlers/request_user_input.rs)
derives blocking status from the current turn's Plan mode. Depending on feature
availability, Default may expose a nonblocking variant; an unavailable blocking
variant does not mean the whole question tool must be absent. A proposed predicate
therefore still needs native built-in call provenance, exact call correlation,
`isBlocking: true`, matching source/version/configuration and the Plan positive
control. No such native question has yet been observed here.

`collaborationMode/list` omits developer-instruction text. The driver reads its
Default preset values and clears overrides exactly as the
[tagged TUI does](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/tui/src/collaboration_modes.rs#L90),
so the server supplies current instructions. It will record the effective control
configuration; that check was not reached. A previous turn's mode or a model
choosing not to invoke a tool still proves nothing. These are prepared source
candidates, not passed capability gates.

## Decision for review

Recommend a narrow amendment to the next frozen feasibility plan: allow only
inventory `app/list` a **95-second RPC deadline**, give inventory a **120-second
case deadline plus 60 seconds cleanup**, and permit one fresh read-only inventory
attempt after fake-clock tests prove the exception and unchanged default timeout.
The original 30-minute/30-turn aggregate budget, token-lifetime check, frame and
capture caps, refresh refusal and cleanup rules remain unchanged. Every other RPC
keeps its 15-second deadline. Multiple pages remain bounded by the single case
deadline. Another incomplete inventory stops before any model turn.

Why this alternative: it lets the native 90-second load timeout produce a response
or error, with a small allowance for config/setup work. Cost: it can spend up to two
minutes of the existing budget and still fail; it cannot make an unavailable app
available. Do not adopt it silently: plan `7d55697` explicitly requires the shorter
deadline and routes unknown prerequisites back to review. No timeout was widened
and no retry was run in this revision.

Keeping the present limits is safe but leaves discovery inconclusive. Switching
to `app/read` or `app/installed` would need its own metadata/identity investigation;
no compatible Linear id or equivalent recipe has been established. Accepting an
interim notification, substituting a different app, installing one, changing live
account settings or skipping the app gate is rejected. The exact approved Linear
search/decline authorization remains valid, but was not exercised.

Task 2 (relay-01090a) remains incomplete at inventory; Task 3 (relay-4746ed)
produces this blocker report, with no guessed production plan. After the user's
decision, the owning Codex session freezes any amended feasibility plan for its
separate review, then resumes the blocked inventory. The branch stays unmerged
until the connector, all required gates and human phone acceptance are complete.

## Earlier evidence and retained artifacts

The previous report at `741a546` remains the exact record of the JSON-line proxy
failure under plan `3b668d5`. hq-d85ede had already recorded Unix WebSocket and
Plan-only blocking behavior on 0.162.1; that evidence was overlooked in the first
transport design. The new run resolves only the transport prerequisite. Retained
`transport-review-evidence.json` records the 0.165.0 common-listener source chain
for managed daemon and private `--listen unix://`; no live daemon was contacted,
and listener equivalence still says nothing about lifecycle/recovery equivalence.

relay-a27e7c owns the raw task scratch and portable attachments. Current evidence:

- Current corrected driver snapshots `r5-run.mjs`, `r5-probe.test.mjs` and
  `r5-fake-child.mjs`, with `review-fix-dev.log`, `review-fix-node22.log`,
  `review-fix-red.log`, `cleanup-fault-red.log` and `review-fix-green.log`.
  Unchanged modules and prior snapshots: `r4-*.mjs`, `r4-cases.json`,
  `task1-r4-dev.log`, `task1-r4-node22.log`,
  `task1-r4-fast.log`, RED/GREEN safety logs and `transport-initialize-fixture.json`.
- `transport-01-result.json` and `inventory-02-result.json` portable result
  attachments; raw results/captures under retained `runs/transport-01` and
  `runs/inventory-02`. Portable result paths replace the private runtime path.
- `inventory-blocker-evidence.json`: exact raw/portable/result/budget/source hashes
  and the tagged source URL. `mode-rule.json` retains mode-source references and
  hashes. `source-0.165.0/sources.json` maps saved full source to tagged URLs.
- `protocol-contract-report.md` is the portable task-scratch copy of this report.
  Parent retained-item records locate manifests and owners; no raw evidence was
  removed or replaced by a derivative. Test logs prove fixture behavior only.
