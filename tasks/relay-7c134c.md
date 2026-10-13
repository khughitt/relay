---
id: relay-7c134c
title: Test suite leaks one 'subscriber.js hang' fixture process per run
status: todo
priority: 2
size: s
complexity: low
process: direct
created: 2026-09-23T13:52:45Z
updated: 2026-10-13T11:23:40Z
depends: []
tags: []
agent: claude-code/claude-opus-5-5
---

Each npm test run leaves one detached 'node test/fixtures/subscriber.js hang' child reparented to the user systemd instance (16 accumulated over one session of suite runs on Node 26 and 22, 2026-09-23). Candidates using the hang fixture: test/cli.test.js:82 (guard via CLI), test/dispatch.test.js:74 and :305, test/child.test.js:21. Find which one kills only the direct child (or not the process group) on timeout, fix the test or the child runner, and add an assertion that no hang fixture survives the suite.

## Notes

- 2026-10-13T08:29:02Z (main): Source found during scope of relay-ebd6f5 (2026-10-12): one run of the 'survival limitation' test (test/cli.test.js:80-86) leaves one 'subscriber.js hang' process. The test SIGKILLs the hook CLI at 200 ms before relay can kill its guard child (the documented outer-kill limitation); runChild's timeout path is not at fault. Fix in the test: reap the guard child after the outer kill, and assert no fixture survives.
- 2026-10-13T11:10:50Z (design/typed-messages): Observed recurrence during typed-message closeout: full Node22.23.2 gate passed576/576 with file-concurrency1 but left subscriber.js hang PID3611643 under this worktree, reparented to user systemd. Verified exact argv/cwd and its absence at prior preflight; terminated only that owned PID and confirmed /proc absent. This confirms the already-triaged survival-limitation fixture cleanup issue; no leak fix claimed.
- 2026-10-13T11:23:40Z (main): Merged-main verification recurrence: full Node22.23.2 gate576/576 passed with file-concurrency1 and left one owned hang fixture PID3698669 in this session scope. Verified exact argv/cwd/start identity, SIGTERMed it and confirmed gone. Older main-checkout fixture PIDs outside this session were left untouched. This remains an existing fixture-cleanup follow-up; no fix claimed.
