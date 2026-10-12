---
id: relay-cd0148
title: Fix final typed-interaction review findings
status: todo
priority: 2
size: m
complexity: mid
process: direct
created: 2026-10-12T11:57:31Z
updated: 2026-10-12T12:00:15Z
depends: []
parent: relay-f58531
tags: []
source: "review:typed-interactions:whole-branch:1"
agent: codex
---

Whole-branch review found three Important gaps before overall close: preserve winning answer/surface/time in actual desk CLI conflict output, durably publish recursive state-directory ancestry including retries, and reject malformed paid-probe CLI arguments before any external action. One corrective pass, real focused RED/GREEN and both-runtime green suite, fresh scoped re-review; no live activation or deferred-minor cleanup.

## Notes

- 2026-10-12T12:00:14Z (design/typed-messages): concerns: relay-b14337 defect — final CLI conflict formatting discarded the saved winning answer, surface and time retained by the desk runner.
- 2026-10-12T12:00:15Z (design/typed-messages): concerns: relay-dc8efd defect — initialization fsynced a fixed parent list and missed recursively created state ancestors, leaving acknowledged durability incomplete.
