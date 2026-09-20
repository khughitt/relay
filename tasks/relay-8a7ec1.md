---
id: relay-8a7ec1
title: Declare relay's command table and conform to the shared CLI vocabulary
status: done
priority: 2
size: s
complexity: low
process: direct
owner: main
created: 2026-09-20T11:30:32Z
updated: 2026-09-20T14:09:27Z
started: 2026-09-20T13:50:07Z
completed: 2026-09-20T14:09:27Z
depends: []
tags: [cli, cross-project]
agent: claude-code/claude-opus-5
---

Adopt the shared CLI vocabulary: vendor tools/cli.toml (and tools/cli_surface.py), make the parser conform, add the conformance test. The steps are Task 12 in the ops plan docs/plans/2026-09-20-cli-conventions.md (spec docs/specs/2026-09-20-cli-conventions-design.md). Waits for the ops table task ops-c9ecf0 to land on ops main; the ops step ops-67a039 tracks this piece.

## Notes

- 2026-09-20T13:50:07Z (main): started
  provenance: {"harness_session":"claude-code:20e55bde-4aed-4a6f-993d-b44b058f509f","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-20T14:09:27Z (relay-8a7ec1): done
  provenance: {"harness_session":"claude-code:20e55bde-4aed-4a6f-993d-b44b058f509f","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-20T14:09:27Z (relay-8a7ec1): Vendored tools/cli.toml and tools/cli_surface.py; declared src/commands.js; bin/relay.js now has per-command help, help routing, -V/--version, global --json/--pretty/RELAY_FORMAT output mode (list honours it, install defaults to json, rollback is silent), and table-driven --harness/--retire enum validation; usage errors exit 2. Added test/cli-surface.test.js and updated test/cli.test.js, test/install-cli.test.js, test/pack.test.js, docs/api.md for the new contract.
  provenance: {"harness_session":"claude-code:20e55bde-4aed-4a6f-993d-b44b058f509f","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
