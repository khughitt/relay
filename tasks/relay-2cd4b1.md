---
id: relay-2cd4b1
title: "Resolve a Codex session's model from its own rollout, keyed on CODEX_THREAD_ID"
status: idea
priority: 2
created: 2026-10-15T00:39:58Z
updated: 2026-10-15T00:55:47Z
depends: []
tags: []
source: "lore:docs/notes/2026-10-02-codex-model-identity-brief.md"
agent: claude-code/claude-opus-5-5
---

Why: Codex sessions stamp TASKS_AGENT=codex with no model, so task stamps and review notes lose the model half (goal hq-fce47e).

Evidence (hq-1bd166, codex-cli 0.162.1; lore brief docs/notes/2026-10-02-codex-model-identity-brief.md §5): CODEX_THREAD_ID -> ${CODEX_HOME:-$HOME/.codex}/sessions/*/*/*/rollout-*-<thread>.jsonl -> last turn_context.model resolved the running model in a top-level session before and after an exec resume -m switch and in multi-agent v2 children spawned on another model. In a child CODEX_SESSION_ID is the root session's id, so keying on it stamps the parent's model. session_meta (base_instructions.provenance.model) keeps the model at creation, and a forked child's rollout begins with its own session_meta (forked_from_id), then the parent's session_meta and turn_context, so only the last turn_context counts and id validation reads the first session_meta. Between a resume -m and the next turn's turn_context the last turn_context is stale, so the resolver is valid only inside a tool call, never from a SessionStart or UserPromptSubmit hook (PreToolUse fires after the turn_context and was not shown stale). Hook payloads carry the correct per-agent model, plus agent_id (the child's thread id) and agent_transcript_path at SubagentStop; the shell cannot read them unless a hook stores them. state_5.sqlite's threads table also records model and rollout_path per thread (update timing unprobed).

Proposed: a resolver command printing codex/<model> (and effort if wanted), or bare codex when the thread id is unset, zero or several rollouts match, or no turn_context exists; skip an unparseable trailing line; never the session id, session_meta or config. Consumer: tasks, when TASKS_AGENT is bare codex (a separate tasks piece).

Open for scoping: the command's name and home in relay; a rule for processes that inherit CODEX_THREAD_ID from a Codex session (tmux, another harness); whether app-server thread/read or the state database should locate the rollout instead of the glob (archived_sessions is flat and the glob misses it); ephemeral sessions; a hook-adapter cross-check keyed on agent_id.
