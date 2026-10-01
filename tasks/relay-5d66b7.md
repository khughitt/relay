---
id: relay-5d66b7
title: Docs still say relay has no npm dependencies; jsonc-parser is a bundled runtime dependency
status: doing
priority: 3
size: xs
complexity: low
process: direct
owner: main
created: 2026-09-25T11:04:08Z
updated: 2026-10-01T15:25:49Z
started: 2026-10-01T15:25:49Z
depends: []
tags: []
source: relay-b12132
agent: claude-code/claude-opus-5-5
---

AGENTS.md ('There are no npm dependencies to install'), README.md and docs/api.md contradict package.json's bundledDependencies jsonc-parser, which relay install loads on demand. State the one dependency and that only install needs it.

## Notes

- 2026-10-01T15:25:49Z (main): started
