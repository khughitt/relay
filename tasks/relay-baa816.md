---
id: relay-baa816
title: Prepare validated hook installers and rollback artifacts
status: todo
priority: 1
size: l
complexity: high
process: planned
created: 2026-09-17T00:50:54Z
updated: 2026-09-17T00:50:54Z
depends: [relay-4c4828]
parent: relay-1231bf
tags: []
source: ops-998bbb
agent: codex
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
