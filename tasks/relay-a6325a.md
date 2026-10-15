---
id: relay-a6325a
title: Tighten Codex worker-row tests and wording
status: todo
priority: 3
size: s
complexity: low
process: direct
created: 2026-10-15T13:37:06Z
updated: 2026-10-15T13:37:06Z
depends: []
tags: []
source: relay-635fdc
agent: claude-code/claude-opus-5-5
---

Deferred minors from relay-635fdc's reviews: (1) a dispatch test that guard and observer envelopes carry root; (2) empty and equal agent_id refused on SubagentStart and SubagentStop, not only PreToolUse (test/codex.test.js); (3) the no-guard refusal characterization covers root Stop as well as SubagentStop (test/dispatch.test.js); (4) src/dispatch.js comment 'Fail closed for configured guards' is wrong: it refuses with or without guards; (5) docs/api.md overstates the prune: a worker row published with process:null is not reaped with its root; (6) test/capture-hook.test.js should fail early naming jq when it is missing.
