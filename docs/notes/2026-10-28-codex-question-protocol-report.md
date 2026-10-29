# Codex question connector: readiness stopped on a driver classifier defect

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
