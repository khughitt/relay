---
id: relay-ef98dc
title: "The integration test suite has a 200 ms subprocess deadline that flakes under concurrent test load, reporting a timeout instead of the expected child failure."
status: todo
priority: 2
size: xs
complexity: low
process: direct
created: 2026-10-12T05:39:43Z
updated: 2026-10-13T01:47:30Z
depends: []
tags: [feedback, friction, "from:relay"]
agent: codex
---

Why: integrations/opencode/hook.test.mjs:93-98 ("stderr is bounded, timeout kills child…") runs three real `node -e` children through spawnHook with one shared timeoutMs of 200. Only the INPUT_TIMEOUT case needs the timeout; the PROCESS_UNAVAILABLE (exit 3) and INPUT_TOO_LARGE cases need the child to start and act first. Under concurrent test load Node startup exceeds 200 ms and the test sees INPUT_TIMEOUT instead of the expected child failure.

Done: each case carries its own timeoutMs: the non-timeout cases get a budget real Node startup fits under load (seconds), the timeout case stays short. The test passes 20 times in a row under a concurrent suite.

Where: integrations/opencode/hook.test.mjs:93-98; spawnHook in integrations/opencode/hook.js. Related class: relay-fc28a4.

## Notes

- 2026-10-13T01:47:30Z (main): scope: scoped; located the shared 200 ms budget at integrations/opencode/hook.test.mjs:95; body gives per-case budgets and a repeat-under-load check; todo P2 xs low direct
