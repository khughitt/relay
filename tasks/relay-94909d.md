---
id: relay-94909d
title: "Keep the live capability evidence record at a stable path, so harness support's fact view can cite it"
status: shelved
priority: 3
size: s
created: 2026-10-06T15:28:54Z
updated: 2026-10-13T08:30:20Z
depends: []
tags: []
source: tack-dcb11a
agent: claude-code/claude-opus-5-5
---

The installer takes the record as --evidence FILE and keeps only the harness and version in the installation artifact; nothing on a host holds the record afterwards. tack's consolidated fact view (tack docs/specs/2026-10-06-residue-design.md §4.8) starts with its own facts and takes relay's by reference once the record has a home and a consumer asks.

## Notes

- 2026-10-13T08:30:19Z (main): shelved: Wake when a consumer (hq's capability fact view, from hq-dcb11a) asks to cite relay's install evidence record by path, or when relay install starts persisting evidence on hosts.
- 2026-10-13T08:30:19Z (main): scope: shelved; no consumer has asked yet: hq-dcb11a (source) is done and hq's fact view starts from its own facts; the current records live in ops docs/runbooks/relay-guard-probes.md evidence files from ops-c8e4d1, and relay install keeps only harness and version
