---
id: relay-6e9410
title: "lock-multiprocess: an increment worker errors on Darwin (8 workers, dead-main reclamation)"
status: todo
priority: 1
size: s
complexity: mid
process: direct
created: 2026-09-25T17:33:41Z
updated: 2026-09-25T18:48:36Z
depends: []
parent: relay-1231bf
tags: []
source: relay-b12132
agent: claude-code/claude-opus-5-5
---

The first physical Mac run of the Darwin probe (macOS 26.7 arm64, node v25.8.2; runbook attempt 2026-09-25T17:01) failed D2, a release gate: test/lock-multiprocess.test.js 'eight real processes retain all counter updates, including dead main reclamation' got a worker message of type 'error' instead of 'done'. The worker (test/fixtures/lock-worker.js) sends {type:'error', code} but the test asserts only .type, so the code was lost. Suspects: relay's 2 s ps deadline (runDarwinPs) under eight concurrent lock contenders on Darwin, or a lock-busy path. relay-b12132's follow-up makes the test report the code; the next Mac run names it. Blocks relay-c19c0a.

## Notes

- 2026-09-25T18:48:36Z (darwin-attempt2): Mac attempt 2 (2026-09-25T18:02): lock-multiprocess passed, but test/cli.test.js 'the CLI returns inside the outer timeout while another writer holds the lock' failed with 'registry: LOCK_IDENTITY_UNKNOWN: lock owner identity unavailable' (src/bus/lock.js:55-62). Likely the same cause as attempt 1's worker error: the Darwin identity read of the lock holder (runDarwinPs, 2 s deadline) intermittently fails under contention.
