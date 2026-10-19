---
id: relay-4038bd
title: "Publish the public interfaces transponder's inbox needs (whoami, list, store transaction) after a contract review"
status: todo
priority: 2
size: m
complexity: mid
process: planned
created: 2026-10-19T11:56:07Z
updated: 2026-10-19T11:56:07Z
depends: []
tags: []
source: ops-630a87 boundary-proposal-r3.md A5
agent: claude-code/claude-opus-5-5
---

Why: the inbox code (serve, inbox, presence, ask) imports relay internals (bus/transaction, bus/proc), so it cannot leave relay until those become public interfaces (revision 3, A5). Contract review with transponder: relay whoami --json, relay list --json, whatever transaction primitive the inbox store needs, and the message schema transponder will own. Done: reviewed contract; the interfaces published and tested by their producer; no inbox code reaches into relay internals. Before landing, pass the flow-trial-1 gate (revision 3, change 5): judge the step's effect on what enrolled sessions see and what obs and the verdict tools measure; a step that changes either waits for readout (2027-02-16).
