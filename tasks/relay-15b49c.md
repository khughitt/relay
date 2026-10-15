---
id: relay-15b49c
title: Codex adapter applies worker hook events (agent_id present) to the controller's row
status: done
priority: 2
size: s
complexity: mid
process: direct
created: 2026-10-15T09:27:07Z
updated: 2026-10-15T10:55:52Z
completed: 2026-10-15T10:55:52Z
depends: []
parent: relay-eaca0e
tags: []
source: relay-ed3f00
agent: claude-code/claude-opus-5-5
---

Why: relay-ed3f00's capture (Codex 0.162.1, brief §7) shows a worker's PreToolUse/PostToolUse (and presumably PermissionRequest) carry the root session_id plus agent_id. src/adapters/index.js keys rows by session_id alone, so a worker's events update the controller's row. Harm: a worker still running after the controller's Stop flips the root row from done back to working (or needs-approval) until the controller's next event; while the controller sits in wait_agent the error is invisible. Holds whichever relay-6825f7 alternative is chosen.
Done: the Codex adapter never changes the root row's state from an event carrying agent_id; under alternative 1 it routes such events to the worker row, under alternative 3 it ignores them (or reports them as worker activity without a state change). Tests use a payload fixture shaped like brief §7 rows 7-8. Must land before Codex hooks are cut over (hq-539508).
Where: src/adapters/index.js, src/adapters/codex.js, docs/notes/2026-10-12-codex-worker-registration-brief.md §7.

## Notes

- 2026-10-15T09:27:20Z (main): concerns: relay-ed3f00 extension — capture exposed worker events reaching the root row
- 2026-10-15T10:02:26Z (main): Subsumed by  (approved spec docs/specs/2026-10-15-codex-worker-rows.md routes agent_id events to worker rows); close with it.
- 2026-10-15T10:02:51Z (main): correction to the previous note: the subsuming task is relay-635fdc
- 2026-10-15T10:55:52Z (relay-6825f7): done
  provenance: {"harness_session":"claude-code:783163fb-6924-41d7-a9d8-63a7fc5cb315","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-15T10:55:52Z (relay-6825f7): Worker events now update their own codex:<agent_id> row (scope worker); the root row is untouched, pinned by the background-worker test in test/transaction.test.js (relay-635fdc Task 3).
  provenance: {"harness_session":"claude-code:783163fb-6924-41d7-a9d8-63a7fc5cb315","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
