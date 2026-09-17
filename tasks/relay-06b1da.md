---
id: relay-06b1da
title: "Extract adapters, process identity and atomic registry"
status: doing
priority: 1
size: l
complexity: high
process: planned
owner: relay-06b1da
created: 2026-09-17T00:50:54Z
updated: 2026-09-17T07:40:04Z
started: 2026-09-17T06:54:50Z
depends: [relay-377bc5]
parent: relay-1231bf
tags: []
source: ops-998bbb
agent: codex
spec: docs/specs/2026-09-17-registry-lock-safety.md
plan: docs/plans/2026-09-17-extraction.md
step: "Task 1: Extract harness observation and the registry"
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

## Notes

- 2026-09-17T06:54:50Z (main): User requested the next step after bootstrap. Reuse approved ops relay spec; draft focused extraction implementation plan with exact exported APIs, file/test mapping, process/lock semantics and dispatcher handoff before runtime code. Planned work in .worktrees/relay-06b1da.
- 2026-09-17T06:58:56Z (relay-06b1da): Extraction investigation found a parent-contract gap in familiar lock.js: a still-live writer is reclaimed after 10s; the .reclaim guard is also deleted solely by age after 5s. Isolated deterministic reproduction observed two callbacks in the critical section. Proposed addendum retains dead-writer recovery and Node built-ins, forbids revoking live/unknown owners, and makes abandoned reclaimer/corrupt token recovery an explicit operator repair. Needs design addendum review before finalizing extraction plan; no runtime or familiar changes.
- 2026-09-17T06:58:56Z (relay-06b1da): parked (waiting on user, review): Review .worktrees/relay-06b1da/docs/specs/2026-09-17-registry-lock-safety.md: never expire live/unknown lock owners; preserve ordinary dead-writer recovery; explicit repair for abandoned reclaimer. After addendum approval finalize the focused extraction implementation plan for separate review.
- 2026-09-17T07:01:12Z (relay-06b1da): User approved the registry lock safety addendum at 4050368. Finalize the focused extraction plan with Node built-ins, no live-owner expiry, qualified atomic lock tokens, ordinary dead-writer recovery and explicit abandoned-reclaimer repair. Runtime code remains gated on plan review.
- 2026-09-17T07:16:12Z (relay-06b1da): Focused extraction plan is ready for review: exact public exports, twenty normalized mappings, qualified process fixtures, approved safe lock recovery, atomic snapshot tests, extracted OpenCode modules, package/CLI checks and operator repair runbook. Self-review corrected the normalizer import direction and made the held-writer test complete. Verified source inputs unchanged from familiar 70ae8ed to cb7aed4; all 10 JS, 4 JSON and 1 shell snippets parse; integer examples and Darwin epoch assertion pass. Runtime is not implemented. R2 owns reap observer notification even when unchanged; R1 returns its result without a dispatcher stub.
- 2026-09-17T07:16:12Z (relay-06b1da): parked (waiting on user, review): Review .worktrees/relay-06b1da/docs/plans/2026-09-17-extraction.md. The lock addendum is approved; this focused plan needs its own review before executing the six extraction phases.
- 2026-09-17T07:29:12Z (relay-06b1da): User approved extraction plan with edits: publish reclaimPath; specify process-unavailable diagnostics versus Git failure; enumerate boot/deadline/cleanup lock tests and initial ENOENT race; retain OpenCode raw key for familiar projection; exclude PID 1; document private directory rejection; verify Node 22.23.2 gate. Keeping one task with phase progress in notes. Proceed with the approved implementation.
- 2026-09-17T07:32:53Z (relay-06b1da): Phase 1: protocol missing-module red; five contract tests green; front door adopted and setup/check passed.
- 2026-09-17T07:37:32Z (relay-06b1da): Phase 2: precision red reproduced; 31 tests green including fresh Linux proof and portable Darwin/DST parsing; Git bounds and strict error classification extracted.
- 2026-09-17T07:40:04Z (relay-06b1da): Phase 3: 53 tests green; all twenty literal mappings, measured resolver regressions and bounded stdin normalization implemented.
