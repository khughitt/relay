---
id: relay-652c96
title: "Claim identity warns when two Codex IDs are exported, falls back to Unix session, and loses harness provenance"
status: idea
priority: 2
reviewed: true
created: 2026-09-27T16:21:17Z
updated: 2026-10-13T01:33:58Z
depends: []
parent: relay-eaca0e
tags: [feedback, friction, "from:beliefs"]
agent: codex
---

## Notes

- 2026-10-13T01:33:58Z (main): scope: drop; parented under goal relay-eaca0e for association; brief: docs/notes/2026-10-12-codex-worker-registration-brief.md; proposal: drop — the conflict-to-fallback claim identity and the conflicting-hint refusal live in tasks (src/claims.rs, src/relay/resolve.rs), not relay, and were fixed by tasks a7ffc27 (tasks-3809b8, tasks-17c844; closed by tasks-a5a502). The remaining relay gap, worker registration, is relay-f56e30.
