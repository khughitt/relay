---
id: relay-f25e1e
title: Correct the README harness event mapping count
status: doing
priority: 3
size: xs
complexity: low
process: direct
owner: main
created: 2026-10-25T00:55:50Z
updated: 2026-10-25T02:21:04Z
started: 2026-10-25T02:21:04Z
depends: []
tags: [docs]
source: relay-a36561
agent: codex
---

Documentation review finding F5 at c2f0b07a18f24376189ce524d7aeb2b3f15c87c9: README.md says twenty event mappings. The current immutable tables in src/adapters/claude-code.js, src/adapters/codex.js and src/adapters/opencode.js contain 8 + 8 + 6 = 22. Correct the count to twenty-two, or remove the unnecessary number while preserving the introduction's meaning. Keep this separate from the dated-verification cleanup already owned by relay-480b51. Done when the README agrees with the three source tables and the repository's documentation gates pass. No new runtime tests are needed for the wording correction.

## Notes

- 2026-10-25T02:21:04Z (main): started
  provenance: {"harness_session":"codex:01a170db-326b-7210-974d-9e3001240e5f","harness_session_source":"CODEX_THREAD_ID"}
