---
id: relay-fe38b1
title: Carry Claude Code background tasks and reduce needs-input to idle while they run; release v0.1.1
status: todo
priority: 2
size: m
complexity: mid
process: planned
created: 2026-10-19T09:56:30Z
updated: 2026-10-19T09:56:30Z
depends: []
tags: []
source: fam-6e8321
agent: claude-code/claude-opus-5-5
---

Familiar's 0a9e0d7 (2026-10-07, after the extraction baseline) reduces Claude Code's Notification:idle_prompt to idle while the last Stop or SubagentStop listed running background_tasks: an agent waiting on its own command is not waiting on the user. Relay v0.1.0's Claude reducer is the identity and neither Event nor Agent carries the count, so every registry consumer sees needs-input there (familiar's cat, a future notification).

Scope: parse background_tasks (a list; count entries with status running; absent means not reported) from Stop and SubagentStop; carry it as an optional additive Agent.backgroundTasks, forwarded across events that do not report it; reduce needs-input to idle while it is above zero. Additive optional field keeps schema 2 (parent design §4); check tasks' Rust mirror of the validators (relay-4a5559) ignores it. Release as v0.1.1 by docs/runbooks/release.md.

Consumer: familiar spec docs/specs/2026-10-19-relay-consumer-design.md §8 (accepted 2026-10-19); familiar's final pin-bump step waits on this release.
