# Codex question connector: pilot stopped at private-folder trust

Plan `91c1c14` satisfied Keith's conditional approval of the deadline correction
and was frozen before execution. Its one metadata attempt completed in 9.7 seconds;
core safety/model/preset checks passed, while app evidence remained unknown. The
approved independent pilot then ran one native Default control turn successfully,
but the private TUI stayed at its folder-trust prompt. The controller stopped the
owned driver without accepting that prompt. No question or answer receipt was
observed. relay-a27e7c remains open; the seven dependent cases, exclusions,
production connector and user phone acceptance remain owed.

## Deadline and source audit

Only the filtered metadata `mcpServerStatus/list` receives 95 seconds. Every other
metadata request retains 15 seconds, the case retains 120 seconds, and the
aggregate allowance remains 30 minutes/30 turns including cleanup and metadata.
The tagged `rust-v0.165.0` source gives client creation, initialization and initial
tool listing separate 30-second bounds. No end-to-end request bound was established;
95 seconds is the approved precedent, not a native guarantee. Ordinary MCP calls
retain their default deadline. The historical inventory path is not run again.

The source audit records exact URLs, hashes and line references in
`app-auth-audit.json` and `source-0.165.0/sources.json` on the task. Host-owned
`codex_apps` requires the Apps feature and `uses_codex_backend`; both managed
ChatGPT and access-only ChatGPT tokens satisfy that backend predicate. Apps is
stable/default enabled. Thus external-token login alone is not an established
cause of missing tools. Backend entitlement, cache and account-specific exposure
remain unresolved; no managed-login comparison or feature/config repair ran.

Threadless status collection creates an eager filtered connection, captures its
snapshot and cancels its manager. Tool listing can use cached catalog data in some
paths, so successful discovery alone must not be generalized into live invocation
proof. The reviewer's live-config observation remains attributed to
claude/claude-opus-5-5, not independently verified effective state.

## Native metadata-01

The run lasted 2026-10-29 14:10:09.009–14:10:18.709 UTC. Private `initialize` and
access-only login succeeded on Codex 0.165.0. Exactly one filtered MCP request was
sent at 14:10:11.568; its processing completed at about 14:10:16.344, within both
the old and new bounds on this attempt. Then `config/read`, one `model/list` and
`collaborationMode/list` completed. There was no directory scan, `app/read`, TUI,
thread creation, model turn or app invocation in this case.

- Retained config proves read-only sandbox, on-request approvals and user reviewer.
  The selected `gpt-6-astra` model was returned. Plan/Default presets were returned
  with null model fields, so the configured model supplies the value. Default's
  effective settings were subsequently checked in the pilot.
- The driver's in-memory classification reported `linear-tool-unmatched`, cause
  `unresolved`. Its overall result is `unknown: app-prerequisite-unproven`; this is
  not a passed app inventory or gate-2 result.
- **Evidence limit:** the existing credential-vocabulary filter omitted the entire
  MCP response from capture. Its original tool names, schemas and count are not
  available for independent inspection. Therefore the reported unmatched result
  is a driver observation, not independently auditable native absence. Do not
  conclude that Linear is disconnected, absent from the account, or incompatible.
  The exact triggering content was not retained and cannot be reconstructed.
- The remaining core responses were retained. The explicit `canRunPilot` check
  returned true after evidence hashes and cleanup were independently verified.
  Missing app evidence was the sole allowed exception; core safety did not rely on
  the omitted MCP response. This follows the approved sequencing change.

No refresh request or change to source login was detected. Owned processes
2463447 and 2463379 were reaped and private/runtime directories removed, without
cleanup errors. The budget after this case was 138,471 ms and zero turns.

## Native pilot-01

The run lasted 2026-10-29 14:11:00.336–14:12:55.647 UTC. Its fresh core checks
passed before inference; it did not query MCP or depend on app availability.

- One native `turn/start` was sent for the Default `READY` control. Native
  `turn/started` arrived at 14:11:06.267 and `turn/completed` at 14:11:16.337 with
  status `completed` and no error. Lightweight `thread/resume` confirmed effective
  Default mode, `gpt-6-astra`, and server-supplied Default instructions.
- Private tmux/TUI startup did not yield a second loaded thread. The driver sent
  its planned startup keystrokes and reserved a second turn for the bootstrap
  prompt, but no second native turn was observed. The polling loop made 1,940
  `thread/loaded/list` calls; none established the TUI thread. This polling is
  bounded by the case deadline but is unnecessarily frequent and does not prove
  terminal readiness.
- A read-only capture of this run's owned private tmux pane showed **Folder access:
  Trust this folder?**, offering trust-and-continue or return to the command center.
  The controller sent no answer to that prompt. No Plan question, built-in
  provenance, native answer, correlated receipt, defer or recovery was observed.
- The controller sent SIGTERM to the exact owned driver, PID 2487177, rather than
  consume the remaining case allowance at a known trust prompt. The saved verdict
  remains `unknown: interrupted`, exit 130. The separate controller observation is
  a private-TUI onboarding blocker; it is not a finding that the native question
  protocol is unsupported, nor a rewritten driver reason.

