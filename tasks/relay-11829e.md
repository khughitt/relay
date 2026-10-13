---
id: relay-11829e
title: "Codex subagents inherit a parent CODEX_SESSION_ID while setting their own CODEX_THREAD_ID, causing claim identity fallback and omitted lifecycle provenance; child commands need one consistent native identity."
status: idea
priority: 2
reviewed: true
created: 2026-10-06T15:03:37Z
updated: 2026-10-13T01:33:57Z
depends: []
parent: relay-eaca0e
tags: [feedback, friction, "from:tasks"]
agent: codex
---

## Notes

- 2026-10-13T01:33:57Z (main): scope: drop; parented under goal relay-eaca0e for association; brief: docs/notes/2026-10-12-codex-worker-registration-brief.md; proposal: drop — the conflict-to-fallback claim identity and the conflicting-hint refusal live in tasks (src/claims.rs, src/relay/resolve.rs), not relay, and were fixed by tasks a7ffc27 (tasks-3809b8, tasks-17c844; closed by tasks-a5a502). The remaining relay gap, worker registration, is relay-f56e30.
