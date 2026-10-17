---
id: relay-2cd4b1
title: "Resolve a Codex session's model from its own rollout, keyed on CODEX_THREAD_ID"
status: doing
priority: 2
size: m
complexity: mid
process: planned
owner: feat/codex-model-resolver
created: 2026-10-15T00:39:58Z
updated: 2026-10-17T12:29:31Z
started: 2026-10-17T10:34:15Z
depends: []
tags: []
source: "lore:docs/notes/2026-10-02-codex-model-identity-brief.md"
agent: claude-code/claude-opus-5-5
spec: docs/specs/2026-10-17-codex-model-resolver.md
---

Why: Codex sessions stamp TASKS_AGENT=codex with no model, so task stamps and review notes lose the model half (goal hq-fce47e, which depends on this task; tasks-970049, the consumer, depends on it too).

Evidence (hq-1bd166, codex-cli 0.162.1; lore brief docs/notes/2026-10-02-codex-model-identity-brief.md §5): CODEX_THREAD_ID -> ${CODEX_HOME:-$HOME/.codex}/sessions/*/*/*/rollout-*-<thread>.jsonl -> last turn_context.model resolved the running model in a top-level session before and after an exec resume -m switch and in multi-agent v2 children spawned on another model. In a child CODEX_SESSION_ID is the root session's id, so keying on it stamps the parent's model. session_meta (base_instructions.provenance.model) is an inherited or creation-time value that can match no running model, and a forked child's rollout begins with its own session_meta (forked_from_id), then the parent's session_meta and turn_context, so only the last turn_context counts and id validation reads the first session_meta. Between a resume -m and the next turn's turn_context the last turn_context is stale, so the resolver is valid only inside a tool call, never from a SessionStart or UserPromptSubmit hook (PreToolUse fires after the turn_context and was not shown stale). Hook payloads carry the correct per-agent model, plus agent_id (the child's thread id) and agent_transcript_path at SubagentStop; the shell cannot read them unless a hook stores them. state_5.sqlite's threads table also records model and rollout_path per thread (update timing unprobed).

Proposed: a resolver command printing codex/<model> (and effort if wanted), or bare codex when the thread id is unset, zero or several rollouts match, or no turn_context exists; skip an unparseable trailing line; never the session id, session_meta or config. Consumer: tasks, when TASKS_AGENT is bare codex (a separate tasks piece).

Established at scoping (2026-10-15, relay main d7ac402, this host):
- relay's hooks are not live for Codex here (~/.codex/hooks.json runs familiar's until relay-1231bf), so the registry is no model source yet, and the hook-adapter cross-check keyed on agent_id waits on that migration.
- A codex-named ancestor survives the workspace-write sandbox: there, tasks' relay identity check reports "the nearest codex ancestor is pid 1 with no parent" (docs/notes/2026-10-15-codex-worker-rows-acceptance.md, sandboxed control). An ancestry test sees the namespace-local helper; matching a registry handle does not.
- Lookup cost: the store holds 16,287 rollouts in 238 day directories, plus 594 in the flat archived_sessions. A full readdir scan took about 0.13 s, and relay's CLI starts in 0.10-0.15 s (relay --help). Every rollout's day directory equals the local date of its thread id's UUIDv7 timestamp (16,287 of 16,287): an observed layout, not a documented contract.

Done: a reviewed design spec and plan (docs/specs/, docs/plans/), then the resolver in relay with tests and docs/api.md. It prints codex/<model> in a top-level session, in a child, and after a resume -m switch, and bare codex in each case listed under Proposed; the call contract tasks-970049 needs (command, output, exit code, time budget) is written down.

The spec decides, from the original open list: (1) the command's name and home in relay (lean: a subcommand declared in src/commands.js, one Node start per tasks stamp); (2) a rule for processes that inherit CODEX_THREAD_ID from a Codex session, such as a tmux server or another harness (lean: require a codex-named ancestor and print bare codex without one; confirm that a tmux server or setsid process started from a Codex tool call loses it); (3) how to locate the rollout: the UUIDv7 day directory, the glob, state_5.sqlite (node:sqlite, against the Node 22 floor) or app-server thread/read, with archived_sessions covered either way, since the glob misses it; (4) ephemeral sessions (no rollout means bare codex, if confirmed); (5) whether a tool call's CODEX_THREAD_ID follows the TUI's /new, /resume and /fork in one process (relay-3d6c93 records it); (6) whether the effort is printed, and how a fallback to bare codex reports its reason rather than passing silently.

