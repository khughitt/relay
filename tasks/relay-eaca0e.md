---
id: relay-eaca0e
title: Register Codex workers in the relay registry
status: todo
priority: 2
created: 2026-10-13T01:33:22Z
updated: 2026-10-13T01:33:22Z
depends: []
tags: []
source: docs/notes/2026-10-12-codex-worker-registration-brief.md
agent: claude-code/claude-opus-5-5
---

Codex workers share their controller's process and session_id, so relay publishes only a root row and tasks refuses it for a worker's relay claim. Give a worker its own relay identity with liveness consumers can rely on, or decide relay will not. Brief: docs/notes/2026-10-12-codex-worker-registration-brief.md. Related lane in tasks: tasks-2fa8c6.
