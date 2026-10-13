---
id: relay-fb5d24
title: "relay ask and relay hook exit 2 on an invalid RELAY_FORMAT, which Claude Code treats as a blocking hook error"
status: todo
priority: 2
size: s
complexity: low
process: direct
created: 2026-10-13T18:15:17Z
updated: 2026-10-13T18:15:17Z
depends: []
tags: []
source: "review:89cdecb"
agent: claude-code/claude-opus-5-5
---

Why: `resolveMode` (src/commands.js:50-54) runs at bin/relay.js:93, before the `ask` and `hook` branches. When RELAY_FORMAT is anything other than json or pretty, it throws USAGE and both hook commands exit 2. Claude Code treats a PreToolUse exit 2 as a blocking error. So a stray RELAY_FORMAT blocks every AskUserQuestion under `relay ask`, whose contract is "exits 0 on its own runtime failures" (spec §9.1; ruling F29 moved socket-path errors under the passthrough boundary for the same reason). It also blocks every tool behind `relay hook`. The `hook` case predates 89cdecb.

Reproduced on main d770ced, 2026-10-13:
- `echo '{}' | RELAY_FORMAT=yaml node bin/relay.js ask --harness claude-code --handback PreToolUse` exits 2.
- `echo '{}' | RELAY_FORMAT=yaml node bin/relay.js hook --harness claude-code PreToolUse` exits 2.

Approach: the protocol commands (`hook`, `ask`) do not read RELAY_FORMAT, because their stdout is the harness reply, not relay output. Skip resolveMode for them. This is not a fallback: the variable has no meaning for them. Argv usage errors keep exiting 2.

Done:
- Tests run both commands with RELAY_FORMAT=yaml. `ask` exits 0 and passes the question through to the native UI. `hook` behaves as it does with RELAY_FORMAT unset.
- `just test-fast` passes on Node 22 and the dev runtime.

Where: bin/relay.js:93-95, src/commands.js:50, test/cli-surface.test.js or test/routes-ask.test.js.
