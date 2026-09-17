---
id: relay-4c4828
title: Dispatch bounded guards and observers with native replies
status: done
priority: 1
size: l
complexity: high
process: planned
owner: relay-4c4828
created: 2026-09-17T00:50:54Z
updated: 2026-09-17T13:20:37Z
started: 2026-09-17T11:14:45Z
completed: 2026-09-17T13:02:41Z
depends: [relay-06b1da]
parent: relay-1231bf
tags: []
source: ops-998bbb
agent: codex
plan: docs/plans/2026-09-17-dispatch.md
---

Approved source: ops docs/specs/2026-09-16-relay-design.md (reviewed after d7e2c33); execution brief: ops docs/plans/2026-09-16-relay-bootstrap.md (approved after bc53c51 with review corrections).

Next: write a focused implementation plan against the approved spec for user review; add a spec addendum only if inspection uncovers an unresolved contract.

Create relay `src/dispatch.js`, `src/subscribers.js`, native reply encoders beside
their adapters, and `test/{dispatch,subscribers,replies}.test.js`. Consume relay-06b1da's
normalized Event and snapshot functions; produce validated Reply/native output
and sanitized observer notifications. The plan must nail down the executable
config and reconciliation envelope before fam-6e8321 depends on them.

Test guards before optional enrichment; missing storage/theme failure cannot bypass
them. Validate kinds/harness/tool filters, config ownership, unique names, absolute
argv executables, output size, denial reasons, unsupported response channels and
reply context limits. Full tool input goes only to selected tool guards. Preserve
environment inheritance without logging it. Native stdout is exclusively relay's.

Use a monotonic total deadline, per-child bounds, termination/reply reserve and
worst-match config validation. Test timeout, spawn failure, invalid JSON, mixed
allow/deny, slow observer after denial, registry lock exhaustion and denied Stop
continuation with `stopHookActive`. All matching guards retain configuration order;
optional observers cannot delay a denial. Preserve the spec's survival limitation
as a tested distinction from missing-Node/early-crash/outer-timeout behavior.
Codex SessionEnd gets its own budget within the documented 1s default/3s cap;
Interrupt remains unmapped. No retry queue or background daemon.

Prerequisites: relay-06b1da. Release goal: relay-1231bf. Bootstrap ops-998bbb closure does not mean this deliverable has shipped.

## Notes

- 2026-09-17T11:29:26Z (relay-4c4828): Plan drafted at docs/plans/2026-09-17-dispatch.md for user review; decisions: --outer-ms budget flag with derived profile, subscribers.json schema, guard reply/observer envelope, exit codes; native reply/timeout facts verified against both hook references 2026-09-17
- 2026-09-17T11:29:43Z (relay-4c4828): parked (waiting on user, review): User reviews docs/plans/2026-09-17-dispatch.md; on approval execute Task 1 (relay-ca9835) onward in .worktrees/relay-4c4828
- 2026-09-17T11:43:43Z (relay-4c4828): Review round 1 folded into plan (dd898d0): bounded I/O + explicit exit, paths inside refusal boundary, denial before channel check, teardown subscription, test setup fixes
- 2026-09-17T11:50:48Z (relay-4c4828): Review round 2 folded in: reclaim-guard exception documented and tested, per-harness example config validated for every event, reap-timeout and lock test fixes
- 2026-09-17T13:02:41Z (relay-4c4828): Dispatch implemented; gate green on Node 26 and 22; live probes remain ops-c8e4d1
- 2026-09-17T13:02:41Z (relay-4c4828): relay hook/reap dispatch guards, observers and native replies under one budget; installer and live probes follow
- 2026-09-17T13:20:37Z (relay-4c4828): Final reply-limit regression added after closeout; gate green on Node 26 and 22 with 187 tests; final branch review resolved
