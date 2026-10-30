# Answer route probes

Re-run when Claude Code changes version before installing or reinstalling the
`relay ask` route (spec [typed interaction messages](../specs/2026-10-11-typed-interaction-messages.md) §2, §11).

Start with the smallest end-to-end pilot and read its hook log, terminal capture,
summary and cleanup before running the longer cases:

```sh
node tools/answer-probe/run.mjs --out /tmp/answer-probe-pilot --only hook-answer
node tools/answer-probe/run.mjs --out /tmp/answer-probe-deny --only deny
node tools/answer-probe/run.mjs --out /tmp/answer-probe-release --only release
node tools/answer-probe/run.mjs --out /tmp/answer-probe-under-denial --only under-denial
```

Use fresh output directories. Without `--only`, the driver runs all four scenarios.
The driver accepts only `--out DIR` and `--only NAME`, each at most once; a missing,
empty or flag-shaped value, unknown flag or unknown scenario is refused before
external tools run or output directories are created. Without `--out`, a fresh
temporary output directory is generated.
The private tmux server (`tmux -L relay-probe`) opens no desktop window and takes no
focus. The driver refuses an existing server, uses scratch `--settings` files and
reaps its Claude/hook processes on exit, SIGINT and SIGTERM. Check `cleanup` in the
summary: no survivors and `tmuxRunning: false`. Raw logs and captures are private
and may contain session ids and paths; keep them outside git. No live configuration
is changed. Scratch settings merge with the user's settings, so their hooks still
run; a guard denying `AskUserQuestion` invalidates the run.

| Evidence row | Pass condition |
| --- | --- |
| `answer-hook-terminal` | One PreToolUse fired and one allow return in hook-answer; terminal replies `CHOSEN=Square`. |
| `answer-hook-deny-stops` | Deny return, no chosen label, and no second PreToolUse during the 60-second watch. |
| `answer-release-native` | Release return has no decision; a later native option list is answered in the terminal, resulting in `CHOSEN=Square`. |
| `answer-receipt-observed` | Both hook-answer and release have a matching Pre/PostToolUse id and a PostToolUse answers map. Record its path and the return-to-receipt delays. |
| `answer-hook-under-denial` | Record whether the blocking hook was killed, awaited or left running, and whether PostToolUse fired. This row gates nothing. |

The prompt itself names the labels, so the release driver waits for the hook return
and then the native `2. Square` list. It records each key and the native capture. If
UI driving fails, inspect readiness, trust and authentication before judging P1;
a missing native answer from unsent keys is not capability evidence. Every manual
key must be recorded. Never patch the installed harness to force a result.

Write real observations to `docs/evidence/claude-code-answer-routes.json`; the
installer reads the file named by `--evidence`. Keep previous records in git history.
A failed terminal-answer or deny-stops row stops route implementation for a user
decision. Failed release omits handback; failed receipt omits PostToolUse installation.
If answers live elsewhere in the real receipt, adapt the adapter to that observed
path. Do not invent a receipt fixture when no PostToolUse event was observed.

Build the receipt fixture from the actual hook-answer PostToolUse log, with fixed
session id `00000000-0000-4000-8000-000000000000`, transcript `/tmp/x.jsonl`, cwd
`/tmp/ws` and tool id `toolu_fixture`, preserving its tool input and response.


## Codex connector: receipt and lifecycle probes

The [current connector contract](../specs/2026-10-28-codex-question-connector.md)
and [all-gates report](../notes/2026-10-28-codex-question-protocol-report.md)
cover the disabled-by-default production route and preserved private controls.
0.165.0 has no atomic loaded-only join. The accepted detected residual selects
only Active+WaitingOnUserInput through full admission; a qualifying first replay
is required, and reconnect requires the stored exact tuple. No replay or changed
replay means immediate unsubscribe, content-free `CODEX_JOIN_RACED`, no send or
publication, and no retry of that waiting episode. No timing minimum is inferred
from merged config or a latency sample. The private short-override control must
exercise a real cold resume, detection, release and normal subsequent unload;
controlled delivery lag demonstrates the schedule, not its production frequency.

