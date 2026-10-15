---
id: relay-251fcd
title: Break repeated turn-end refusals on malformed input
status: todo
priority: 3
size: s
complexity: mid
process: planned
created: 2026-10-15T11:21:38Z
updated: 2026-10-15T11:21:38Z
depends: []
tags: []
source: relay-635fdc
agent: claude-code/claude-opus-5-5
---

Relay fails closed on any input failure (src/dispatch.js abort), with or without guards. On Codex/Claude Stop and Codex SubagentStop the refusal is decision: block, a continuation, and relay ignores stop_hook_active on that path, so a persistent malformed payload (e.g. a future Codex serializing agent_id: null) blocks every turn end repeatedly. Decide whether a turn-end with stopHookActive true reports the failure instead of refusing. Found by relay-635fdc's final review (Important #2); characterized by the dispatch test 'a malformed Codex agent_id refuses even with no guard'.
