---
id: relay-94909d
title: "Keep the live capability evidence record at a stable path, so harness support's fact view can cite it"
status: idea
priority: 3
size: s
created: 2026-10-06T15:28:54Z
updated: 2026-10-06T15:28:54Z
depends: []
tags: []
source: tack-dcb11a
agent: claude-code/claude-opus-5-5
---

The installer takes the record as --evidence FILE and keeps only the harness and version in the installation artifact; nothing on a host holds the record afterwards. tack's consolidated fact view (tack docs/specs/2026-10-06-residue-design.md §4.8) starts with its own facts and takes relay's by reference once the record has a home and a consumer asks.
