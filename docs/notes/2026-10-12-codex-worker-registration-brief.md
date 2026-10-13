# Codex worker registration — brief

Scope pass 2026-10-12 over relay-f56e30, relay-11829e, relay-60ae9e, relay-c85a0f and
relay-652c96.

## 1. Problem

A Codex controller and the workers it spawns run inside one `codex` process. Relay
publishes one registry row per session, keyed `codex:<session_id>`, so a worker has no
row of its own. A consumer that acquires a claim through relay (tasks, with relay
configured) can therefore find only the controller's root row for a worker. tasks now
refuses that row rather than adopting the controller, so a worker cannot acquire or
continue a claim through relay at all. The outcome wanted: a worker that relay can
name, distinct from its controller, with liveness that means what consumers assume.

## 2. Current behaviour and evidence

- The env-var reports (relay-11829e, -60ae9e, -c85a0f, -652c96) describe tasks' claim
  identity, not relay code. Relay reads no `CODEX_SESSION_ID`/`CODEX_THREAD_ID`
  (only `tools/darwin-probe/lib/context.mjs` lists them, as probe context). The
  "relay rejects the conflicting hint pair" path is tasks' `src/relay/resolve.rs`.
  tasks fixed it in its delegated identity remedy (tasks `a7ffc27`, 2026-10-06;
  tasks-3809b8 thread-keyed native claims, tasks-17c844 relay hints by thread,
  closed by tasks-a5a502).
- `src/adapters/codex.js` maps SessionStart, UserPromptSubmit, PreToolUse,
  PermissionRequest, Stop and SessionEnd; SubagentStart/SubagentStop are
  `UNSUPPORTED_EVENT`. `src/install/hooks.js` installs only those six events.
- `src/adapters/index.js` sets `agentId = <harness>:<payload.session_id>`. Codex
  subagent hooks carry the parent's `session_id` plus `agent_id`/`agent_type`, so a
  naive mapping would overwrite the root row.
- `src/bus/transaction.js` attaches the process handle of the nearest `codex`
  ancestor; controller and workers share it. Liveness proves the process, not a worker.
- tasks-c0bad3 (Codex 0.160.1 source): `agent_id` equals the worker's
  `CODEX_THREAD_ID`; workers get SubagentStart (startup/fork only) and SubagentStop
  per **turn**; they never get SessionEnd or Interrupt. Real hook delivery to a
  configured command was left unverified (tasks
  `docs/notes/2026-09-30-delegated-identity-brief.md`, "Lifecycle dispatch").
- tasks' design (`docs/specs/2026-10-06-delegated-identity-design.md` §4) requires a
  row whose `sessionId` matches the worker thread, refuses root rows, and leaves
  "shared-process worker registration and its lifecycle interpretation" to a
  relay-owned design with real capture.

## 3. Constraints

- Registry schema 2 (relay-21ed8f) is mirrored by tasks' Rust validators
  (relay-4a5559): any row-shape change has a second consumer.
- Relay is fail-closed; tasks must not get hint-based tie-breaking or controller
  adoption from a new row shape.
- No live hook is installed until the installation and capability gates pass
  (AGENTS.md); the release goal relay-1231bf does not depend on tasks identity.
- Nested workers: root grouping cannot reconstruct an immediate-parent chain.
- Private PID namespaces break process proof separately (tasks-fe6c59, tasks-b9cbe3).

## 4. Alternatives

1. **Worker rows keyed `codex:<agent_id>`** with `sessionId = agent_id`, a `root`
   association, the shared process handle, created by SubagentStart and refreshed by
   SubagentStop/worker tool events. Removal: when the process dies, or on a bounded
   staleness rule, since no worker end event exists.
2. **Worker sub-entries on the root row** (`workers: {agent_id: …}`): keeps one row
   per process; consumers must look inside rows, a larger schema change for tasks.
3. **No relay worker rows**: document that workers claim natively only (already
   supported by tasks) and close relay-f56e30 as won't-do.

Lean: 1, if live capture shows SubagentStart reaches a relay hook command with
`agent_id` and that worker PreToolUse hooks can be told apart from the controller's.

## 5. Unanswered questions

- Does Codex deliver SubagentStart/SubagentStop to a configured command hook at the
  current release, with which fields, and do a worker's PreToolUse payloads carry
  `agent_id`? — relay-ed3f00 (live capture).
- What ends a worker row, given SubagentStop is per-turn? — design, after capture.
- Does tasks need anything beyond `sessionId == thread` to accept the row? — the
  design, reviewed with the tasks lane (tasks-2fa8c6).
- Is the shared-process liveness acceptable to tasks for proof continuation? — the
  design plus a tasks reviewer.

## 6. Proposed decomposition

- Goal relay-eaca0e — Register Codex workers in the relay registry (source: this brief).
  - relay-ed3f00 — research: capture genuine Codex subagent hook delivery.
  - relay-6825f7 — Design Codex worker registration from the brief; depends on
    relay-ed3f00. Wakes relay-f56e30.
- Drops proposed (covered by tasks `a7ffc27`): relay-11829e, relay-60ae9e,
  relay-c85a0f, relay-652c96.
