# Codex question feasibility: native no-rollout diagnostic

## Current outcome after approved 1206516

The single authorized `readiness-03` ran on Codex 0.165.0 from
2026-10-29T17:43:52.376Z to 17:43:59.707Z. Its original outcome is
**failed / rpc-error**, with readiness capability **unknown**. The bounded
projection captured request 13's native error: **code -32600, class no-rollout**.
It matches the pinned exact message for the thread id in that pending
`thread/resume` request; arbitrary error text and data were not retained.

The request used `excludeTurns:true`. Before it, the owned untrusted workspace
passed refreshed effective configuration checks, the native empty composer was
recognized, three discovery polls found one new TUI thread, and `thread/read`
confirmed its identity, model and workspace. The failure is at stored-thread
resume, not composer recognition. No keys or native model turns occurred.
No fallback, `/plan`, pilot, metadata retry or app operation followed.
The approved diagnostic sequence is exhausted, even though its capture objective
was achieved. It does not authorize another native run.

Raw SHA-256: `44e09208dc53994364dece3c5e33704ad23893e3543addfdc4faf909326026a2`.
Portable SHA-256: `73f8180aa7677c7d8af65eef467d8cb0496c2db2a0184688e109eef2cb6b3cfa`.
`readiness-03-observations.json` records request/response lines31/32 and the
controller interpretation separately from the original result. All evidence
hashes matched, all seven owned PIDs were independently absent, and both private
and runtime directories were removed. Cleanup had no errors or survivors;
no login-file change or refresh request was detected.

Budget is **360,674 ms (6 min 0.7 s), two charged turns**, inactive. This attempt
added7,333 ms and zero turns. Only one native turn was observed historically;
the unused reservation and earlier conservative charge remain counted.

## What this establishes and what it does not

The pinned `thread_processor.rs:4624–4662` reads stored state even when resuming
an already loaded thread. Lines6443–6455 map a missing stored thread to the
exact no-rollout message. This run now supplies the native response missing from
readiness-02: the same request shape cannot complete the required pre-input
policy proof for this fresh thread in this setup.

The source's first-message materialization comments are consistent with the
observation. They do not prove which internal storage condition occurred, that
all fresh threads behave identically, or that the managed live daemon has this
failure. Readiness-02 retains its redacted, unresolved cause. No upstream defect
is asserted, patched or reported; this is an incompatibility between the current
probe's pre-input resume requirement and the observed fresh-thread behavior.

The current generated protocol exposes no `thread/settings/read` method.
`thread/read` returns Thread metadata, which lacks sandbox and approval policy;
`thread/settings/updated` carries those fields, but none was observed here.
The mutating `thread/settings/update` is not an authorized substitute for a read.
These facts do not yet supply another complete native policy-proof path.

## Diagnostic implementation and verification

Disposable driver r13 changes only the pending `thread/resume` error projection.
It preserves request id/method, a safe integer code or null, and an exact class:
no-rollout, thread-closing, listener-not-running or unclassified. Classification
uses the pending request's thread id. It exposes no arbitrary message/data;
other RPC errors retain redaction and secret calls remain uncaptured. RPC
rejection, readiness gates, budgets and cleanup remain unchanged.

Four focused regressions cover exact classes, wrong-thread/lookalike text,
invalid codes/missing identity, credential-bearing errors and a fake readiness
failure with no input or turns and verified cleanup. RED passed1/4; GREEN passed4/4.
During GREEN the integration assertion was corrected to decode the existing
JSONL data wrapper; capture format was unchanged. Combined driver/transport/history
checks passed **123/123 on Node26.5.0 and123/123 on Node22.23.2**. Fresh
`just test-fast` passed **773/773**; `just check`, `tasks check` and diff hygiene
passed. r13 source/fixtures and portable logs are attached to the task; raw logs
and evidence remain in its persistent directory.

## Proposed fresh-thread policy observation (offline only)

After9ae6138 the user approved replanning. No additional native run or model turn
has occurred. The pinned audit `fresh-thread-policy-source.json` confirms that
an empty `thread/settings/update` is not a getter: the response is empty and no
update is submitted for empty overrides. Settings notifications require an actual
change from the initialized baseline. The TUI session log also lacks the complete
native start response. None supplies a read-only policy snapshot to an observer.

