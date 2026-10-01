---
id: relay-5d66b7
title: Docs still say relay has no npm dependencies; jsonc-parser is a bundled runtime dependency
status: done
priority: 3
size: xs
complexity: low
process: direct
owner: relay-5d66b7
created: 2026-09-25T11:04:08Z
updated: 2026-10-01T15:32:48Z
started: 2026-10-01T15:25:49Z
completed: 2026-10-01T15:32:48Z
depends: []
tags: []
source: relay-b12132
agent: claude-code/claude-opus-5-5
---

AGENTS.md ('There are no npm dependencies to install'), README.md and docs/api.md contradict package.json's bundledDependencies jsonc-parser, which relay install loads on demand. State the one dependency and that only install needs it.

## Notes

- 2026-10-01T15:25:49Z (main): started
- 2026-10-01T15:26:10Z (relay-5d66b7): resumed
- 2026-10-01T15:26:10Z (relay-5d66b7): took over session sid:2034873 (owner main, stale)
- 2026-10-01T15:32:48Z (relay-5d66b7): done
- 2026-10-01T15:32:48Z (relay-5d66b7): Corrected the dependency claim in AGENTS.md, README.md and docs/api.md: jsonc-parser is the one bundled runtime dependency, needed only by relay install
