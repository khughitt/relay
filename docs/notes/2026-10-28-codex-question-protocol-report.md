# Codex question connector: native app availability remains unproven

The single inventory attempt authorized by plan `ccd0a75` completed with
`unknown: inventory-page-limit`. The longer timeout worked: the first `app/list`
response arrived after about 44.2 seconds. Discovery then stopped after ten pages
of 100 entries while the server still advertised another page. No model turn,
TUI, app operation or native question ran. relay-a27e7c remains open; production
implementation and phone acceptance remain owed.

A captured update contains 5,025 directory entries, including one named `Linear`
with `isAccessible: false` and `isEnabled: true`. This harness's tool catalog still
exposes `mcp__codex_apps__linear_search`. Neither observation establishes that the
directory entry is the same connector as the authorized search, or why the private
server and harness differ. Do not infer that the user's account is disconnected,
that installing an app is necessary, or that native question routing is unsupported.

## What changed and passed

The approved amendment changed only the research driver's request-local RPC timer,
the inventory `app/list` call site, and the inventory case deadline. Inventory
`app/list` gets 95 seconds; ordinary calls, including `app/list` without the
explicit inventory override, retain 15 seconds. The inventory case gets 120
seconds and its harness limit includes 60 seconds for cleanup. The cumulative
30-minute/30-turn budget and all other safeguards remain unchanged.

Five new tests exercise late matched responses, rejection of partial-update
substitutes, exact timeout boundaries, the scoped call site, and case/aggregate
budget precedence. Four missing-behavior assertions failed before implementation;
the aggregate-reserve control already passed. Verification after the change:

- Combined research-driver suite: 87/87 on Node 26.5.0 and 87/87 on Node 22.23.2.
- Repository `just test-fast`: 773/773.
- Prior driver corrections remain covered: exact persisted-capture accounting,
  bounded failure verdicts, independent cleanup after filesystem errors, and
  conservative validation of the exact approved Linear arguments.

Task 1 (relay-dc1f42) stays complete. Its native `transport-01` handshake and
`initialize` proof, captured-wire fixture provenance and scoped review acceptance
remain valid for that prerequisite. Synthetic pilot/history/cleanup tests still
do not establish native question capability. The latest source snapshot is `r7`
for `run.mjs`, `probe.test.mjs` and `cases.json`; unchanged modules retain their
previous snapshots. No production connector, API, dependency or live setting changed.

## Native inventory-03 evidence

The run lasted from 2026-10-29 12:08:20.578 to 12:09:16.088 UTC on Codex 0.165.0.
The initialize user agent again identified 0.165.0 and the owned private home.
Access-only login completed successfully; no refresh request was observed.

- First `app/list` sent at 12:08:23.614; its matching response arrived at
  12:09:07.800. Thus the previous 15-second deadline would have stopped this run.
- Ten responses each contained 100 entries, with successive cursors `100` through
  `1000`. The tenth still had `nextCursor: "1000"`; the driver returned
  `inventory-page-limit`, rather than claiming the catalog ended.
- The earlier update at 12:08:28.775 contained eight entries, all accessible.
  The later update at 12:09:07.507 contained 5,025 entries, two marked accessible.
  These are distinct captured updates, not a count of the user's connected apps.
- In the later update, the exact-name `Linear` entry had id
  `asdk_app_69a089a326dc8191b32a3f2553f5be2c`, `isAccessible: false`, and
  `isEnabled: true`. No exact-name Linear entry occurred in the ten returned pages.
  Neither the notification nor a name match proves identity with the approved tool.
- The driver never reached `mcpServerStatus/list`, `config/read` or `model/list`.
  The authorized native tool name/schema, effective prompt policy and selected
  model's availability therefore remain unverified. The configured model remains
  `gpt-6-astra`; no substitution was made.
- Tool discovery in this harness still advertises `linear_search`, `linear_fetch`
  and `linear_search_documentation` under `mcp__codex_apps__`. These names were read
  as metadata only; none was invoked and no account content was fetched.

The large update was inspected offline after cleanup. It does not turn the stopped
case into a passed inventory: the required native tool, schema, model and policy
observations are missing. The ten-page bound is an implementation limit of the
discovery driver, distinct from the plan's ten-page receipt-history lookup.

Cleanup passed with no errors: owned processes 3942981 and 3942922 were reaped,
no survivors were recorded, and the private credential/runtime directories were
removed. Their absence and the evidence hashes were independently rechecked.
No source-login change was detected. No live daemon socket or desktop was used.
The persisted budget is **128,769 ms and zero turns**, an additional 55,513 ms,
including cleanup, since the prior checkpoint. The earlier conservative
40-second diagnostic charge remains included. No budget extension is requested.