The native TUI does receive actual policy in `ThreadStartResponse`, generated from
Codex's config snapshot (`thread_processor.rs:1679–1710`, received at
`tui/src/app_server_session.rs:895–950`). The revised plan therefore proposes a
bounded task-local Unix socket observer on that private connection. It forwards
bytes unchanged and retains only correlated native identity/policy fields; the
outside client continues speaking directly to the private server. This changes
measurement, not the approved production transport or capability predicates.

Ruling: prefer this zero-inference observation over another stored-history resume,
a paid bootstrap, config-only proof or a forced settings mutation. Why: it reads
the native response that already exists without changing the thread under test.
Cost: a new bounded parser needs offline verification and one readiness-only run.
It may fail safely on unexpected framing, startup settings changes or size limits.

Ruling: the proposed execution stops after one untrusted readiness-04, even if it
passes. Why: observing start policy cannot establish when the outside production
client can join/replay the first real question. Cost: pilot-02 needs a separate
reviewed ordering after this evidence; no paid capability progress is claimed.
No fallback, input, metadata retry, app alias or paid turn is proposed here.

Task2 and Task3 remain incomplete. Native readiness, Plan provenance/mode/receipt,
forms/exclusions, join/isolation, races/defer and recovery remain unproved;
production connector and user-present phone acceptance remain owed. Budget stays
360674ms/two charged turns. Existing default/medium effort allowlist is a deferred
minor: another legitimate label fails closed. The branch remains unmerged.

## Historical checkpoint through 1206516

The following report is retained unchanged apart from its historical heading.
Its readiness-03 proposal was executed above and grants no further attempt.

# Earlier readiness-02 checkpoint

## Current outcome after approved 995a04e

`readiness-02` ran on Codex 0.165.0 with saved untrusted in the owned private
workspace. Its original result is **failed / rpc-error**; the required readiness
capability remains **unknown**, not disproved. It ran from
2026-10-29T17:09:09.800Z to 17:09:17.070Z and charged 7,272 ms. No keys, trust
acceptance or model turns occurred. No fallback, pilot or matrix case followed.

The corrected classifier passed the native empty composer. Three discovery polls
found exactly one new thread. `thread/read` returned the expected id, workspace
and gpt-6-astra model; refreshed config/read with layers passed policy checks.
The next request, id 13, was `thread/resume` with that id and `excludeTurns:true`.
Its reply was an error. The driver retained only `error:"redacted"`, so neither
numeric code nor cause can be recovered from this capture. The original error
and failed result are preserved without reinterpretation as a native contract pass.

Raw SHA-256: `4c9397bec1a068d629dfee5af91559b59176c5aae3655345368b3ba10aafceee`.
`readiness-02-observations.json` records the controller interpretation separately.
All evidence hashes matched; all seven recorded owned PIDs were gone, both
private and runtime paths were removed, and cleanup had no survivors/errors.
The controller detected no auth-file change or refresh request. No process remains.

Budget is **353,341 ms (5 min 53.3 s), two charged turns**, active false. Only one
native turn was observed historically, in pilot-01; its unused reservation and
the earlier diagnostic charge stay counted. No budget extension or refund occurred.

## Source audit and limits

`linear-resume-source-audit.json` retains hashes and the paths inspected.
`thread_processor.rs:4624–4662` shows even loaded-thread resume reads the stored
thread before its configuration snapshot. Missing stored threads map to a
no-rollout error at lines 6443–6455; other errors can also propagate. Source notes
that fresh-thread history may be unmaterialized before a first user message.
This supports a hypothesis, not the observed cause: the actual message was redacted.
No Codex defect, persistence repair or inference bootstrap is established/authorized.

The requested Linear name trace reaches a connector-aware path:

- `rmcp_client.rs:866–918` routes Codex Apps tools through connector-name/id
  normalization while preserving the raw MCP tool definition.
- `codex_apps.rs:31–70` sanitizes the raw name, strips a matching connector prefix,
  and constructs the namespace from server and connector when provided.
- `tools.rs:113–218` applies prefixing, sanitization and collision/length handling;
  its canonical name is a namespace/name pair. `protocol/tool_name.rs` formats
  that pair by concatenation.

With connector name Linear, prefix enabled and no collision, the raw name
`linear.search` yields namespace `mcp__codex_apps__linear` and callable `_search`;
the display string equals the approved `mcp__codex_apps__linear_search`. This is
strong conditional evidence, not proof of the private account's actual mapping:
connector/callable identity was not retained, and display formatting does not by
itself establish the external harness's flattened-name mapping. The exact schema
and approved argument compatibility remain absent. No alias or new app call is admitted.

