---
id: relay-b2f044
title: "Contract docs, gate, and closure"
status: done
priority: 1
size: s
complexity: low
process: direct
owner: relay-a1510a
created: 2026-09-18T21:13:21Z
updated: 2026-09-19T00:55:32Z
started: 2026-09-19T00:51:50Z
completed: 2026-09-19T00:55:32Z
depends: [relay-1239a2]
parent: relay-a1510a
tags: []
agent: "claude-code/claude-opus-5[1m]"
plan: docs/plans/2026-09-18-explicit-subscriber-path.md
step: "Task 5: Contract docs, gate, and closure"
---

## Notes

- 2026-09-19T00:51:50Z (relay-a1510a): started
  provenance: {"harness_session":"codex:01a0b70b-d4df-71f2-8de2-35bfb558d413","harness_session_source":"CODEX_SESSION_ID"}
- 2026-09-19T00:55:32Z (relay-a1510a): done
- 2026-09-19T00:55:32Z (relay-a1510a): Codex encoding verified correct against codex-cli 0.155.0; the live failure was relay resolving its subscriber file from a hook environment that Codex's login shell rewrote. Installed entries now carry --subscribers <file>, loaded without the environment; an explicit absent file refuses; install validates the file with the runtime checks.
