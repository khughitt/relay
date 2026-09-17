---
id: relay-4c4828
title: Dispatch bounded guards and observers with native replies
status: doing
priority: 1
size: l
complexity: high
process: planned
owner: main
created: 2026-09-17T00:50:54Z
updated: 2026-09-17T11:14:45Z
started: 2026-09-17T11:14:45Z
depends: [relay-06b1da]
parent: relay-1231bf
tags: []
source: ops-998bbb
agent: codex
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
