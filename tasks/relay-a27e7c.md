---
id: relay-a27e7c
title: Implement the Codex app-server question connector
status: todo
priority: 2
size: m
complexity: high
process: planned
created: 2026-10-13T17:29:20Z
updated: 2026-10-13T17:31:22Z
depends: [relay-f58531]
tags: []
source: "relay-f58531:codex-question-connector"
agent: codex
---

Why: relay-f58531 delivered and verified the Claude interactive-terminal route. ops-cb50a8 milestone 4 and its completion criterion still require a Codex question answered from the phone and, separately, deferred to the desktop.

Approach: start from the accepted typed-interaction spec section 9.3 and the existing durable inbox/socket contracts. Prepare a reviewed implementation plan, with a spec addendum only if version-specific probes expose an unsettled contract. Use the currently installed Codex app-server capability evidence; consume the relevant Codex findings from hq-25665e. Resolve mode-specific receipt, defer and recovery unknowns before enabling that mode. Start with the blocking Plan-mode requestUserInput route; keep Default-mode async/new-turn delivery and codex exec as named later scope. Do not couple this work to unrelated OpenCode probes or worker-registration work.

Done: the connector maps native item/turn ids and stable option ids, delivers answers and confirms native receipt, supports defer to the native desktop, preserves first-answer-wins and idempotent retry, and rejects late answers after daemon recovery/re-ask. Meaningful unit/IPC checks pass through the front door on Node22 and the development runtime; installed-version evidence and a user-present phone answer/defer run are recorded, with temporary state/settings isolated and cleanup verified. No authorization semantics, new root library export or public-host exposure.

Where: relay docs/specs/2026-10-11-typed-interaction-messages.md section 9.3, src/serve, src/routes, and hq answer-route facts; hq-25665e.

## Notes

- 2026-10-13T17:31:22Z (main): concerns: relay-f58531 extension — implement the specified Codex connector for the second-harness milestone.