The schema path is also traced: `tools/list` supplies tool definitions through
`rmcp_client.rs:717–773`; catalog listing retains them; `mcp/mod.rs:713–727,817–870`
serializes the raw tool into protocol Tool. `ToolsAndAuthOnly` drops resources only.
`protocol/mcp.rs:390–427` retains inputSchema but permits a missing schema as null.
Thus this status path does not deliberately remove schemas for deferred model
loading. Our projection definitely removed this name's schema field; actual backend
omission/null is still possible. A future approved capture must verify the bytes.

## Proposed next step, separately reviewed

The companion revision proposes offline tests and a narrowly scoped safe error
projection, then one zero-inference untrusted `readiness-03`. Retain only numeric
code and exact source-literal error classes for thread/resume; all arbitrary text
and data stay redacted. Stop after that run, even on success. There is no trusted
fallback, pilot, metadata retry or app operation in that diagnostic authorization.

Why: it measures the currently hidden failure before changing native behavior.
Cost: up to another 120 seconds, with no model turns, and an unclassified error
may still leave the cause unknown. Rejected alternatives are guessing a missing
rollout, adding inference to materialize history, or repeating the unchanged capture.
The frozen diagnostic plan requires user review before its execution.

No driver code changed after r12. Its 119/119 checks on Node 26.5.0 and22.23.2
remain applicable; repository baseline773/773 was reused because executable code
and dependencies are unchanged. This documentation/source audit adds no test claim.
Required native readiness is still incomplete; Plan provenance/mode/receipt,
forms/exclusions, join, races/defer, recovery, connector and phone acceptance remain
unproved or unimplemented. The parent remains open and the branch stays unmerged.

## Historical report through 995a04e

The following sections preserve the earlier checkpoint. Their proposed retry was
executed only as described above and is now exhausted; they grant no current retry.


Approved feasibility plan `59e468e` ran through one corrected metadata diagnostic
and one untrusted no-inference readiness attempt. The private TUI skipped trust,
created a native thread and displayed its composer. The driver did not qualify it:
its screen matcher rejected the normal model/workspace status line, then a stale
missing-thread flag mislabelled the stop. The original run remains unknown. Both
defects are fixed against captured evidence offline; no further live attempt ran.
relay-a27e7c remains open, with Task 2 incomplete and the pilot/matrix, production
connector and phone acceptance still owed.

## Native metadata-02

The run lasted 2026-10-29 16:05:22.805–16:05:34.182 UTC (11.378 seconds charged).
It used a fresh private server and access-only authentication, with no TUI, model
turn or app invocation. One filtered `mcpServerStatus/list` request used the
approved 95-second request allowance within the 120-second case limit; the other
metadata calls retained 15 seconds. No directory scan or `app/read` ran.

Core safety/model/preset checks passed: read-only sandbox, on-request approvals,
user reviewer, configured `gpt-6-astra`, and Plan/Default presets. The corrected
projection retained native identifiers, so this time the account-tool observation
is independently auditable:

- The terminal response contains `codex_apps`, with 194 tools, 90 named `linear.*`.
- It advertises `linear.search`, rather than either exact accepted name
  `linear_search` or `mcp__codex_apps__linear_search`.
- The overall result is `unknown: app-prerequisite-unproven`; the app reason is
  `linear-tool-unmatched`, cause `unresolved`. The new name is not an authorized
  alias. Its schema was not retained by the exact-match projection, so neither
  argument compatibility nor operation identity is established. No tool was called.
- This resolves the earlier missing-server ambiguity, not the app-approval gate.
  Source still permits cache paths; metadata is not invocation or approval proof.

Raw evidence: `runs/metadata-02/raw.jsonl`, SHA-256
`dbbef4df94550ab8e12e7f5bff7564291d187736a4180dca83003bac1fd02fba`.
The portable `metadata-02-observations.json` records selected identifiers and
verdicts without copying unrelated catalog metadata into the report. Exact raw
bytes remain private retained evidence. All recorded owned processes were reaped;
private credentials/runtime directories were removed, no source-login change or
refresh request was detected, and cleanup reported no errors. Independent hash,
PID and path checks passed. `canRunPilot(metadata-02)` was true under the approved
core/app separation. Cumulative budget then stood at 265,161 ms/two charged turns.

## Native readiness-01

