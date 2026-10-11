---
id: relay-f58531
title: "Design typed interaction messages: envelope, question, answer and notice kinds, a durable inbox with expiry and withdrawal, and remote delivery over the tailnet"
status: doing
priority: 2
size: l
complexity: high
process: planned
owner: design/typed-messages
created: 2026-10-11T17:52:19Z
updated: 2026-10-11T21:48:13Z
started: 2026-10-11T20:39:50Z
depends: [hq-d85ede]
tags: [cross-project]
agent: claude-code/claude-fable-5-1
spec: docs/specs/2026-10-11-typed-interaction-messages.md
---

Piece of ops-cb50a8 (typed exchanges; phone inbox). Planned: design spec for user review, then a plan. Depends on hq-d85ede, which verifies how an answer reaches a waiting turn per harness and session mode.

Why relay: ops docs/specs/2026-10-03-agent-layer-split-design.md §3 gives relay agent-to-agent messaging and how events and messages reach agents; §5.1 has flows talk to relay for multi-agent work. The relay design (ops docs/specs/2026-09-16-relay-design.md) deferred a daemon, socket and remote delivery because no consumer needed them, and said the registry is not the shared transport of agent-to-user notification, host requests and cross-harness jobs. This design revisits that deferral for the first consumer that needs remote delivery, a phone inbox on the private tailnet, and decides what stays separate. The responsibilities are settled; the question lifecycle is new and this spec defines it.

Design questions to settle:
- Envelope: sender and recipient as relay agent ids (harness:sessionId) or the user; a correlation id joining a question to its answer; the task id and project when known; created and expires; kind; class (clarification, artifact review, authorization request), since their effects and permitted responders differ and an authorization is never granted by an inbox answer (autonomy-1aac03); the artifact under decision as a reference plus revision (a tree hash, a document hash) so an answer binds to what the responder saw, and an answer whose revision no longer matches is rejected as stale. Borrow A2A's input-required state and text-plus-data parts where they fit.
- Kinds: question (1 to 4 items, each boolean, single or multi choice from 2 to 4 options, or short text; options carry a stable id, a label and a description, so answers reference ids and never labels or positions; an optional recommended option id, set by the asker under lore's policy, not required by the schema; an optional "other"), answer (chosen option ids or text, or declined), defer (the question stays pending and is presented on the desktop instead; not an answer, advances nothing), withdrawal (the asker voids a pending question; Codex's async card cannot, hq-5e63d9), notice (one-way, what ohai shows today). Restrict the question kind rendered on a phone to MCP elicitation's flat-primitives subset; payloads flows registers for agent-to-agent steps may be richer and are not bound by the phone form's limits.
- Lifecycle contract, with explicit behaviour for the ordinary cases: the phone and the desktop both answer (first delivered answer wins, the second is rejected with the winner shown); an answer retried after a lost connection (idempotent by correlation id); the asker withdraws while an answer is in flight; the session ends before delivery (the answer is saved; it is consumed only when the asker, or a resumed session, reads it); expiry. Distinguish answer saved from answer consumed by the agent, and show both states to the client.
- How harness questions enter and answers return: adapters translate Claude Code AskUserQuestion, Codex request_user_input and request_user_input_async, and OpenCode's question event into the question kind; hq-d85ede fixes the return route per harness and session mode (Claude Code: a PreToolUse hook that waits for the answer and replies allow with updatedInput.answers, or defer and resume under claude -p; the hook maps option ids back to the labels the harness expects).
- Store and delivery: a durable inbox the registry does not replace; whether a one-shot process model still works when a hook must wait for a remote answer, or a small service is needed; delivery to a client on another tailnet host (an HTTP endpoint bound to the tailnet, as mind6 does), authentication by tailnet identity, what happens when the desktop is asleep.
- Relation to tasks park --waiting-on user: related, not identical. A deferred question may coexist with an agent that continues independent work; a park is the agent's statement that it has stopped. Say which events, if any, write the other.
- Capability facts: relay's evidence records (schema 1, probes) gain the rows hq-d85ede establishes.

