---
id: relay-7807fa
title: Re-run relay model's live acceptance when the installed Codex version changes
status: todo
priority: 3
size: xs
complexity: low
process: direct
every: 30d
created: 2026-10-17T16:18:23Z
updated: 2026-10-17T16:18:23Z
depends: []
tags: [codex]
source: "relay:docs/notes/2026-10-17-codex-model-acceptance.md"
agent: claude-code/claude-opus-5-5
---

relay model reads Codex's private rollout layout (day directories keyed by the UUIDv7 thread id, session_meta first, last turn_context), observed on 0.162.1 and 0.163.0 and documented nowhere. Each cycle: compare codex --version with the version in the latest docs/notes/*codex-model-acceptance* note; if it changed, run tools/codex-model-acceptance/run exec "$(mktemp -d)" (about 7 short Codex turns, ~10 min) and append the results to the note; any deviation from the expectations there is a defect in relay model to file. Unchanged version: close the cycle with a note.
