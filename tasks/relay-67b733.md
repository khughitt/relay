---
id: relay-67b733
title: Inventory duplicated harness assumptions and prove a minimal shared fact format with two consumers
status: todo
priority: 2
size: m
complexity: mid
process: planned
created: 2026-09-27T18:54:53Z
updated: 2026-09-27T18:54:53Z
depends: []
tags: []
source: "conversation 2026-09-27: steering and harness-model discussion (claude + codex review)"
agent: claude-code/claude-opus-5-5
---

Outcome: (1) an inventory of every place across the projects that branches on or assumes harness behaviour, with the fact each depends on; (2) a minimal evidence-backed fact format adopted by two existing consumers.

Known sites to start from: relay adapters and install/capabilities.js (hook events, replies, probe evidence), obs claude_adapter/codex_adapter (session store encoding, human-turn and injected-context detection), tack's session-logs skill (reads the same stores again), ops claim-guard CHILD_WAKES (does the harness wake a controller when a child finishes), AGENTS.md prose (Codex wait timeouts, zsh vs bash), and skill references stating harness facts (e.g. Codex agent-slot eviction, found wrong in ai-e3cef2).

Classify each fact as capability (what an integration can do), representation (how events and sessions are encoded), or local policy (what this setup permits or requires); these have different owners — relay runtime integration, obs session interpretation, tack workflow adaptation. A common evidence format does not mean moving implementations into relay.

Fact record: harness, the conditions actually tested (version, interface, feature flags, config, backend — not a version range extrapolated from one probe), value, evidence (probe, source link, doc), verified date, and unsupported distinct from unknown.

Not in scope: a general registry or ontology; that is a contingent follow-up once two consumers show the format pays.