First milestone (ops-cb50a8 milestone 2): the minimal durable contract, question, answer, defer, withdraw, stale rejection and delivery recovery, exercised by one Claude Code question end to end, before notices, a second harness or richer payloads.

Done: a reviewed spec in relay docs/specs naming the envelope, the kinds with JSON Schema, the lifecycle contract, the inbox contract, the delivery surface, the adapter mappings and what v1 leaves out; a reviewed plan; children filed per plan step.

## Notes

- 2026-10-11T19:36:32Z (main): hq-d85ede results for the design (facts answer-* in hq facts/capabilities.toml). Constraints: (1) correlation id = the harness's call id (Claude tool_use_id, Codex itemId+turnId, OpenCode form id); after a restart every harness that re-asks does so under a new id, and a late answer must be rejected, never matched by question text, which the probe showed lands on the new question. (2) Delivery needs a long-lived service: Codex and OpenCode routes are protocol clients holding a connection to the harness server, and the Claude hook route blocks a hook process on the inbox (2100 s probed). (3) Withdrawal: Claude hook death (Esc, session close) must withdraw the inbox entry; hook deny with a reason is seen by the model as a hook error and it stops; Codex serverRequest/resolved tells the relay the terminal answered first; OpenCode form cancel interrupts the step and does not pass a message in the body to the model (query parameter unprobed); the Codex async card cannot be withdrawn. (4) Two answers: Claude defer resume refuses a second, Codex ignores a second response silently (first wins), OpenCode returns 409 FormAlreadySettledError; the relay's own first-wins rule must hold for the Claude hook route, where a second answer has no consumer. (5) Restart: Claude -p defer survives (resume replays the same tool_use_id), interactive hook does not; Codex daemon restart aborts and runs a recovery turn re-asking under a new itemId; OpenCode server restart drops the form (404). Codex threads and OpenCode sessions outlive their terminal, so answer saved vs consumed maps onto request resolved vs pending.
- 2026-10-11T20:39:50Z (main): started
  provenance: {"harness_session":"claude-code:e0144e6c-a368-496f-bdd1-a0377f1e66b2","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-11T20:40:02Z (design/typed-messages): resumed
  provenance: {"harness_session":"claude-code:e0144e6c-a368-496f-bdd1-a0377f1e66b2","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-11T20:42:07Z (design/typed-messages): design decisions 2026-10-11: one long-lived relay serve as sole inbox writer (unix socket for local clients, loopback HTTP behind tailscale serve for the phone), rejected files-as-truth multi-writer; user chose presence mode for routing (relay presence away|here; here = hook passes through to the native question; defer on the Claude terminal route releases the hook to the native question)
- 2026-10-11T20:45:51Z (design/typed-messages): parked (waiting on user, review): user reviews .worktrees/typed-messages/docs/specs/2026-10-11-typed-interaction-messages.md; on approval the agent runs writing-plans (probes P1/P2 first)
  provenance: {"harness_session":"claude-code:e0144e6c-a368-496f-bdd1-a0377f1e66b2","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-11T20:50:05Z (design/typed-messages): review: spec round 1 — verdict: revise; findings: P1 3, P2 3; reviewer: codex
- 2026-10-11T20:50:14Z (design/typed-messages): Spec review details: P1 consumed is sent before hook exit or harness receipt (9.1); withdrawal exits with the same native-release behavior and reopens the revoked question (9.1); superseding promises one atomic replacement but writes two entry files without recovery for a partial replacement (5.5/6). P2 defer remains pending but ask emits resolution only on leaving pending, with no released transition (5.2/7.2/9.1); startup can reuse sequence numbers after terminal-entry pruning by ignoring the durable seq high-water mark (6); retry with the winning answerId has no defined replay from undeliverable (5.2/5.3). Delivery confirmation also requires adding PostToolUse adapter, normalization and installer support: the observer described as existing in 9.1 is absent. Spec unchanged; no live probes or implementation tests run.
- 2026-10-11T21:48:13Z (design/typed-messages): resumed
  provenance: {"harness_session":"claude-code:e0144e6c-a368-496f-bdd1-a0377f1e66b2","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