The run lasted 2026-10-29 16:06:21.563–16:07:42.470 UTC (80.908 seconds charged).
It used `trust_level="untrusted"` for only its canonical private workspace, a fresh
private home/server/TUI and the unchanged access-only authentication boundary.
Core checks and workspace `config/read` with `includeLayers:true` passed before
TUI launch. No trust prompt was seen or answered, and no keystroke or model turn
was submitted.

The retained protocol shows one `thread/started` notification with the expected
cwd and model. After the initial empty loaded-thread list, the same new thread
remained listed. Terminal captures show the native empty composer and footer,
with a model/workspace status line between them. These are observations, not a
complete readiness pass: the driver never reached its required `thread/read` or
lightweight `thread/resume` policy check.

The driver stopped at 40 readiness polls (plus one pre-launch baseline list).
Recorded poll intervals ranged from 500 to 2,002 ms, consistent with the capped
backoff and scheduling overhead. The readiness deadline never reset. The saved
result is `unknown: tui-thread-unobserved`, with zero native turns and clean
cleanup. The original result and capture are unchanged.

Two disposable-driver defects explain that misleading stop:

1. The ready matcher accepted only shortcut/context lines below the empty
   composer. The native `GPT-6-Astra default · <owned-workspace>` status line made
   it reject the composer and fall through to `starting` because the header was
   still visible. This was a classifier/fixture gap, not a Codex protocol finding.
2. An early empty discovery set latched `missingThread` without clearing it when
   the native id appeared. At the poll limit, that stale flag reported missing
   thread rather than unqualified readiness.

Raw evidence: `runs/readiness-01/raw.jsonl`, SHA-256
`e0f43ba0847021e313fc86f2e8265fe947d31d4b6138fa5684858ff32263a2dd`.
`readiness-01-observations.json` separates the original result from this controller
diagnosis. `probe/fixtures/readiness-01-screen.json` preserves the captured frame
with the owned workspace replaced by a named placeholder and its raw-source hash.
The remaining code accepts only the captured status-line shape for the exact
owned path. Independent review then found that the trust substring branch could
bypass extra prompt/modal content. Snapshot r11 fixes this by matching the whole
pinned trust surface, including its native footer; extra content fails closed.
No overlap was observed natively. Model/mode text never
replaces native identity, policy, provenance or Plan-mode proof.

The 44 recorded owned child/command processes were verified gone. Private/runtime
paths were gone, no source-login change or refresh request was detected, and
cleanup had no errors. No process was left running. The trusted fallback did not
qualify, because this was not the exact untrusted trust-prompt outcome. The pilot
and all dependent cases therefore did not run.

## Verification and current driver

Before native execution, ten new missing-behavior tests failed (52/62 passing),
then passed. Two further safety regressions reproduced post-trust app-policy drift
and incorrectly passing an omitted exact schema. The fixes made unsafe app policy
fail readiness and omitted schema leave app unknown. Combined driver/codec/history
checks passed 112/112 on Node 26.5.0 and 22.23.2; repository `just test-fast` passed
773/773 and `just check`/`tasks check` passed. That pre-run driver is snapshot `r9`.

After readiness-01, two regressions reproduced the captured status-line rejection
and stale missing-thread reason. Both went RED→GREEN. The r10 combined checks
passed **114/114 on both Node versions**. The fake screen now includes the observed
status line; snapshot `r10` includes that fixture and the captured-frame regression.
Review of `564bf02` found one Important trust-overlap defect and its plan
consequence. A focused regression reproduced the unsafe classification, then
passed after the whole-screen trust match. It covers extra login, approval and
arbitrary modal content above/below trust at both trust levels, with no fallback
or keys; valid trust still passes. Snapshot `r11` passes **115/115 on both Node
versions**. The retry plan requires verifying this correction and RED→GREEN
evidence before retained admission or another native attempt.

These are offline corrections, not a retroactive native readiness pass. No
executable repository code, dependency, production connector or host setting changed.

The persisted budget is **346,069 ms (5 min 46.1 s), two charged turns**, active
false. This turn added zero model turns. Only the earlier pilot-01 Default control
is an observed native model turn; its unobserved bootstrap reservation remains
charged. The earlier 40-second diagnostic charge remains included. No refund,
budget extension or extra live attempt was taken.

## Offline Plan-screen correction after review of 408dd93

