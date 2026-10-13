---
id: relay-60ae9e
title: "Codex child sessions export conflicting CODEX_SESSION_ID and CODEX_THREAD_ID, causing task claims to fall back to Unix identity and omit lifecycle provenance."
status: idea
priority: 2
reviewed: true
created: 2026-09-30T12:02:31Z
updated: 2026-10-13T01:33:57Z
depends: []
parent: relay-eaca0e
tags: [feedback, friction, "from:sci", "from:tasks"]
agent: codex
---

## Notes

- 2026-10-06T10:04:44Z (feedback): feedback from tasks: Codex delegated command input keeps the controller session variable while the thread variable identifies the child; native claims expire with command exit and relay rejects the conflicting hint pair.
- 2026-10-13T01:33:57Z (main): scope: drop; parented under goal relay-eaca0e for association; brief: docs/notes/2026-10-12-codex-worker-registration-brief.md; proposal: drop — the conflict-to-fallback claim identity and the conflicting-hint refusal live in tasks (src/claims.rs, src/relay/resolve.rs), not relay, and were fixed by tasks a7ffc27 (tasks-3809b8, tasks-17c844; closed by tasks-a5a502). The remaining relay gap, worker registration, is relay-f56e30.
