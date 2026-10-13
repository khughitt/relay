---
id: relay-ebd6f5
title: The complete test front door leaves a hung subscriber fixture running after a successful suite; test cleanup must reap it even when dispatch times out.
status: idea
priority: 2
reviewed: true
created: 2026-10-12T04:51:55Z
updated: 2026-10-13T01:47:30Z
depends: []
tags: [feedback, friction, "from:relay"]
agent: codex
---

## Notes

- 2026-10-13T01:47:30Z (main): scope: drop; reproduced 2026-10-12: one run of the 'survival limitation' test (test/cli.test.js:80-86) leaves one 'subscriber.js hang' process, because the test SIGKILLs the hook CLI at 200 ms before relay can kill its guard child, which is the documented outer-kill limitation; runChild is not at fault; proposal: drop as duplicate of relay-7c134c (same leak, open todo; relay-4d07f6 also covers it); carry this source finding to relay-7c134c
