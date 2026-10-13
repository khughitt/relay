---
id: relay-a7aea1
title: "Process tests use global fixed process markers, so concurrent suite runs mistake each other's children for readiness and survivors."
status: todo
priority: 2
size: s
complexity: mid
process: direct
created: 2026-10-12T06:01:59Z
updated: 2026-10-13T01:47:28Z
depends: []
tags: [feedback, friction, "from:relay"]
agent: codex
---

Why: the Darwin probe tests detect readiness and survivors by scanning every process on the host (`ps -axo args=`) for fixed strings, `sleep 600.654` and `sleep 600.321`. test/darwin-probe-runtime.test.js:67 spawns the same `sleep 600.321 & sleep 600.654` shape that tools/darwin-probe/probe.mjs:217 (`--self-test-hang`, stage D1) runs, and node --test runs files in parallel processes. So another file in the same suite, or a second concurrent suite run, can satisfy the readiness poll in test/darwin-probe-orchestrator.test.js:38 before D0 has finished: SIGINT then lands early and the D0 archive entry is missing. The survivor checks (lines 56, 168, 217, 262, 276; runtime :72) can likewise fail on another run's children. Reported: isolated interrupt test passes, two default suite runs lose the initial-stage archive entry; same-suite collision is the leading hypothesis, not proven.

Done: every process marker these tests poll or assert absent is unique to the test that spawns it (e.g. a per-test random sleep duration passed to `--self-test-hang` and to the runtime fixture), and readiness and survivor checks match only that marker. Two concurrent `npm test` runs pass, and the orchestrator SIGINT test passes 10 times in a row under a concurrent suite.

Where: test/darwin-probe-orchestrator.test.js (lines 38, 56, 162-168, 217, 262-276 and the shared psArgs/waitFor helpers), test/darwin-probe-runtime.test.js:67-72, tools/darwin-probe/probe.mjs:96-97 and :217. The probe bundle ships probe.mjs, so keep the default self-test marker working for the Mac runbook.

## Notes

- 2026-10-12T11:23:04Z (feedback): feedback from relay: The full test front door's interrupt readiness check and another test fixture reuse one global process marker across files; isolated interrupt passes while two default suite runs lose the initial-stage archive entry. Same-suite collision is a hypothesis, not causally proved.
