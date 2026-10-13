---
id: relay-60ae9e
title: "Codex child sessions export conflicting CODEX_SESSION_ID and CODEX_THREAD_ID, causing task claims to fall back to Unix identity and omit lifecycle provenance."
status: idea
priority: 2
created: 2026-09-30T12:02:31Z
updated: 2026-10-13T01:33:55Z
depends: []
parent: relay-eaca0e
tags: [feedback, friction, "from:sci", "from:tasks"]
agent: codex
---

## Notes

- 2026-10-06T10:04:44Z (feedback): feedback from tasks: Codex delegated command input keeps the controller session variable while the thread variable identifies the child; native claims expire with command exit and relay rejects the conflicting hint pair.
