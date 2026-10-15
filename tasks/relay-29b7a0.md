---
id: relay-29b7a0
title: Show worker scope and root in relay list and /v1/agents
status: todo
priority: 3
size: s
complexity: low
process: direct
created: 2026-10-15T13:37:05Z
updated: 2026-10-15T13:37:05Z
depends: []
tags: []
source: relay-635fdc
agent: claude-code/claude-opus-5-5
---

relay list text (bin/relay.js) and GET /v1/agents (src/serve/http.js) drop scope and root, so a Codex worker row reads as a top-level agent, and an interrupted worker lingering as working has no grouping to explain it. Add scope, and root when present, to both, with tests. Found in relay-635fdc's final review (Minor 1).
