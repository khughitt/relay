---
id: relay-1231bf
title: Extract harness observation; migrate familiar and prove guard dispatch
status: todo
priority: 1
size: l
complexity: high
process: planned
created: 2026-09-17T00:49:49Z
updated: 2026-10-22T12:04:10Z
depends: [fam-6e8321, ops-c8e4d1, hq-539508]
tags: []
source: ops-998bbb
agent: codex
---

Release goal: schema-1 adapters/registry, bounded dispatcher and verified installers; familiar migration and proven ops guard dispatch, followed by operator cutover. Completion requires the local implementation children plus linked fam, ops and ai work and release evidence. Local bootstrap alone is not a release. Approved design: ops docs/specs/2026-09-16-relay-design.md, approved after d7e2c33. Bootstrap and work-package plan: ops docs/plans/2026-09-16-relay-bootstrap.md, approved after bc53c51 with ordering and filing corrections. Tasks identity is separately scoped and does not gate this release.

## Notes

- 2026-10-22T12:04:10Z (main): 2026-10-22 (hq-539508 cutover complete, window 20261022T014303Z-a1e7bd47): cut over on Linux titan and europa — Claude Code personal and work homes on both hosts and Codex personal and work homes on titan dispatch through relay v0.1.1 with ops relay-guard on Bash and familiar as observer; six live smoke receipts validated. Awaiting: OpenCode (relay-d0a8df), Darwin (relay-848c0f with fam-f088b1), Codex code-mode (ops-daf2cd). Found live: relay-cfd24b (claude-code terminal lookup ignores the versioned binary name).
