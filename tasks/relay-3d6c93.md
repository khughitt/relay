---
id: relay-3d6c93
title: Capture Codex worker rows across /new and /resume in one process
status: todo
priority: 2
size: s
complexity: mid
process: direct
created: 2026-10-15T13:23:04Z
updated: 2026-10-17T16:18:21Z
depends: []
tags: []
source: relay-635fdc
agent: claude-code/claude-opus-5-5
---

Why: relay-635fdc's final review. One Codex process can change its root session: the 0.162.1 TUI offers /new ("start a new chat during a conversation"), /resume ("resume a saved chat") and /fork ("fork the current chat"), per the binary's strings. A worker row ends only with its root's SessionEnd cascade or the prune of its dead process (src/bus/transaction.js:62-67; docs/api.md, "A worker row ends only with its root"). So if one process ends a root session and starts another, a background worker's late hook after the old root's SessionEnd recreates codex:<agent_id> (root codex:<old>) on a live handle that neither SessionEnd nor prune removes until the process exits; and if a switch fires no SessionEnd at all, the old root row and its workers stay the same way. Whether either happens is unmeasured, and it decides whether the row lifecycle needs another end. The same capture answers a premise of relay-2cd4b1: whether a tool call's CODEX_THREAD_ID follows the switch (hq-1bd166 probed only exec resume, a new process). Not live on this host yet: ~/.codex/hooks.json still runs familiar's hooks until relay-1231bf migrates them.

Done: one live run each of three new capture cases (new, resume, fork) on Codex 0.162.x with --relay. In each, the root spawns a background worker (sleep about 15 s) and ends its turn without waiting; the switch is sent before the worker finishes; the new root then runs one command printing CODEX_THREAD_ID and CODEX_SESSION_ID. Recorded per case: whether the old root's SessionEnd fires, and its reason; the new root's SessionStart; whether the worker keeps running and which session_id its later hooks carry; the registry after each relay event and before /quit, while the process still lives; and whether the new root's CODEX_THREAD_ID names its own thread. Results go in a new section of docs/notes/2026-10-15-codex-worker-rows-acceptance.md and a note here, ending in a verdict: no row outlives its root on a live handle, or the leak's exact shape, filed as a planned follow-up for the extra end rather than fixed here. A note on relay-2cd4b1 carries the CODEX_THREAD_ID finding.

Where: tools/codex-subagent-capture/run (the background case drives the TUI in a detached tmux session, and send-keys needs its one-second pause before Enter; --relay installs relay's hooks under a private CODEX_HOME and relay state and copies the registry after each event); judge-registry.mjs (it tracks one previousRoot across all records, so a run with two roots needs per-root tracking; relay-105775 separately asks it to judge root-row versions by publication); summarize.mjs; "Row lifecycle" in docs/specs/2026-10-15-codex-worker-rows.md. /resume needs a saved session in the private home: run one codex exec there first, then pass its id or pick it.

Bound: the three cases and the judge changes they need; no change to src/, the registry contract or the live Codex config. Each run spends Codex model turns under the user's auth, as the earlier captures did.

## Notes

- 2026-10-15T22:17:20Z (main): scope: scoped; rewrote as a three-case TUI capture (/new, /resume, /fork) with --relay, checked against main d7ac402 (src/bus/transaction.js:62-67 cascade, tools/codex-subagent-capture background case) and the codex-cli 0.162.1 binary's slash-command strings; added the CODEX_THREAD_ID-after-switch reading relay-2cd4b1's spec needs; todo P2 s/mid/direct
- 2026-10-17T16:18:21Z (main): relay-2cd4b1's live acceptance (docs/notes/2026-10-17-codex-model-acceptance.md, TUI steps 3-5, codex-cli 0.163.0) answered this task's CODEX_THREAD_ID premise: a tool call's CODEX_THREAD_ID follows /new, /resume and /fork in one TUI process (each names its own active thread). The row-lifecycle questions (SessionEnd on switch, worker rows outliving their root) remain open
