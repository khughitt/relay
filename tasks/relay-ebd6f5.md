---
id: relay-ebd6f5
title: The complete test front door leaves a hung subscriber fixture running after a successful suite; test cleanup must reap it even when dispatch times out.
status: dropped
priority: 2
created: 2026-10-12T04:51:55Z
updated: 2026-10-13T08:29:02Z
depends: []
tags: [feedback, friction, "from:relay"]
agent: codex
---

## Notes

- 2026-10-13T01:47:30Z (main): scope: drop; reproduced 2026-10-12: one run of the 'survival limitation' test (test/cli.test.js:80-86) leaves one 'subscriber.js hang' process, because the test SIGKILLs the hook CLI at 200 ms before relay can kill its guard child, which is the documented outer-kill limitation; runChild is not at fault; proposal: drop as duplicate of relay-7c134c (same leak, open todo; relay-4d07f6 also covers it); carry this source finding to relay-7c134c
- 2026-10-13T08:29:02Z (main): dropped
  provenance: {"harness_session":"claude-code:b6b16dab-704e-45ee-b797-4fc7a7afef67","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-13T08:29:02Z (main): Duplicate of relay-7c134c (also relay-4d07f6): the leak comes from the outer-kill survival test, test/cli.test.js:80-86.
  provenance: {"harness_session":"claude-code:b6b16dab-704e-45ee-b797-4fc7a7afef67","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
