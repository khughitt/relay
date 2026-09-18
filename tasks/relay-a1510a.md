---
id: relay-a1510a
title: Honor Codex PreToolUse context and denial replies
status: todo
priority: 1
size: m
complexity: high
process: planned
created: 2026-09-18T20:19:44Z
updated: 2026-09-18T20:19:44Z
depends: []
tags: []
source: ops-c8e4d1
agent: codex
---

The 2026-09-18 ops relay-guard probe at relay b5fbde5 recorded Codex 0.155.0 sending Bash tool_input.command to relay. Relay's offline replies carried context and deny, but the live harness returned NO-CONTEXT and no attributed command_execution refusal. Investigate relay's Codex reply encoder/adapter with the recorded redacted fixtures in ops docs/runbooks/relay-guard-probes.md; preserve fail-closed command shapes.
