---
id: relay-2cd4b1
title: "Resolve a Codex session's model from its own rollout, keyed on CODEX_THREAD_ID"
status: idea
priority: 2
created: 2026-10-15T00:39:58Z
updated: 2026-10-15T00:39:58Z
depends: []
tags: []
source: "lore:docs/notes/2026-10-02-codex-model-identity-brief.md"
agent: claude-code/claude-opus-5-5
---

Why: Codex sessions stamp TASKS_AGENT=codex with no model, so task stamps and review notes lose the model half (goal hq-fce47e).

Evidence (hq-1bd166, codex-cli 0.162.1; lore brief docs/notes/2026-10-02-codex-model-identity-brief.md §5): CODEX_THREAD_ID -> $CODEX_HOME/sessions/*/*/*/rollout-*-<thread>.jsonl -> last turn_context.model resolved the running model in a top-level session before and after a model switch and in a multi-agent v2 child spawned on another model. In a child CODEX_SESSION_ID is the root session's id, so keying on it stamps the parent's model; session_meta.model in a child rollout holds the parent's model at creation, so only turn_context counts. Hook payloads also carry the correct per-agent model, which makes them a cross-check, not a route the shell can read.

Proposed: a resolver command printing codex/<model> (and effort if wanted), or bare codex when the thread id is unset, no rollout matches, or no turn_context exists; never the session id, session_meta or config. Consumer: tasks, when TASKS_AGENT is bare codex (a separate tasks piece). Open for scoping: the command's name and home in relay, whether app-server thread/read can replace reading the rollout layout, and archived_sessions.
