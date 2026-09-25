---
id: relay-b12132
title: "Darwin live probe: a self-contained bundle that proves relay's Darwin paths on a physical Mac"
status: todo
priority: 1
size: m
complexity: mid
process: planned
created: 2026-09-25T10:57:49Z
updated: 2026-09-25T10:57:49Z
depends: []
parent: relay-1231bf
tags: []
source: ops-c8e4d1
agent: claude-code/claude-opus-5-5
---

The release gate relay-c19c0a carries: physical Darwin process/terminal verification has not run (relay-06b1da note; ops docs/plans/2026-09-16-relay-bootstrap.md 'physical Darwin validation remains a release gate'). Build a bundle (npm pack tarball + probe driver) the user copies to their MacBook and runs with one command; it records the Mac's environment and harnesses, exercises every Darwin-sensitive relay surface live, and writes a results directory the user copies back for judging on titan. Decided 2026-09-25: bundle, not ssh. Design against the approved ops relay spec; plan for review before building.
