---
id: relay-4d07f6
title: Test runs leak hung subscriber fixtures that outlive the worktree
status: doing
priority: 2
size: s
complexity: mid
process: direct
owner: fix/test-fixture-leaks
created: 2026-09-22T12:21:09Z
updated: 2026-10-14T22:13:50Z
started: 2026-10-14T22:13:50Z
depends: []
tags: [testing]
agent: "claude-code/claude-opus-5[1m]"
---

Observed 2026-09-22 on titan. A host-wide orphan sweep found 11 surviving `test/fixtures/subscriber.js hang` processes — node, tty-less, reparented to `systemd --user`, each in a dead `kitty-*.scope`:

- 5 from `.worktrees/relay-d79dc3`, 3d15h old (one under node v22.23.2, the rest v26.5.0)
- 5 from `.worktrees/relay-8a7ec1`, 1d21h old
- 1 from the main checkout

Both worktrees have since been removed, so five of these were executing a script path that no longer exists. They were idle (0% CPU) but held file descriptors and inotify watches for days.

The fixture's hang mode is `setInterval(() => {}, 60000)`, which keeps the event loop alive indefinitely by design. Four call sites drive it and every one of them expects the timeout path to do the killing: `test/child.test.js:21` (timeoutMs 200), `test/dispatch.test.js:74` (300) and `:305` (150), `test/cli.test.js:82` (300). So the leak says the kill in `runChild`'s timeout/deadline path does not always reach the child — it either misses a branch, races the spawn, or signals the process rather than the group.

This matters beyond tidiness: relay dispatches guards and observers under a budget, and "the subscriber hung and was never reaped" is precisely the production failure the timeout exists to prevent. A test fixture surviving its own timeout assertion is evidence that the guarantee has a hole; the tests pass because they assert on the returned status, not on the child being gone.

Reproduce: run the suite, then `pgrep -af "subscriber.js hang"`. Fix the kill path, then make the leak visible — a suite-level teardown that fails if any fixture child survives, so this cannot regress silently.

## Notes

- 2026-10-14T22:13:50Z (fix/test-fixture-leaks): started
  provenance: {"harness_session":"claude-code:9f3b3355-be3d-44ca-987d-9722adfbbe40","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
