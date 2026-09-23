---
id: relay-7c134c
title: Test suite leaks one 'subscriber.js hang' fixture process per run
status: todo
priority: 2
size: s
complexity: low
process: direct
created: 2026-09-23T13:52:45Z
updated: 2026-09-23T13:52:45Z
depends: []
tags: []
agent: claude-code/claude-opus-5-5
---

Each npm test run leaves one detached 'node test/fixtures/subscriber.js hang' child reparented to the user systemd instance (16 accumulated over one session of suite runs on Node 26 and 22, 2026-09-23). Candidates using the hang fixture: test/cli.test.js:82 (guard via CLI), test/dispatch.test.js:74 and :305, test/child.test.js:21. Find which one kills only the direct child (or not the process group) on timeout, fix the test or the child runner, and add an assertion that no hang fixture survives the suite.