The incoming review correctly predicted that the post-`/plan` composer would be
rejected. Pinned `status_controls.rs:460–467` and `status_surfaces.rs:988–1006`
confirm effort formatting: absent/None is `default`, while the Plan preset's
Medium becomes `medium`. The Plan indicator is right-aligned beside the status
row in the fullscreen source snapshot, with `⇧tab` as the rendered key label;
its shortcut footer remains below. The fetched footer SHA-256 is
`cba851759c13f631ed95bbb243f36d4c70e7f7f28c991f8bf14a5b5fc19a0a1d`, matching
the reviewer's prefix. Source hashes and the audit are in `plan-screen-source.json`.

Snapshot `r12` accepts this source-derived decoration for the exact owned
workspace. It preserves whole-screen trust matching, modal/startup precedence,
empty-composer admission, native thread/policy checks, and independent question
provenance/mode/receipt checks. A synthetic post-`/plan` frame now drives the fake
pilot; it is not presented as a native Plan capture. Four focused checks went
from **1/4 to 4/4**, including a post-Plan modal refusing question input/charge.
Combined driver/codec/history checks passed **119/119 on Node 26.5.0 and 22.23.2**.
The repository code is unchanged; its prior 773/773 result remains the baseline.

An offline recursive inspection of the hashed `metadata-02/raw.jsonl` found the
`linear.search` entry at line 8, decoded message/result/data/0/tools/linear.search.
It contains only `name`; no schema survived that projection. We cannot decide
whether it admits the approved arguments from these bytes. The r12 projection
will retain this one additional exact schema in a future separately authorized
metadata run, but app admission still accepts only the previously approved exact
names. A fake regression verifies the schema is retained while the verdict stays
`linear-tool-unmatched`, with no app/read or model turn. This amendment authorizes
neither another metadata run nor invocation/substitution of `linear.search`.

No native operations ran during these corrections. Budget remains 346,069 ms and
two charged turns; all earlier native results and their hashes are unchanged.

## Gate disposition

| Spec gate | Current evidence and remaining obligation |
| --- | --- |
| 1: transport and join | Private transport/auth/core checks remain proved; native untrusted TUI startup and one thread observed. Required thread/read/resume readiness, join and subscription isolation remain unproven. |
| 2: clarification-only routing and forms | Unknown. Native `linear.search` name observed, but exact authorized operation/schema and real app approval unproved; no Plan question/provenance/forms or other exclusion controls. |
| 3: receipt and races | Unknown; no exact native answer/result correlation, race, cleanup-only resolution or delayed receipt. |
| 4: defer | Unknown; no native handback observation. |
| 5: reconnect/restart | Unknown; no replay barrier, generation proof, stale-answer rejection or no-client recovery. |
| 6–7: production and phone | Later obligations; not attempted or waived. |

## Proposed next attempt, separately reviewed

The companion feasibility-plan revision prepares one fresh **readiness-02** with
untrusted and the corrected matcher. It reuses the verified metadata-02 core/app
verdict instead of repeating metadata. Each fresh case still repeats its own
safety/model/auth checks. Only the original exact untrusted trust-prompt outcome
could admit one trusted **readiness-03**; every other required failure/unknown stops.
Only a complete readiness pass admits the still-unrun **pilot-02**, once. Its
native provenance/mode/exact receipt pass remains required for later cases.

Why: the defect is localized and reproduced using the actual frame, while native
untrusted startup already avoided the prior trust blocker. Cost if wrong: another
bounded readiness run can remain unknown and consume up to its 120-second case
allowance, with no model turns; the unchanged remaining 30-minute/30-turn budget
still applies. Rejected alternatives are an unlisted immediate retry, relaxing
native readiness proof, and repeating the successful metadata diagnostic. No new
app name, operation or arguments are authorized by this proposal.

The new frozen plan needs user review before any further native run. Preparing it
alongside this report makes that review concrete; it does not treat the earlier
approval as retry permission. The parent and Task 2 stay open, Task 1 stays done,
and Task 3 retains the evidence/next-artifact obligation. `feat/codex-question`
stays unmerged in `.worktrees/codex-question` until the connector, native gates and
user-present phone answer/defer acceptance are complete.

## Retained history

The task retains native metadata-02/readiness-01 bytes, observations, captured
fixture, r9/r10/r11/r12 driver snapshots, RED/GREEN logs and full reviews. Prior report
`6d0751d` records metadata-01's omitted response and pilot-01's trust interruption;
`f4c5448` records the inventory page-limit stop; `aac3954` records the earlier
transport/inventory correction. Approved spec `741a546` still governs all gates.
The previously overlooked hq-d85ede transport/mode evidence stays acknowledged;
shared listener source does not establish live/private lifecycle equivalence.
