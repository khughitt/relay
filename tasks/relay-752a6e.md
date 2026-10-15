---
id: relay-752a6e
title: "Extend the Codex subagent capture: second worker turn, failed turn, background worker, nested worker"
status: doing
priority: 2
size: s
complexity: mid
process: direct
owner: relay-752a6e
created: 2026-10-15T09:27:12Z
updated: 2026-10-15T09:28:47Z
started: 2026-10-15T09:28:41Z
depends: []
parent: relay-eaca0e
tags: []
source: relay-ed3f00
agent: claude-code/claude-opus-5-5
---

Question: relay-ed3f00 captured one worker's single successful turn. The worker-row lifecycle in relay-6825f7 turns on cases it did not exercise: (1) a worker's second turn via send_input: does SubagentStart repeat or only SubagentStop? (2) a failed worker turn (model error, e.g. spawn on a model that does not exist): does SubagentStop fire? relay-6825f7's note from hq-872750 asks this after a capacity error left a worker's claim looking live; (3) a background worker still running after the controller's Stop: which events land after Stop? (4) a nested worker: what agent_id and session_id does a worker's own worker carry, and does anything name its immediate parent?
Bound: extend tools/codex-subagent-capture/run with a prompt per case (or a case argument); same isolation (private CODEX_HOME, auth removed on exit, no relay or user-config change). Codex release as current. No adapter or schema change.
Expected result: brief §7 gains a row table per case and the Not-exercised list shrinks; findings noted on relay-6825f7.

## Notes

- 2026-10-15T09:27:21Z (main): concerns: relay-ed3f00 extension — cases the single-turn capture did not exercise
- 2026-10-15T09:27:33Z (main): Also correct brief §7's last finding: worker events on the root row are invisible while the controller sits in wait_agent (already working); the visible harm is a background worker after the controller's Stop (relay-15b49c has the right framing).
- 2026-10-15T09:28:41Z (main): started
  provenance: {"harness_session":"claude-code:91c56343-8f06-4b5e-91e7-7d018e111bd1","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-15T09:28:47Z (relay-752a6e): resumed
  provenance: {"harness_session":"claude-code:91c56343-8f06-4b5e-91e7-7d018e111bd1","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
