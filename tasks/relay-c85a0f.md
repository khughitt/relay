---
id: relay-c85a0f
title: Codex worker receives conflicting CODEX_SESSION_ID and CODEX_THREAD_ID; task lifecycle loses harness provenance and claim identity falls back to Unix session.
status: idea
priority: 2
reviewed: true
created: 2026-09-27T19:40:09Z
updated: 2026-10-13T01:33:58Z
depends: []
parent: relay-eaca0e
tags: [feedback, friction, "from:beliefs"]
agent: codex
---

## Notes

- 2026-10-13T01:33:58Z (main): scope: drop; parented under goal relay-eaca0e for association; brief: docs/notes/2026-10-12-codex-worker-registration-brief.md; proposal: drop — the conflict-to-fallback claim identity and the conflicting-hint refusal live in tasks (src/claims.rs, src/relay/resolve.rs), not relay, and were fixed by tasks a7ffc27 (tasks-3809b8, tasks-17c844; closed by tasks-a5a502). The remaining relay gap, worker registration, is relay-f56e30.