## Gate disposition

| Spec gate | Verdict and missing native evidence |
| --- | --- |
| 1: transport and join | Partial: private handshake/initialize/cleanup passed; ordinary TUI discovery, early/late join, settings preservation, lightweight native history and subscription isolation unobserved. |
| 2: clarification-only routing and forms | Unknown: native built-in provenance, Plan positive control, Default/async and secret exclusions, app approval, dedicated permission example/path audit, forms and decline unobserved. |
| 3: receipt and races | Unknown: exact accepted-answer result mapping, desktop/client orderings, cleanup-only resolution, mismatch, interruption and delayed receipt unobserved. |
| 4: defer | Unknown: native handback and unchanged pending turn unobserved. |
| 5: reconnect/restart | Unknown: pending replay, authoritative reconciliation completion, daemon generation, stale-answer rejection and no-client recovery unobserved. |
| 6–7: production and phone | Not attempted: production fixture/integration suite and user-present phone answer/defer belong to later work. |

There is still no established native answer mapping, decline encoding, receipt
extractor, late-join source, replay barrier, daemon-generation discriminator or
same-call retry rule. Source-based mode evidence remains a candidate requiring
native built-in provenance and a Plan positive control. Previous-turn mode and
model silence still prove nothing. No native history samples justify choosing a
production receipt-search bound or incoming-message cap.

## Recommended next decision

Prepare a focused read-only metadata diagnostic before another full inventory:
inspect native MCP tool metadata and effective configuration first, then use
specific app metadata to determine whether the authorized Linear search is
available to this private 0.165.0 server and how it is identified. Do not make
completion of a 5,025-entry general directory scan the first prerequisite to
learning which tools are exposed.

The saved 0.165.0 protocol provides `mcpServerStatus/list`, `config/read`, and
`app/read`. `app/read` takes `appIds` (at most 100) and optional `includeTools`;
its public tool summaries are explicitly display-only, so they cannot replace
an authoritative native tool schema or prove invocation availability. The observed
directory id is only a candidate to inspect, not an established connector mapping.
A revised plan must specify the exact metadata requests, positive identity/schema
checks, fixed bounds and the point where unavailable/ambiguous evidence stops it.
It must retain the same access-only auth, capture limits, cleanup and aggregate
budget, and start no model turn or app operation during that diagnostic.

Why this recommendation: captured evidence already exposes a native-versus-harness
metadata discrepancy, while increasing the page count alone cannot establish
connector identity or availability. Cost: a diagnostic may show that the current
private topology cannot expose the approved tool without a separately reviewed
configuration change. No compatibility conclusion is assumed here.

Alternatives are to keep the task blocked, or have the user choose a different
concrete app probe after its identity and safety are established. Installing or
connecting an app, copying live login state, changing account settings, accepting
an approval, substituting tools/arguments, or weakening the native capability gates
is not authorized. The existing exact Linear search/decline approval persists.
No second attempt or new diagnostic was run after `inventory-03`; plan `ccd0a75`
explicitly stops on another incomplete inventory.

Task 2 (relay-01090a) remains incomplete. Task 3 (relay-4746ed) produces this blocker
report, with no guessed production plan. The parent stays open and the branch
stays unmerged until the connector, required native gates and phone acceptance
are complete. The owner prepares a revised diagnostic plan after the user's
decision, for its separate frozen review.

## Retained evidence and earlier decisions

relay-a27e7c owns the raw task scratch, plan workspace and portable attachments.
`inventory-03-evidence.json` maps every page and update to timestamps, preserves
selected metadata and the budget, and records the raw result/capture hashes.
`inventory-03-result.json` is a portable result attachment with the runtime path
substituted. Exact raw files remain under retained `runs/inventory-03`; the complete
updates are not replaced by the bounded summary. `protocol-contract-report.md`
is the task-scratch copy of this report.

Attachments `r7-run.mjs`, `r7-probe.test.mjs`, `r7-cases.json` and
`timeout-r5-{red,green,dev,node22,fast}.log` preserve the timeout change and tests.
Earlier r4/r6 snapshots, native transport captures, RED/GREEN safety corrections,
full reviews, source hashes and generated 0.165.0 protocol remain retained.

Report `aac3954` records the previous timeout blocker and corrected driver.
Report/spec `741a546` preserve the earlier mistaken JSON-line proxy premise and
its correction. hq-d85ede had already recorded Unix WebSocket and Plan-only
blocking on 0.162.1; that overlooked evidence remains acknowledged. Tagged
common-listener evidence proves transport selection, not managed/private
lifecycle equivalence. No earlier native unknown is promoted to a pass here.
