---
id: relay-4a5559
title: tasks now mirrors the schema-1 registry validators in Rust; a schema change has a second consumer
status: todo
priority: 2
size: s
complexity: low
process: direct
created: 2026-09-22T16:41:19Z
updated: 2026-09-23T12:26:23Z
depends: []
tags: []
agent: "claude-code/claude-opus-5[1m]"
---

tasks gained an opt-in relay identity level (tasks docs/specs/2026-09-22-relay-ancestry-identity-design.md). Its reader, tasks src/relay/snapshot.rs, mirrors validateSnapshot, validateAgent, validateHandle and checkPrivate field for field in Rust, including the safe-integer bounds on revision and updatedAt, the uuid checks, the scope vocabulary, and the 0700/0600 private-path rules. It also depends on the adapters' resolveAgentPid naming the process whose comm is claude, codex or opencode.

Nothing links the two: a schema bump, a relaxed or tightened validator, a new harness in HARNESSES, or a change to which process resolveAgentPid selects would leave the Rust copy silently wrong, and tasks fails closed — every claim acquisition inside a harness session refuses.

Decide how to keep them in step. Options worth weighing: name the consumer in the schema's own documentation so a change knows to look; publish the fixtures (test/fixtures/handles.json and friends) as a shared contract tasks can test against; or version the schema explicitly so tasks can refuse a version it does not know rather than mis-parse one.

Filed from the tasks side after the mirroring landed.

## Notes

- 2026-09-23T12:26:23Z (fix/nested-headless): Relay's registry moves to schema 2 under relay-cb616b; tasks-2dd094 carries the tasks-side reader change
