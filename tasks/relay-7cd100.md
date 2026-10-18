---
id: relay-7cd100
title: "Close the release-verification gaps v0.1.0 leaves unowned: live outer-timeout and startup failure, guard probes at the release commit, missing-observer publication"
status: todo
priority: 3
size: m
complexity: mid
process: direct
created: 2026-10-18T20:55:27Z
updated: 2026-10-18T20:55:27Z
depends: []
tags: [testing]
agent: claude-code/claude-opus-5-5
---

Why: the v0.1.0 verification map (docs/runbooks/release.md, 'Verification map') maps the spec's 'Required verification for the release' (ops docs/specs/2026-09-16-relay-design.md) to evidence. Three relay-side clauses have no evidence and no owner:
1. Outer-timeout and startup-failure behaviour in a real Claude Code or Codex session. docs/api.md documents it and test/cli.test.js 'survival limitation: …' simulates it, but ops docs/runbooks/relay-guard-probes.md says these were not induced live.
2. The PreToolUse guard probes (ops-c8e4d1) ran at relay c513320, long before v0.1.0. Since then the Codex adapter gained agent_id routing and installed commands use an absolute node path; the runbook says to rerun after any dispatch change, and no task owns that rerun.
3. No test pairs an observer whose binary is missing with a check that the registry snapshot was still published (test/dispatch.test.js covers hung and noisy observers).
Done: each clause has evidence recorded in the release runbook, or a ruling that it is out of scope.
