---
id: relay-baa816
title: Prepare validated hook installers and rollback artifacts
status: done
priority: 1
size: l
complexity: high
process: planned
owner: main
created: 2026-09-17T00:50:54Z
updated: 2026-09-17T15:21:06Z
started: 2026-09-17T13:34:45Z
completed: 2026-09-17T15:21:06Z
depends: [relay-4c4828]
parent: relay-1231bf
tags: []
source: ops-998bbb
agent: codex
plan: docs/plans/2026-09-17-installers.md
---

Approved source: ops docs/specs/2026-09-16-relay-design.md (reviewed after d7e2c33); execution brief: ops docs/plans/2026-09-16-relay-bootstrap.md (approved after bc53c51 with review corrections).

Next: write a focused implementation plan against the approved spec for user review; add a spec addendum only if inspection uncovers an unresolved contract.

Create relay `src/install/{claude-code,codex,opencode}.js` and installer tests,
reusing familiar `src/install/atomic.js` and the relevant existing config-editing
logic. Extend `bin/relay.js` for the approved install command. Produce an exact
diff/before-image for each target; preserve unrelated settings, detect ambiguous
ownership and duplicate writers, validate budgets and capability evidence before
enabling a binding. Files change by atomic rename; multi-file atomicity is not
claimed. Test exact rollback and partial-cutover recovery with isolated fixtures.

Use existing familiar `test/{install-atomic,install-codex-single,install-opencode,
install-opencode-cli}.test.js` as regression inputs; retain sprite-only install
behavior in familiar. This task prepares installer machinery and disposable
capability-probe configurations. It never edits the operator's live settings.

Prerequisites: relay-4c4828. Release goal: relay-1231bf. Bootstrap ops-998bbb closure does not mean this deliverable has shipped.

## Notes

- 2026-09-17T13:34:53Z (main): Planned path: verify approved ops design and bootstrap brief, then draft relay plan in an isolated worktree for review.
- 2026-09-17T13:38:43Z (relay-baa816): Draft installer plan is ready at docs/plans/2026-09-17-installers.md; no spec addendum needed after current native-doc and R2 contract check.
- 2026-09-17T14:13:49Z (relay-baa816): Revised installer plan after review: Codex hooks.json only, explicit three-way ownership, JSONC edits, evidence schema/inputs, timeout units, matcher table, and per-file recovery.
- 2026-09-17T14:19:40Z (relay-baa816): Final review corrections applied: rollback artifact-only, dynamic installer imports with lock/setup and no-node_modules hook test, evidence refusal semantics, familiar command variants, duplicate OpenCode relay refusal.
- 2026-09-17T14:23:27Z (relay-baa816): Implementation plan approved 2026-09-17; attached before filing child tasks.
