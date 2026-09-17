---
id: relay-06b1da
title: "Extract adapters, process identity and atomic registry"
status: todo
priority: 1
size: l
complexity: high
process: planned
created: 2026-09-17T00:50:54Z
updated: 2026-09-17T00:50:54Z
depends: [relay-377bc5]
parent: relay-1231bf
tags: []
source: ops-998bbb
agent: codex
---

Approved source: ops docs/specs/2026-09-16-relay-design.md (reviewed after d7e2c33); execution brief: ops docs/plans/2026-09-16-relay-bootstrap.md (approved after bc53c51 with review corrections).

Next: write a focused implementation plan against the approved spec for user review; add a spec addendum only if inspection uncovers an unresolved contract.

Move familiar `src/adapters/{index,payload,claude-code,codex,opencode}.js` and the
nonvisual pieces of `src/bus/{proc,lock,store,paths,prune,identity,transaction}.js`
into corresponding relay paths. Rewrite transaction admission around the approved
snapshot, removing theme resolution. Keep familiar's `autoSlot`, pins, hashes used
for slots, and `printsPlaceholderCells` with presentation. Move observation-only
OpenCode `integrations/opencode/{binding,window,queue,hook,plugin}.js`; retain the
TUI sprite files in familiar and rename the moved plugin's exported entry point.
Copy the MIT notices with extracted code.

Create `package.json`, `bin/relay.js`, and one explicit package export entry point
for the approved adapter/process/registry surface. No deep consumer imports.
Record exact exported signatures in relay-06b1da's plan before relay-4c4828/fam-6e8321 use them. Implement
`relay list --json` and `relay reap` with stable error envelopes. Reap reconciliation
must not manufacture a native event or run a guard. Adopt ops templates and vendored
`tools/tt`/`tools/ops-check`; use `node --test` through the front door unless retained
tests demonstrably require familiar's runner. Add installer parser dependencies
only in relay-baa816 if its actual formats require them, outside the hook import graph.

Port familiar `test/{claude-code,codex,opencode,proc,store,lock,lock-multiprocess,
paths,prune,identity,transaction}.test.js`, `test/fixtures/lock-worker.js`, relevant
helpers, and OpenCode `binding/window/queue/hook.test.mjs`. Split mixed visual
tests by responsibility. Cover every mapping and input bound; Linux zombies,
reboot, PID reuse, unreadable evidence, foreign host; Darwin fixtures; lock-owner
death, concurrent writers, corruption, generation recreation and read-only list.

Put portable schema/handle cases in `test/fixtures/handles.json`, publish that
fixture through the documented package file set, and record its revision for tasks-c9199a to
copy into Rust tests. Include a normal proc sample and `9007199254740993` as a
**synthetic format/precision test**, not a plausible uptime. Assert exact string
round-trip, u64 maximum and overflow rejection, decimal syntax, missing Linux boot
ID, Darwin epoch seconds with a controlled timezone, and unknown-schema rejection.
No JS Number conversion on the Linux start path. Incompatible changes require a
schema bump and coordinated tasks reader update once that reader exists.

Prerequisites: relay-377bc5. Release goal: relay-1231bf. Bootstrap ops-998bbb closure does not mean this deliverable has shipped.
