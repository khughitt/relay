---
id: relay-64975d
title: Live acceptance of relay model on Darwin
status: todo
priority: 3
size: s
complexity: mid
process: direct
created: 2026-10-17T16:18:25Z
updated: 2026-10-17T16:18:25Z
depends: []
tags: [codex, darwin-probe]
source: "relay:docs/notes/2026-10-17-codex-model-acceptance.md"
agent: claude-code/claude-opus-5-5
---

relay model's Darwin path (start interval from ps lstart, truncated to the second: lo = lstart*1000, hi = lo+999; ancestry through ps) is unit-tested only; the live acceptance ran on Linux. On a Mac with Codex installed, run tools/codex-model-acceptance/run exec and the TUI background-terminal case (step 6), and record results like docs/notes/2026-10-17-codex-model-acceptance.md. Expect more turn-boundary answers on current calls than Linux's 0 of 25 because of the one-second start resolution; record their rate. The sandbox case (pid-1 codex) has no Darwin equivalent. Bundle with the next Mac handoff (see relay-c19c0a).
