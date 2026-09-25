---
id: relay-9e8e77
title: "Linux judging CLI, runbook, end-to-end smoke, handoff"
status: done
priority: 1
size: s
complexity: mid
process: direct
owner: darwin-probe
created: 2026-09-25T11:48:42Z
updated: 2026-09-25T15:21:24Z
started: 2026-09-25T15:17:03Z
completed: 2026-09-25T15:21:24Z
depends: [relay-4c5054]
parent: relay-b12132
tags: []
source: relay-b12132
model: "claude-opus-5-5[1m]"
agent: claude-code/claude-opus-5-5
plan: docs/plans/2026-09-25-darwin-probe.md
step: "Task 12: Linux judging CLI, runbook, end-to-end smoke, handoff"
---

## Notes

- 2026-09-25T15:17:03Z (darwin-probe): started
  provenance: {"harness_session":"claude-code:e2e5c9ac-0117-427a-bf31-489aecc94355","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T15:21:24Z (darwin-probe): done
  provenance: {"harness_session":"claude-code:e2e5c9ac-0117-427a-bf31-489aecc94355","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T15:21:24Z (darwin-probe): judge-cli.mjs (cross-checks raw/redacted verdicts and re-derives D7 proven with ops at the recorded commit), the darwin-probe runbook, and a clean Linux smoke through bundle bad3a1b: release smoke; D0 D1 D2 D5 D6 D8 ISO pass; D7b rejected-file / 200 / directory match as pinned
  provenance: {"harness_session":"claude-code:e2e5c9ac-0117-427a-bf31-489aecc94355","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
