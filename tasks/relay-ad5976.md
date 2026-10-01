---
id: relay-ad5976
title: Name tasks 0.2.0 in the schema-2 activation runbook now that tasks-2dd094 has landed
status: done
priority: 2
size: xs
complexity: low
process: direct
owner: relay-ad5976
created: 2026-09-23T20:55:42Z
updated: 2026-10-01T15:39:40Z
started: 2026-10-01T15:38:43Z
completed: 2026-10-01T15:39:40Z
depends: []
tags: [docs]
agent: "claude-code/claude-opus-5-5[1m]"
---

docs/runbooks/hook-install-rollback.md, 'Activating session handles (registry schema 2)', still says 'Until tasks-2dd094 lands there is no such binary, so treat every tasks binary as old'. It landed on tasks main at 88bd28d and ships as tasks 0.2.0, which an operator can check with 'tasks --version' for each tasks on PATH in each harness's environment. Replace the landing-commit wording with the 0.2.0 minimum and drop the 'until it lands' sentence; the rest of the paragraph (why an older tasks is unsafe) stays.

## Notes

- 2026-10-01T15:38:43Z (main): started
- 2026-10-01T15:39:01Z (relay-ad5976): resumed
- 2026-10-01T15:39:01Z (relay-ad5976): took over session sid:2149991 (owner main, stale)
- 2026-10-01T15:39:40Z (relay-ad5976): done
- 2026-10-01T15:39:40Z (relay-ad5976): Name tasks 0.2.0 as the schema-2 activation minimum in the runbook; dropped the landing-commit wording
