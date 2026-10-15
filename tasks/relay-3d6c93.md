---
id: relay-3d6c93
title: Capture Codex worker rows across /new and /resume in one process
status: idea
priority: 2
created: 2026-10-15T13:23:04Z
updated: 2026-10-15T13:23:04Z
depends: []
tags: []
source: relay-635fdc
agent: claude-code/claude-opus-5-5
---

relay-635fdc's final review: if one Codex process ends a root session and starts another (/new, /resume), a background worker's late hook after the old root's SessionEnd would recreate a worker row on a live handle that neither SessionEnd nor prune removes until the process exits. Capture Codex 0.162.x behaviour across /new and /resume (does SessionEnd fire, do workers survive) before deciding whether the row lifecycle needs another end.
