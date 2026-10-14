---
id: relay-a7aea1
title: "Process tests use global fixed process markers, so concurrent suite runs mistake each other's children for readiness and survivors."
status: done
priority: 2
size: s
complexity: mid
process: direct
owner: fix/test-fixture-leaks
created: 2026-10-12T06:01:59Z
updated: 2026-10-14T22:37:24Z
started: 2026-10-14T22:18:31Z
completed: 2026-10-14T22:37:24Z
depends: []
tags: [feedback, friction, "from:relay"]
agent: codex
---

Why: the Darwin probe tests detect readiness and survivors by scanning every process on the host (`ps -axo args=`) for fixed strings, `sleep 600.654` and `sleep 600.321`. test/darwin-probe-runtime.test.js:67 spawns the same `sleep 600.321 & sleep 600.654` shape that tools/darwin-probe/probe.mjs:217 (`--self-test-hang`, stage D1) runs, and node --test runs files in parallel processes. So another file in the same suite, or a second concurrent suite run, can satisfy the readiness poll in test/darwin-probe-orchestrator.test.js:38 before D0 has finished: SIGINT then lands early and the D0 archive entry is missing. The survivor checks (lines 56, 168, 217, 262, 276; runtime :72) can likewise fail on another run's children. Reported: isolated interrupt test passes, two default suite runs lose the initial-stage archive entry; same-suite collision is the leading hypothesis, not proven.

Done: every process marker these tests poll or assert absent is unique to the test that spawns it (e.g. a per-test random sleep duration passed to `--self-test-hang` and to the runtime fixture), and readiness and survivor checks match only that marker. Two concurrent `npm test` runs pass, and the orchestrator SIGINT test passes 10 times in a row under a concurrent suite.

Where: test/darwin-probe-orchestrator.test.js (lines 38, 56, 162-168, 217, 262-276 and the shared psArgs/waitFor helpers), test/darwin-probe-runtime.test.js:67-72, tools/darwin-probe/probe.mjs:96-97 and :217. The probe bundle ships probe.mjs, so keep the default self-test marker working for the Mac runbook.

## Notes

- 2026-10-12T11:23:04Z (feedback): feedback from relay: The full test front door's interrupt readiness check and another test fixture reuse one global process marker across files; isolated interrupt passes while two default suite runs lose the initial-stage archive entry. Same-suite collision is a hypothesis, not causally proved.
- 2026-10-13T01:47:28Z (main): scope: scoped; body rewritten with the shared fixed markers (orchestrator :38 readiness poll, runtime :67 fixture, probe.mjs:217 self-test) and a concurrency check; todo P2 s mid direct
- 2026-10-13T18:35:43Z (fix/typed-messages-review): observed 2026-10-13: default-concurrency test-fast failed once on 'SIGINT after a normal D0 packs results' (test/darwin-probe-orchestrator.test.js:31, ENOENT stages/D0.json); the focused file and a full rerun passed immediately after
- 2026-10-14T22:18:26Z (fix/test-fixture-leaks): evidence 2026-10-14: a suite killed mid-run (load generator) orphaned one probe 'run --self-test-hang' with its 'sleep 600.321' and 'sleep 600.654' children; while they lived, 4 orchestrator tests failed on both Node 22 and 26 (SIGINT after a normal D0, credential material stops packing, closing the terminal bash/dash). After reaping them the suite passed 607/607. Confirms the host-wide fixed-marker collision, from a stale survivor rather than a concurrent run.
- 2026-10-14T22:18:31Z (fix/test-fixture-leaks): started
  provenance: {"harness_session":"claude-code:9f3b3355-be3d-44ca-987d-9722adfbbe40","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-14T22:37:24Z (fix/test-fixture-leaks): done
  provenance: {"harness_session":"claude-code:9f3b3355-be3d-44ca-987d-9722adfbbe40","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-14T22:37:24Z (fix/test-fixture-leaks): Every host-wide ps marker in the darwin-probe tests is now per-test: probe.mjs --self-test-tag (nine digits, needs --self-test-hang, refused otherwise; bare --self-test-hang unchanged for the Mac runbook) and per-test sleeps in the runtime tests, including a third fixed marker (sleep 600.777) the body missed. The terminal-close test checks its own run's root (read from the probe's argv) instead of diffing /tmp/rdp.*, a second host-global collision found under concurrency. Evidence: main's code failed the SIGINT test 7/10 beside two concurrent suites, and a planted stale 600.321/600.654 orphan broke 4 tests earlier; after the fix, SIGINT 10/10 beside two concurrent suites (608/608 each), probe tests 42/42 with the decoy orphan alive, Node 22.23.2 608/608. 21a0b77
  provenance: {"harness_session":"claude-code:9f3b3355-be3d-44ca-987d-9722adfbbe40","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
