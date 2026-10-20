---
id: relay-721d22
title: Read npm pack --json in both npm 11 (array) and npm 12 (name-keyed object) shapes in the package smoke tests
status: todo
priority: 2
size: xs
complexity: low
process: direct
created: 2026-10-20T01:45:38Z
updated: 2026-10-20T02:07:10Z
depends: []
tags: [feedback, friction, "from:hq"]
agent: codex
---

Why: npm 12.0.0 (npm/cli#9247, listed as breaking in its release notes) changed `npm pack --json` from an array of entries to an object keyed by package name, matching `npm publish --json`; the entries themselves are unchanged. Both tests in test/pack.test.js index `[0]` into the parsed output (lines 15, 18, 22 and 33), so under npm 12 they fail on `undefined` while packaging itself succeeds. Reproduced on this host on 2026-10-19: /usr/bin/npm is 12.2.1 and prints `{"relay": {...}}` for a dry run, while the nvm node 26.5.0 ships npm 11.17.0, so the suite passes or fails by PATH order.

Report (hq, friction): Two package smoke tests assume npm pack --json returns an array; npm12 returns a keyed object, so both fail while packaging itself succeeds.

Done when: one helper in test/pack.test.js takes the parsed `npm pack --json` output and returns its single entry whichever shape it has (an array's first element, or the one value of a name-keyed object), asserting exactly one entry; all four call sites use it; and `just test-fast` passes under both npm 11 (the nvm node's npm) and npm 12 (`PATH=/usr/bin:$PATH`). Name both runs in the done message.

Where to look: test/pack.test.js; npm/cli#9247 for the upstream change; docs/api.md "Local tarball smoke tests" paragraph if the wording should name the npm range.

## Notes

- 2026-10-20T02:07:10Z (main): scope: scoped; confirmed against npm/cli#9247 (npm 12.0.0 breaking change) and a local dry run under /usr/bin/npm 12.2.1 (name-keyed object) vs nvm npm 11.17.0 (array); all four pack --json reads in test/pack.test.js index [0]; rated xs/low/direct; title and body rewritten, original report kept in the body
