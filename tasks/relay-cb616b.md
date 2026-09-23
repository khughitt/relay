---
id: relay-cb616b
title: "resolveAgentPid climbs past a tty-less harness to an outer one, publishing a nested headless session with its parent's handle"
status: todo
priority: 1
size: s
complexity: mid
process: direct
created: 2026-09-23T11:26:33Z
updated: 2026-09-23T11:26:33Z
depends: []
tags: [identity]
agent: "claude-code/claude-opus-5-5[1m]"
---

Observed live 2026-09-23 (tasks-1cfbad): a headless 'claude -p' (setsid, no controlling terminal) run from inside an interactive Claude Code session. Its SessionStart hook published claude-code:<nested session> with process = the OUTER claude's pid/start, because every adapter's resolveAgentPid does ancestors.find(comm === <harness> && tty !== null), skipping the nearest harness when it has no tty and adopting the next one up.

Effects: (1) the registry now holds two rows with the same handle, so tasks relay identity refuses the OUTER session with 'several relay agents match pid N' — one nested headless run locks the parent out of claim acquisition; (2) relay reap keeps the row, since the handle's process (the parent) is still alive, so the lockout lasts until a SessionEnd removes the row or the parent exits; (3) any consumer attributing by handle attributes the child's events to the parent.

Fix direction: take the nearest ancestor whose comm is the harness; if it has no tty, publish process: null rather than continuing the walk. Non-nested headless (codex exec) already publishes null correctly. Applies to claude-code, codex and opencode adapters alike.