The production private pilot uses the actual worktree `relay serve`, exact native
binary, real Linux process/listener qualification, isolated registry and durable
inbox, with no injected identity/evidence. Prove one saved answer reaches the
scripted model and becomes consumed; then defer a new question and prove the
native answer reaches the model and released history. Check auto-attached helper
release, public metadata exclusion, no extra turns and owned cleanup. Use
`list` with `since: 0` when counting retained terminal histories: the default list
contains only active entries. Preserve failed attempts and their original verdicts.
This scripted client does not establish Gate 7 phone rendering or human acceptance.

Use the exact pinned 0.165.0 executable, private homes with no auth file or
credentials, and the local scripted Responses provider. Verify source/protocol
pins before running. Keep failed runs and a single directory manifest/hash per
checkpoint. No live daemon, shared launcher, desktop or subscription turn belongs
to these probes. Build subprocess environments from explicit safe keys, retain
owned process ids, and inspect cleanup before another run.

A saved phone answer can lose to the native UI: relay serializes its own answers,
but saving does not lock Codex. Only the actual exact-call rollout answer map,
compared by full native value AND accompanied by an observed exact protocol turn
terminal, confirms consumed. Resolution, client order and
elapsed time do not identify the winner or establish receipt. Preserve native
string arrays in observations. Native unanswered submission is a per-question
empty array (`{"answers":{"q_color":{"answers":[]}}}` in the fixed capture),
not relay decline (`{"answers":{}}`). The former cannot confirm the latter.
Empty-root receipt is value-only: errors and receiver/deserialization failures
can produce the same value, so never attribute its cause or winning client.

A positively identified built-in with an observed exact protocol request settles
without an answer only when its non-answer string output is followed in file
order by the matching turn-end barrier AND the exact protocol turn is terminal.
No output text grammar identifies cancellation. Missing either channel, an earlier
barrier, structured output or invalid reader state stays unknown. The separate
no-output disappearance case also requires matching protocol and rollout turn-end;
EOF and elapsed time do not suffice. Resolution revokes sends immediately.

Before handoff, a proven end without an answer means asker-gone when pending and
undeliverable when saved. After handoff it stays unconfirmed: in this case that
means a known end without an answer, the saved answer did not reach the model,
and it must never be retried to that tuple. Other unconfirmed cases retain their
absent/mismatching/unknown receipt meaning. A matching late actual output with the observed exact protocol terminal may
confirm receipt; no synthetic history entry can do so.

Validated daemon replacement independently settles pending -> asker-gone and
saved-unhanded -> undeliverable; handed remains unconfirmed unless actual matching
output and the observed exact protocol terminal establish receipt. Do not require an old protocol terminal for replacement lifecycle.
Socket loss, local generation counters or a changed RPC id alone prove no
replacement. Production tests cover these lifecycle rules; the probe reader
alone supplies no lifecycle authority and cannot invent receipt.

For an unloaded control, set root `thread_unload_delay_secs = 2` only in the
private home. The production default is 1800 seconds (30 minutes), after both no
subscribers and inactivity. Prove complete loaded absence before native-controller
restoration and outside rejoin; unsubscribe alone is insufficient. For private
TUI controls, name the primary before submission, preserve the exact native
answer/unanswered outputs, and require zero outside responses. The automatic
second start is an ephemeral `thread_title` feature with tools disabled; production
discovery must ignore the TUI's exact ephemeral feature set, `system` and
`thread_title`, without renaming user threads. Unsubscribe after a selected question settles and its turn end is seen; a live
registry row alone never justifies holding an idle thread. Release unselected
auto-attached threads immediately, retaining no content. Rollout observation
may continue after unsubscribe, but without the exact protocol turn transition
matching output leaves handed answers unconfirmed. Provenance waits at most five
seconds for the earlier call line; expiry stays unidentified/native.

Oversized lines/files, unowned or changed rollout files and ambiguous provenance
stay native. Other tool outputs are discarded in every shape; duplicate hashes
are private in-memory derivatives and must never enter logs or retained evidence.
Gate 7 and integration require separate approvals after production automated gates.
