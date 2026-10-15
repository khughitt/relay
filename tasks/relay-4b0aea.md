---
id: relay-4b0aea
title: Darwin-probe test fixtures die with their test process when a run is interrupted
status: todo
priority: 3
size: s
complexity: mid
process: direct
created: 2026-10-15T08:56:13Z
updated: 2026-10-15T22:27:43Z
depends: []
tags: [feedback, friction, "from:relay"]
agent: codex
---

Reported (feedback, Codex, 2026-10-15): "An interrupted test run left detached probe fixture processes alive; successful runs cleaned them up, but signal interruption bypassed that cleanup."

Why: reproduced at scoping with a scratch test under node --test on v26.5.0 and v22.23.2. The test spawns a detached child and kills it in t.after. SIGINT or SIGTERM to the runner or to its whole process group, or SIGKILL to the runner, exits 1 without running t.after, and the child survives. A process.on('exit') handler in the test file does not run either: the signalled test-file process never reaches process.exit, so no cleanup inside the test process can fix this. Three test files call tools/darwin-probe/lib/context.mjs's tracker() directly and reap only in t.after(killAll): test/darwin-probe-runtime.test.js, test/darwin-probe-stages-c.test.js (D5, D8) and test/darwin-probe-stages-d.test.js (D6 replay). The tracker spawns every child detached in its own process group, so even a Ctrl-C to the terminal's group misses them. The worst survivors are constructed parents: tools/darwin-probe/lib/parent.c ends in for (;;) pause(), so each lives forever under the name codex. The runtime tests' sleeps (uniqueSleeps, 600.<tag>) end after ten minutes.

Already covered: probe.mjs handles SIGINT, SIGTERM and SIGHUP and reaps through killAll, and test/darwin-probe-orchestrator.test.js proves no grandchild survives. relay's own subscriber children (src/child.js) are not detached, so the hang-fixture tests from b518142 are a separate, smaller case (only a signal to the runner alone orphans them), left to relay-413a0c.

Done: an interrupted run of each of the three files leaves no fixture alive within a few seconds, under SIGINT and SIGTERM to the runner and to its group and under SIGKILL to the runner, on Node 22 and the development runtime. A regression test drives one interrupted node --test run of a tracker fixture and asserts that. The probe's own stages and orchestrator tests pass unchanged.

Approach: tie each long-lived fixture's life to its spawner, not to a cleanup hook in the killed process. After its payload, parent.c exits once getppid() differs from the pid that started it, since an orphan is reparented; this works alike on Darwin and Linux. The runtime tests' sleeps get a bound far below 600 s, or the same tie. The tracker's detached groups and probe.mjs's signal path stay as they are: the probe measures these process shapes on the Mac (docs/specs/2026-09-25-darwin-probe.md), and the tie changes nothing while the spawner lives. If a stage needs a constructed parent to outlive its spawner, or the tie changes a probe reading, record it and change this task to planned.

Where: tools/darwin-probe/lib/context.mjs (tracker, killAll), lib/parent.c, lib/parents.mjs (startParent, checkParent), lib/fleet.mjs; the three test files above; test/darwin-probe-orchestrator.test.js for how the probe's interrupt tests drive signals.

## Notes

- 2026-10-15T22:27:43Z (main): scope: scoped; reproduced on node v26.5.0 and v22.23.2 (SIGINT/SIGTERM to runner or group, SIGKILL to runner: neither t.after nor an exit handler runs, the detached child survives), traced to the three tests that call the darwin-probe tracker directly and parent.c's endless pause() (main d7ac402); retitled to the outcome, kept the report verbatim; todo P3 s/mid/direct (only interrupted runs leak, and the survivors are idle)
