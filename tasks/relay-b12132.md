---
id: relay-b12132
title: "Darwin live probe: a self-contained bundle that proves relay's Darwin paths on a physical Mac"
status: doing
priority: 1
size: m
complexity: mid
process: planned
owner: darwin-probe
created: 2026-09-25T10:57:49Z
updated: 2026-09-25T11:04:37Z
started: 2026-09-25T10:57:57Z
depends: []
parent: relay-1231bf
tags: []
source: ops-c8e4d1
agent: claude-code/claude-opus-5-5
spec: docs/specs/2026-09-25-darwin-probe.md
---

The release gate relay-c19c0a carries: physical Darwin process/terminal verification has not run (relay-06b1da note; ops docs/plans/2026-09-16-relay-bootstrap.md 'physical Darwin validation remains a release gate'). Build a bundle (npm pack tarball + probe driver) the user copies to their MacBook and runs with one command; it records the Mac's environment and harnesses, exercises every Darwin-sensitive relay surface live, and writes a results directory the user copies back for judging on titan. Decided 2026-09-25: bundle, not ssh. Design against the approved ops relay spec; plan for review before building.

## Notes

- 2026-09-25T10:57:57Z (darwin-probe): started
  provenance: {"harness_session":"claude-code:6562017c-99e6-4191-ae1d-ff9e25678dc0","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T11:04:37Z (darwin-probe): parked (waiting on user, review): User reviews docs/specs/2026-09-25-darwin-probe.md on branch darwin-probe (.worktrees/relay-b12132, 8888a48); on approval the agent writes the implementation plan (relay probe + judge + bundle, ops relay-guard-probe token change) for review
  provenance: {"harness_session":"claude-code:6562017c-99e6-4191-ae1d-ff9e25678dc0","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
