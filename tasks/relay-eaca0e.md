---
id: relay-eaca0e
title: Register Codex workers in the relay registry
status: done
priority: 2
created: 2026-10-13T01:33:22Z
updated: 2026-10-15T13:23:06Z
completed: 2026-10-15T13:23:06Z
depends: []
tags: []
source: docs/notes/2026-10-12-codex-worker-registration-brief.md
agent: claude-code/claude-opus-5-5
---

Codex workers share their controller's process and session_id, so relay publishes only a root row and tasks refuses it for a worker's relay claim. Give a worker its own relay identity with liveness consumers can rely on, or decide relay will not. Brief: docs/notes/2026-10-12-codex-worker-registration-brief.md. Related lane in tasks: tasks-2fa8c6.

## Notes

- 2026-10-15T11:22:30Z (relay-6825f7): Open question from relay-635fdc's final review: if one Codex process ends a root session and starts another (/new, /resume), a background worker's late hook after the old root's SessionEnd would recreate a worker row on a live handle that neither SessionEnd nor prune removes until the process exits. Needs a capture of Codex behaviour across /new before deciding.
- 2026-10-15T13:23:06Z (main): done
  provenance: {"harness_session":"claude-code:783163fb-6924-41d7-a9d8-63a7fc5cb315","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-15T13:23:06Z (main): Met: relay publishes Codex worker rows (relay-635fdc, merged da4d6d2), tasks accepts and selects them (tasks-af3aac); registry and claim acceptance passed live. Open edges filed: relay-251fcd, plus the /new-/resume capture idea.
  provenance: {"harness_session":"claude-code:783163fb-6924-41d7-a9d8-63a7fc5cb315","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
