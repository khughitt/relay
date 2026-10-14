---
id: relay-891cd8
title: "The expired-deadline dispatch test's record guard has only 100 ms, so a loaded suite kills it before it writes"
status: todo
priority: 2
size: xs
complexity: low
process: direct
created: 2026-10-14T22:35:29Z
updated: 2026-10-14T22:35:29Z
depends: []
tags: [testing]
agent: claude-code/claude-opus-5-5
---

Why: test/dispatch.test.js:142 ('an expired deadline refuses before running the remaining guards') ends with a real hook call at outerMs 1000 whose 'never' record guard (a real node child) has timeoutMs 100, then asserts it wrote its file. Under two concurrent suites it failed twice on 2026-10-14 (line 150, absent(never) true): Node startup exceeded 100 ms. Same class as relay-fc28a4.

Done: the second call gives 'never' a startup-sized budget (2000 ms) with outerMs raised so subscribersMs fits slow 150 + 2000 (outerMs 10000 gives 2667); the fake-clock half is unchanged. Two concurrent full suites pass.
