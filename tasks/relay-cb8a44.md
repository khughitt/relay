---
id: relay-cb8a44
title: "The installed ask route survives a Claude Code upgrade with no way to remove it, and its evidence cannot be combined with guard dispatch probes"
status: doing
priority: 2
size: m
complexity: mid
process: direct
owner: main
created: 2026-10-13T18:15:32Z
updated: 2026-10-13T18:30:54Z
started: 2026-10-13T18:30:54Z
depends: []
tags: []
source: "review:bc4ef2f"
agent: claude-code/claude-opus-5-5
---

Why:

1. `routeBindings` (src/install/hooks.js:68-81) throws UNSUPPORTED_BINDING whenever the route evidence is missing, failed, or recorded for another Claude Code version. `planClaudeCode` (src/install/claude-code.js:9) calls `planRouteHooks` only under `--with ask`. So the reconciliation that `planRouteHooks` promises never runs on a version change (an owned entry whose event has no row is removed). After a Claude Code upgrade, `install --with ask` refuses, and `install` without it leaves the 86400 s blocking PreToolUse route installed on a version that was never probed. That contradicts spec §11: evidence holds only for the version it was probed on.
2. A single `--evidence` file feeds both `validateCapabilities` and `routeBindings`. `validateCapabilities` needs the dispatch `probes` whenever a guard subscriber matches; `routeBindings` needs the `routes`. But docs/evidence/claude-code-answer-routes.json has `probes: []`. With a guard subscriber, the documented command (docs/api.md:722) fails with `missing capability probe (claude-code,PreToolUse,refuse)`, and the tests use only empty subscriber sets. The live installation still to come has guard subscribers.

Approach:
- `install` without `--with ask` plans route rows `[]`, so it removes any owned ask entries and the plan lists the removal. The command explicitly names the hooks wanted.
- `--with ask` with stale evidence still refuses.
- Take route evidence through its own flag (`--route-evidence FILE`), or document and test one merged file. Record the choice in a note. Recommended: the separate flag, because the two evidence sets come from different probes and runbooks.

Done:
- An upgrade test (evidence for 2.1.296, installed 2.1.300): `install` without `--with ask` removes both ask entries and leaves the dispatch hooks; `--with ask` refuses.
- A guard subscriber plus both evidence sets plans successfully.
- docs/api.md, docs/runbooks/answer-route-probes.md and docs/runbooks/inbox-service.md are updated.
- `just test-fast` passes on Node 22 and the dev runtime.

Where: src/install/hooks.js:62-104, src/install/claude-code.js, bin/relay.js:186-196, test/install-routes.test.js, test/install-cli.test.js.

## Notes

- 2026-10-13T18:16:26Z (main): concerns: relay-f58531 defect — ask-route install cannot be removed after a harness upgrade and its evidence file conflicts with guard dispatch probes
- 2026-10-13T18:30:54Z (main): started
  provenance: {"harness_session":"claude-code:cee0471d-7415-41b5-933e-f3803576f4bb","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
