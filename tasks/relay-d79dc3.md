---
id: relay-d79dc3
title: Write explicit outer timeouts in installed hook entries
status: todo
priority: 1
size: s
complexity: mid
process: planned
created: 2026-09-18T20:19:44Z
updated: 2026-09-18T20:19:44Z
depends: []
tags: []
source: ops-c8e4d1
agent: codex
---

Relay's approved design requires each installed hook entry to carry an explicit outer timeout. The ops guard probe found the installer plans no timeout field and must not accept evidence for cutover until this is implemented and tested.
