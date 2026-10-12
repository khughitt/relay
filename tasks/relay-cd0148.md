---
id: relay-cd0148
title: Fix final typed-interaction review findings
status: doing
priority: 2
size: m
complexity: mid
process: direct
owner: design/typed-messages
created: 2026-10-12T11:57:31Z
updated: 2026-10-12T12:03:21Z
started: 2026-10-12T12:03:21Z
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
- 2026-10-12T12:00:16Z (design/typed-messages): concerns: relay-0f389a defect — malformed probe selectors or output arguments could silently expand into paid live scenarios instead of failing before external work.
- 2026-10-12T12:03:21Z (design/typed-messages): started
  provenance: {"harness_session":"codex:01a12ffd-2aa7-7d80-94e1-0b25e34bba89","harness_session_source":"CODEX_THREAD_ID"}
