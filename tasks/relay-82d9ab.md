---
id: relay-82d9ab
title: Delete the stale dist/ output and the gated-off opencode adapter; take darwin-probe out of the default test run
status: todo
priority: 3
size: s
complexity: low
process: direct
created: 2026-10-19T11:55:17Z
updated: 2026-10-19T11:55:17Z
depends: []
tags: []
source: ops-630a87 boundary-proposal-r3.md A1
agent: claude-code/claude-opus-5-5
---

Why: dist/ holds about 4.7 MB of stale probe output, integrations/opencode and its adapter are gated off with no consumer, and darwin-probe slows the default npm test (survey map relay). Done: removed, darwin-probe runs only by its own recipe, suite green. Before landing, pass the flow-trial-1 gate (revision 3, change 5): judge the step's effect on what enrolled sessions see and what obs and the verdict tools measure; a step that changes either waits for readout (2027-02-16).
