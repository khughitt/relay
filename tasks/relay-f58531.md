---
id: relay-f58531
title: "Design typed interaction messages: envelope, question, answer and notice kinds, a durable inbox with expiry and withdrawal, and remote delivery over the tailnet"
status: todo
priority: 2
size: l
complexity: high
process: planned
created: 2026-10-11T17:52:19Z
updated: 2026-10-11T17:52:19Z
depends: []
tags: [cross-project]
agent: claude-code/claude-fable-5-1
---

Piece of ops-cb50a8 (typed exchanges; phone inbox). Planned: design spec for user review, then a plan.

Why relay: ops docs/specs/2026-10-03-agent-layer-split-design.md §3 gives relay agent-to-agent messaging and how events and messages reach agents; §5.1 has flows talk to relay for multi-agent work. The relay design (ops docs/specs/2026-09-16-relay-design.md) deferred a daemon, socket and remote delivery because no consumer needed them, and said the registry is not the shared transport of agent-to-user notification, host requests and cross-harness jobs. This design revisits that deferral for the first consumer that needs remote delivery, a phone inbox on the private tailnet, and decides what stays separate.

Design questions to settle:
- Envelope: sender and recipient as relay agent ids (harness:sessionId) or the user; a correlation id joining a question to its answer; the task id and project when known; created, expires; kind. Borrow A2A's input-required state and text-plus-data parts where they fit.
- Kinds: question (1 to 4 items, each boolean, single or multi choice from 2 to 4 options with label and description, or short text; a recommended option first, as lore's decision rule requires; an optional "other"), answer (chosen options or text, or deferred-to-desktop, or declined), notice (one-way, what ohai shows today), withdrawal (the asker voids a pending question; Codex's async card cannot do this, hq-5e63d9). Restrict the question payload to MCP elicitation's flat-primitives subset so every client can render it. Flow-semantic payloads (review verdict, gate evidence) are flows' to register on top, not defined here.
- How harness questions enter: adapters translate Claude Code AskUserQuestion, Codex request_user_input and request_user_input_async, and OpenCode's question event into the question kind; the hq probe (the hq piece of ops-cb50a8) decides how an answer gets back into the waiting turn per harness.
- Store and delivery: a durable inbox the registry does not replace; whether a one-shot process model still works or a small service is needed; delivery to a client on another tailnet host (an HTTP endpoint bound to the tailnet, as mind6 does), authentication by tailnet identity, what happens when the desktop is asleep.
- Relation to tasks park --waiting-on user: a deferred answer and a park name the same state; decide which is derived from which.
- Capability facts: relay's evidence records (schema 1, probes) gain the rows the hq probe establishes.

Done: a reviewed spec in relay docs/specs naming the envelope, the four kinds with JSON Schema, the inbox contract, the delivery surface, the adapter mappings and what v1 leaves out; a reviewed plan; children filed per plan step.
