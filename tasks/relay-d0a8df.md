---
id: relay-d0a8df
title: Port the OpenCode integration to the OpenCode v2 plugin API
status: todo
priority: 2
size: m
complexity: mid
process: planned
created: 2026-09-25T11:35:46Z
updated: 2026-09-25T11:35:46Z
depends: []
tags: [opencode]
source: relay-b12132
agent: claude-code/claude-opus-5-5
---

Observed 2026-09-25 with opencode v2.0.15 on Linux: the config entry relay install writes (an absolute path to integrations/opencode/plugin.js) is dropped with 'configured plugin path must be a directory' (packages/core/src/config/plugin/source.ts at v2.0.15), so relay never publishes for OpenCode v2. Wrapping the v1 plugin in a directory with index.js loads it but fails with 'Plugin must export a default definition with an id and an effect or setup function' (packages/plugin, Host.resolve server|index entrypoints). Needed: a v2 plugin directory (default export {id, setup|effect}) mapping v2 session/instance events to relay's init/busy/idle/error/dispose events, and an installer that writes the directory path. Plugins load per project instance: nothing publishes until a request names a project (GET /api/plugin?location[directory]=<dir>, Basic auth opencode:$OPENCODE_SERVER_PASSWORD). Decide whether v1 support stays.
