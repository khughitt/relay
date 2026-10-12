---
id: relay-a7aea1
title: "Process tests use global fixed process markers, so concurrent suite runs mistake each other's children for readiness and survivors."
status: idea
priority: 2
created: 2026-10-12T06:01:59Z
updated: 2026-10-12T11:23:04Z
depends: []
tags: [feedback, friction, "from:relay"]
agent: codex
---

## Notes

- 2026-10-12T11:23:04Z (feedback): feedback from relay: The full test front door's interrupt readiness check and another test fixture reuse one global process marker across files; isolated interrupt passes while two default suite runs lose the initial-stage archive entry. Same-suite collision is a hypothesis, not causally proved.
