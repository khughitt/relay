---
id: relay-ef98dc
title: "The integration test suite has a 200 ms subprocess deadline that flakes under concurrent test load, reporting a timeout instead of the expected child failure."
status: done
priority: 2
size: xs
complexity: low
process: direct
owner: fix/test-fixture-leaks
created: 2026-10-12T05:39:43Z
updated: 2026-10-14T22:15:39Z
started: 2026-10-14T22:13:57Z
completed: 2026-10-14T22:15:39Z
depends: []
tags: [feedback, friction, "from:relay"]
agent: codex
---

Why: integrations/opencode/hook.test.mjs:93-98 ("stderr is bounded, timeout kills child…") runs three real `node -e` children through spawnHook with one shared timeoutMs of 200. Only the INPUT_TIMEOUT case needs the timeout; the PROCESS_UNAVAILABLE (exit 3) and INPUT_TOO_LARGE cases need the child to start and act first. Under concurrent test load Node startup exceeds 200 ms and the test sees INPUT_TIMEOUT instead of the expected child failure.

Done: each case carries its own timeoutMs: the non-timeout cases get a budget real Node startup fits under load (seconds), the timeout case stays short. The test passes 20 times in a row under a concurrent suite.

Where: integrations/opencode/hook.test.mjs:93-98; spawnHook in integrations/opencode/hook.js. Related class: relay-fc28a4.

## Notes

- 2026-10-13T01:47:30Z (main): scope: scoped; located the shared 200 ms budget at integrations/opencode/hook.test.mjs:95; body gives per-case budgets and a repeat-under-load check; todo P2 xs low direct
- 2026-10-14T22:13:57Z (fix/test-fixture-leaks): started
  provenance: {"harness_session":"claude-code:9f3b3355-be3d-44ca-987d-9722adfbbe40","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-14T22:15:39Z (fix/test-fixture-leaks): done
  provenance: {"harness_session":"claude-code:9f3b3355-be3d-44ca-987d-9722adfbbe40","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-14T22:15:39Z (fix/test-fixture-leaks): Per-case budgets in integrations/opencode/hook.test.mjs: exit-3 and stderr-overflow cases get 5000 ms (spawnHook's cap), the timeout case keeps 200 ms. Flake did not reproduce locally before the fix (0/20 under load avg ~18); after it, 20/20 in a row under 8 CPU spinners plus a looping suite. 9c3699e
  provenance: {"harness_session":"claude-code:9f3b3355-be3d-44ca-987d-9722adfbbe40","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