Cleanup succeeded: owned processes 2491932, 2491931, 2491930, 2491925, 2491889,
2491888, 2487229 and 2487187 were reaped. No survivors, private credential directory,
runtime socket directory or tmux server remained. Raw/portable evidence and the
terminal-capture hashes were independently verified. No live daemon or desktop
was used, and no source-login change was detected.

The cumulative persisted budget is **253,783 ms (4 min 13.8 s), two charged turns**,
active false. Only **one native model turn** was observed; the unobserved TUI
bootstrap reservation stays charged conservatively. The earlier 40-second
conservative diagnostic charge remains included. No extension or retry is taken.

## Driver verification and capture correction

The metadata/admission regressions failed 8 of 50 before implementation and passed
50/50 afterward. Further policy tests reproduced acceptance of automatic `auto`
app approval, then made `auto`, `writes` and `approve` fail the core safety check.
Combined driver/codec/history checks passed 97/97 on Node 26.5.0 and Node 22.23.2
before native execution; repository `just test-fast` passed 773/773.

After inspecting the omitted MCP capture, a synthetic tool description mentioning
credential vocabulary reproduced the evidence loss. A small logging correction
now retains a labelled projection of native server/tool identifiers, auth/runtime
status, error/cache metadata and matching input schemas, omitting unrelated tool
prose. It keeps the original response in memory for validation and keeps the
credential filter in place. This test does not establish which field triggered the
native omission. The original evidence remains unchanged; no native retry followed.
Final combined checks passed 98/98 on both Node versions. The source snapshot
and verification logs are attached as `r8` evidence.

Task 1 (relay-dc1f42) remains done with its earlier private transport/initialize
proof. Task 2 (relay-01090a) remains incomplete at this native pilot blocker.
Task 3 (relay-4746ed) records this disposition; no production plan is fabricated.
No executable repository code, runtime dependency, production connector or host
setting changed. All driver edits remain disposable retained probe code.

## Gate disposition

| Spec gate | Verdict and missing native evidence |
| --- | --- |
| 1: transport and join | Partial: private transport/initialize, access-only auth, core metadata and Default control/resume observed; TUI discovery, join and subscription isolation unproven. |
| 2: clarification-only routing and forms | Unknown: no Plan question/provenance, forms, secret/Default-async exclusions, app approval or dedicated permission control. MCP response omission also limits independent app diagnosis. |
| 3: receipt and races | Unknown: no exact native answer/result correlation, competing orderings, cleanup-only resolution or delayed receipt. |
| 4: defer | Unknown: no native handback or unchanged pending turn observation. |
| 5: reconnect/restart | Unknown: no pending replay, reconciliation barrier, daemon-generation proof, stale-answer rejection or no-client recovery. |
| 6–7: production and phone | Not attempted: implementation/integration and user-present phone answer/defer remain later obligations. |

The pilot did not pass, so `join`, `forms`, `race`, `clear`, `defer`, `reconnect`,
`restart` and exclusions did not run. All five native gates remain required before
production planning/activation; app unknown never becomes a pass. The source mode
rule still needs the Plan positive control and matching built-in provenance.
Receipt search bounds and incoming-message sizing remain probe values, with no
new native history evidence to justify production values.

## Next decision

Recommend a narrowly revised feasibility plan that handles trust for **only the
fresh owned private workspace**, verifies TUI readiness before submitting `/plan`
or counting a bootstrap turn, and bounds discovery polling explicitly. It should
first test trust/readiness behavior without inference, then reattempt the pilot
once within the remaining original budget. Any trust configuration belongs only
to the disposable private home and needs that new frozen plan's review; this run
neither accepted trust nor repaired settings. Keep app evidence separate and
unknown until it is actually observed. Verify the revised capture with fake
processes before any separately approved native metadata retry.

Why: the observed blocker occurs before the TUI question path, while the native
Default control and core safety checks already work. Cost if wrong: another
bounded pilot may expose a different onboarding or protocol blocker and consume
more of the existing allowance. Rejected alternative: continue polling or resend
keystrokes through an unclassified trust prompt; neither proves readiness and
could accept an unintended native prompt. Changing the protocol gates or making
`isBlocking` alone sufficient is not proposed.

The parent stays open and `feat/codex-question` stays unmerged in
`.worktrees/codex-question`. The next owner revises the feasibility plan after
review of this blocker; a separate frozen plan review precedes any retry. Local
integration waits for the actual connector, native gates and phone acceptance.

## Retained evidence and historical context

The task owns exact raw runs `metadata-01` and `pilot-01`, their portable results,
source audit and hashes, driver/test snapshot `r8`, RED/GREEN verification logs and
full reviews. Portable terminal evidence substitutes the owned run path; the raw
capture remains hashed under `runs/pilot-01`. `protocol-contract-report.md` in
scratch mirrors this report. No original omitted response is claimed to exist.

Prior report `f4c5448` records inventory-03's 44.2-second first response and
incomplete ten-page directory scan. `aac3954` records the earlier timeout blocker;
`741a546` preserves the transport correction and mode-evidence candidate. The
previously overlooked hq-d85ede Unix-WebSocket/Plan-only evidence remains
acknowledged. Shared listener source does not establish live/private recovery
equivalence. No earlier unknown is promoted to a pass by this report.
