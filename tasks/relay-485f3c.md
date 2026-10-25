---
id: relay-485f3c
title: Scope the API general command list to match the current CLI
status: todo
priority: 3
size: xs
complexity: low
process: direct
created: 2026-10-25T00:55:59Z
updated: 2026-10-25T00:55:59Z
depends: []
tags: [docs]
source: relay-a36561
agent: codex
---

Documentation review finding F7 at c2f0b07a18f24376189ce524d7aeb2b3f15c87c9: docs/api.md 501-506 introduces an apparently exhaustive CLI command list but omits serve, ask, inbox and presence, all declared in src/commands.js. Prefer changing the introduction to describe registry/installation/model commands and pointing to the interaction CLI section, rather than duplicating the full command table. Check the destination section against src/commands.js, including inbox ask/take, before linking it. Done when the command inventory's scope is explicit, every claimed command and option agrees with the declarations, the internal link resolves, and the repository's documentation gates pass. No CLI behavior change is in scope.
