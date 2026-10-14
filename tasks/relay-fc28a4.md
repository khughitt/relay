---
id: relay-fc28a4
title: A dispatch deadline test gives a real child record fixture only 100ms; it missed the write under a serial full suite while the focused file passed immediately afterward.
status: doing
priority: 2
size: xs
complexity: mid
process: direct
owner: fix/test-fixture-leaks
created: 2026-10-12T09:19:32Z
updated: 2026-10-14T22:15:40Z
started: 2026-10-14T22:15:40Z
depends: []
tags: [feedback, friction, "from:relay"]
agent: codex
---

Why: test/dispatch.test.js:305 ("a slow observer never delays a denial…") runs a real `node test/fixtures/subscriber.js record` observer with timeoutMs 100 and asserts it wrote its file. Node startup alone can exceed 100 ms under a loaded serial full suite, so the observer is killed before writing and the assertion fails; the focused file passed straight afterwards.

Done: the positive-path child ("after", and "quick" if it shares the risk) gets a budget that real Node startup fits under load, with outerMs and the subscribersMs comment recomputed so the test still proves that a later observer which fits still runs after the hung one times out. Timeout-path children (hang) keep short budgets. The test passes 20 times in a row under `stress`-style load or a concurrent suite.

Where: test/dispatch.test.js:300-310 and the budget computation it relies on (budgetFor in src/subscribers.js; see test/subscribers.test.js:94 for the shape). Related class: relay-ef98dc.

## Notes

- 2026-10-13T01:47:29Z (main): scope: scoped; located the 100 ms record observer at test/dispatch.test.js:305; body states the budget fix and repeat-under-load check; todo P2 xs mid direct
- 2026-10-14T22:15:40Z (fix/test-fixture-leaks): started
  provenance: {"harness_session":"claude-code:9f3b3355-be3d-44ca-987d-9722adfbbe40","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
