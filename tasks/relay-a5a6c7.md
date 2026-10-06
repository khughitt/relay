---
id: relay-a5a6c7
title: OpenCode install writes a percent-encoded plugin path when the checkout path has spaces
status: done
priority: 2
size: xs
complexity: low
process: direct
owner: relay-a5a6c7
created: 2026-09-25T11:04:08Z
updated: 2026-10-06T15:25:36Z
started: 2026-10-06T15:22:21Z
completed: 2026-10-06T15:25:36Z
depends: []
tags: []
source: relay-b12132
agent: claude-code/claude-opus-5-5
---

bin/relay.js install (opencode branch) passes new URL('../integrations/opencode/plugin.js', import.meta.url).pathname as relayPlugin; a checkout under a path with spaces or parentheses is written with %20 etc., so OpenCode loads a nonexistent file. Use fileURLToPath, as integrations/opencode/hook.js already does; the same pattern in child.test.js, dispatch.test.js and cli.test.js is harmless only while test paths have no spaces. Add a regression test with a spaced checkout path. Found by the relay-b12132 Darwin inventory; not Darwin-specific.

## Notes

- 2026-10-06T15:22:21Z (main): started
- 2026-10-06T15:22:37Z (relay-a5a6c7): resumed
- 2026-10-06T15:22:37Z (relay-a5a6c7): took over Unix session (owner main, stale)
- 2026-10-06T15:25:36Z (relay-a5a6c7): done
- 2026-10-06T15:25:36Z (relay-a5a6c7): bin relay install now derives the OpenCode plugin path with fileURLToPath instead of URL.pathname, so a checkout under a path with spaces or parentheses plans the real file; regression test installs from a spaced checkout copy
