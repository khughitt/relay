---
id: relay-fe38b1
title: Carry Claude Code background tasks and reduce needs-input to idle while they run; release v0.1.1
status: doing
priority: 2
size: m
complexity: mid
process: planned
owner: feat/bg-tasks
created: 2026-10-19T09:56:30Z
updated: 2026-10-19T13:32:16Z
started: 2026-10-19T13:18:44Z
depends: []
tags: []
source: fam-6e8321
agent: claude-code/claude-opus-5-5
spec: docs/specs/2026-10-19-claude-background-work.md
---

Familiar's 0a9e0d7 (2026-10-07, after the extraction baseline) reduces Claude Code's Notification:idle_prompt to idle while the last Stop or SubagentStop listed running background_tasks: an agent waiting on its own command is not waiting on the user. Relay v0.1.0's Claude reducer is the identity and neither Event nor Agent carries the count, so every registry consumer sees needs-input there (familiar's cat, a future notification).

Scope: parse background_tasks (a list; count entries with status running; absent means not reported) from Stop and SubagentStop; carry it as an optional additive Agent.backgroundTasks, forwarded across events that do not report it; reduce needs-input to idle while it is above zero. Additive optional field keeps schema 2 (parent design §4); check tasks' Rust mirror of the validators (relay-4a5559) ignores it. Release as v0.1.1 by docs/runbooks/release.md.

Consumer: familiar spec docs/specs/2026-10-19-relay-consumer-design.md §8 (accepted 2026-10-19); familiar's final pin-bump step waits on this release.

## Notes

- 2026-10-19T13:18:44Z (main): started
  provenance: {"harness_session":"claude-code:0f09e241-608f-420b-abd4-4ce9eb9dee01","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-19T13:18:52Z (feat/bg-tasks): resumed
  provenance: {"harness_session":"claude-code:0f09e241-608f-420b-abd4-4ce9eb9dee01","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-19T13:23:26Z (feat/bg-tasks): Scope finding: familiar main moved past 0a9e0d7 on 2026-10-19 (82c5cc6, 82afe93; fam-721108): it counts running|pending entries split into agent-type (subagent, workflow, teammate, cloud session) and other, reduces a Stop with agents>0 to working, and reduces idle_prompt to idle only on other>0; its record field is background {agents, other}. Familiar's consumer spec §8 and this task predate it. Porting only the 0a9e0d7 rule would regress fam-721108 when familiar drops its reducer, so the spec carries the current rule as Agent.background {agents, other}. tasks' Rust snapshot reader reads Agent fields by name and ignores others (checked src/relay/snapshot.rs).
- 2026-10-19T13:32:16Z (feat/bg-tasks): review: spec round 1 — verdict: revise; findings: Q 3; reviewer: claude-code