Where: lore brief §4-§6; src/commands.js and bin/relay.js for the command surface; src/adapters/codex.js and src/adapters/ancestry.js (resolveSessionPid's codex match); obs's codex_adapter.py:66-69 reads the same turn_context fields; tasks-970049 for the consumer.

## Notes

- 2026-10-15T22:17:52Z (main): scope: scoped; kept the hq-1bd166 evidence and proposal, added what scoping established (no live relay Codex hooks on this host, a codex-named ancestor survives the workspace-write sandbox, 16,287-rollout lookup cost, UUIDv7 day-directory layout) and the spec's six decisions with leans; todo P2 m/mid/planned, since hq-fce47e and tasks-970049 already wait on it and its open choices are bounded design for a reviewed spec
- 2026-10-17T10:34:15Z (feat/codex-model-resolver): started
  provenance: {"harness_session":"claude-code:b66cd6bb-77e6-4908-99ce-76686866c36d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-17T10:44:08Z (feat/codex-model-resolver): spec drafted: docs/specs/2026-10-17-codex-model-resolver.md; probes on codex 0.163.0 added facts 5-11 (hooks see no CODEX_THREAD_ID; tool call absent from rollout at call time; sandbox pid-1 codex; UUIDv7 day dir 16392/16392; 1.2 GB runaway rollout motivates a 64 MiB scan limit); awaiting user review
- 2026-10-17T10:44:43Z (feat/codex-model-resolver): parked (waiting on user, review): User reviews docs/specs/2026-10-17-codex-model-resolver.md in .worktrees/codex-model; on approval the agent writes the implementation plan with writing-plans (ops cli.toml row first, then relay)
  provenance: {"harness_session":"claude-code:b66cd6bb-77e6-4908-99ce-76686866c36d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-17T11:20:33Z (feat/codex-model-resolver): resumed
  provenance: {"harness_session":"claude-code:b66cd6bb-77e6-4908-99ce-76686866c36d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-17T11:20:34Z (feat/codex-model-resolver): review: spec round 1 — verdict: revise; findings: must 1, should 2; reviewer: codex/gpt-6.1-sol
- 2026-10-17T11:20:35Z (feat/codex-model-resolver): reviewer identity verified from codex rollout 01a14985-3a99-7e12-9643-455088b7d4ec (one turn_context, model gpt-6.1-sol), which holds the review text
- 2026-10-17T11:26:04Z (feat/codex-model-resolver): spec revised for round 1: turn binding (call process start vs last turn_context, earlier-turn) from a TUI probe showing a background terminal survives into the next turn with no call record; pid-1 lookup in the resolver with a real-helper unshare test; --pretty in the capture example
- 2026-10-17T11:26:13Z (feat/codex-model-resolver): parked (waiting on user, review): User reviews the round-1 revision of docs/specs/2026-10-17-codex-model-resolver.md in .worktrees/codex-model (turn binding, pid 1, --pretty); on approval the agent writes the implementation plan
  provenance: {"harness_session":"claude-code:b66cd6bb-77e6-4908-99ce-76686866c36d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-17T11:46:36Z (feat/codex-model-resolver): resumed
  provenance: {"harness_session":"claude-code:b66cd6bb-77e6-4908-99ce-76686866c36d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-17T11:46:38Z (feat/codex-model-resolver): review: spec round 2 — verdict: revise; findings: must 2; reviewer: codex/gpt-6.1-sol
- 2026-10-17T11:46:39Z (feat/codex-model-resolver): round-2 reviewer verified from the same codex rollout 01a14985-3a99-7e12-9643-455088b7d4ec (second turn_context, gpt-6.1-sol)
- 2026-10-17T11:47:48Z (feat/codex-model-resolver): spec revised for round 2: verify only when the call process's whole start interval lies more than m=1000 ms after the turn record (else earlier-turn or the new turn-boundary); the boot-clock immunity claim is removed and replaced by a stated wall-clock requirement with per-platform harmful step directions (forward on Linux, backward on Darwin) and tests that pin the limit
- 2026-10-17T11:47:52Z (feat/codex-model-resolver): parked (waiting on user, review): User reviews the round-2 revision of docs/specs/2026-10-17-codex-model-resolver.md in .worktrees/codex-model (conservative turn boundary, clock requirement); on approval the agent writes the implementation plan
  provenance: {"harness_session":"claude-code:b66cd6bb-77e6-4908-99ce-76686866c36d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-17T12:29:01Z (feat/codex-model-resolver): resumed
  provenance: {"harness_session":"claude-code:b66cd6bb-77e6-4908-99ce-76686866c36d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-17T12:29:02Z (feat/codex-model-resolver): review: spec round 3 — verdict: revise; findings: must 1, should 1; reviewer: codex/gpt-6.1-sol
- 2026-10-17T12:29:03Z (feat/codex-model-resolver): round-3 reviewer verified from codex rollout 01a14985-3a99-7e12-9643-455088b7d4ec (third turn_context, gpt-6.1-sol)
- 2026-10-17T12:29:31Z (feat/codex-model-resolver): spec revised for round 3: Linux start interval brackets the uptime read between two Date.now() samples (lo = w0 − age − 11 ms, hi = w1 − age + 11 ms), so a pause widens rather than shifts it; sampling-delay test added; clock-step tests require verification only when the shifted interval satisfies lo − m ≥ t
