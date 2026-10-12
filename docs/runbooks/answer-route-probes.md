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
