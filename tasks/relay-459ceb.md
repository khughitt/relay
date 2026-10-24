---
id: relay-459ceb
title: Retain detached-ask raw RED evidence until layout-safe attachment ships
status: todo
priority: 3
size: xs
complexity: low
process: direct
created: 2026-10-24T15:44:19Z
updated: 2026-10-24T15:46:12Z
depends: []
tags: []
source: relay-8d8e86
agent: codex/gpt-6.1-sol
---

The completed detached-ask implementation keeps four exact RED-test logs off-tree because the executing layout checker refuses their host paths. Portable derivatives are attached to relay-8d8e86. This open follow-up owns the raw bytes and manifest on titan until a shipped checker admits ledger-backed raw attachments; then verify hashes, attach originals through normal checks, and reassess raw-copy disposition. Do not delete the only raw copy or treat completion of the checker design as shipment. Retained-item notes carry the canonical path, hashes, mapping and cleanup trigger.

## Notes

- 2026-10-24T15:46:11Z (main): Created on titan: $WORK_ROOT/relay/relay-8d8e86 and raw-red-evidence for exact RED-test logs refused by the layout gate; owned by relay-459ceb; contents mutable, not yet checkpointed.
- 2026-10-24T15:46:12Z (main): Portable derivative mapping for raw-red-evidence: <WORK_ROOT> = /mnt/ssd3/work; <HOME> = /home/keith. Exact raw files are unchanged; derivatives are attached to relay-8d8e86.
