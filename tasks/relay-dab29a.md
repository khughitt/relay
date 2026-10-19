---
id: relay-dab29a
title: "The OpenCode plugin discards hook stderr and observer exits never change the hook's exit code, so a failing observer under OpenCode is recorded nowhere"
status: idea
priority: 2
created: 2026-10-19T09:56:33Z
updated: 2026-10-19T09:56:33Z
depends: []
tags: [feedback, gap, "from:fam"]
agent: claude-code/claude-opus-5-5
---

relay hook reports SUBSCRIBER_FAILED and observer stderr only as hook stderr diagnostics; the OpenCode plugin drops stderr content and logs codes only on a nonzero hook exit, which an observer failure never causes. Expected: observer failures under OpenCode reach the plugin log (code and subscriber name).
