---
id: relay-a5a6c7
title: OpenCode install writes a percent-encoded plugin path when the checkout path has spaces
status: todo
priority: 2
size: xs
complexity: low
process: direct
created: 2026-09-25T11:04:08Z
updated: 2026-09-25T11:04:08Z
depends: []
tags: []
source: relay-b12132
agent: claude-code/claude-opus-5-5
---

bin/relay.js install (opencode branch) passes new URL('../integrations/opencode/plugin.js', import.meta.url).pathname as relayPlugin; a checkout under a path with spaces or parentheses is written with %20 etc., so OpenCode loads a nonexistent file. Use fileURLToPath, as integrations/opencode/hook.js already does; the same pattern in child.test.js, dispatch.test.js and cli.test.js is harmless only while test paths have no spaces. Add a regression test with a spaced checkout path. Found by the relay-b12132 Darwin inventory; not Darwin-specific.
