---
id: relay-bce396
title: Live-check Claude background-work reduction and non-blocking unreadable Stop on v0.1.1
status: todo
priority: 3
size: s
complexity: mid
process: direct
created: 2026-10-19T15:53:27Z
updated: 2026-10-19T15:53:36Z
depends: []
tags: [testing]
source: relay-fe38b1
agent: codex
---

The v0.1.1 release passed fixture/integration tests, strict checks and public installation on Node 26 and 22, but did not repeat native Claude Code acceptance of the new background-work path. The binding spec is docs/specs/2026-10-19-claude-background-work.md; release commit 4ceec5d2ad22b136b37ee360e7a4ed00949f28d9.

Use an isolated/headless Claude session and disposable hook/subscriber/registry configuration, with an explicit released relay executable path. Do not repoint shared launchers, install host hooks or take the desktop. Reuse existing capture/probe patterns; keep any needed probe bounded and self-cleaning. Record Claude/Node/relay versions and sanitized evidence, retaining only counts and state transitions from background entries.

Prove with actual native background work: (1) a Stop with an active background agent publishes working, followed by done when that work finishes and a later Stop reports no agents; (2) a Stop with shell/monitor work followed by idle_prompt publishes idle, then a later zero-work Stop and idle_prompt returns to needs-input. Check the actual normalized type/status labels against the spec rather than assuming them. In the isolated hook path, inject an unreadable background_tasks report at Stop and confirm the native harness continues once with BACKGROUND_UNREADABLE/exit 1, the row clears its counts and observers run, with no continuation/refusal loop. Keep this controlled malformed-input case distinct from naturally emitted payload evidence.

Done: record the observed transitions and non-blocking notice in a committed acceptance note and link it from the v0.1.1 release record, or document an exact native capability blocker rather than claiming a pass. Any defect found is filed separately with reproduction evidence. No consumer migration, mixed-writer redesign or physical Darwin work here: fam-abf633, hq-539508 and relay-848c0f already own those concerns.

## Notes

- 2026-10-19T15:53:36Z (main): concerns: relay-fe38b1 extension — Add native Claude acceptance evidence for the released background-work lifecycle and unreadable-Stop hook behavior; release tests and public-install proofs already passed.
