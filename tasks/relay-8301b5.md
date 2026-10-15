---
id: relay-8301b5
title: relay ask passes an undeliverable question through to the native UI on a no-handback route instead of denying it like an expired one
status: doing
priority: 2
size: xs
complexity: low
process: direct
owner: main
created: 2026-10-13T20:14:23Z
updated: 2026-10-15T08:22:17Z
started: 2026-10-15T08:22:17Z
depends: []
tags: []
source: "review:fix/typed-messages-review round 1"
agent: claude-code/claude-opus-5-5
---

Why: since relay-22e22b, an `answered` entry becomes `undeliverable` when the clock reaches `question.expiresAt` (src/interaction/lifecycle.js:91). The `relay ask` hook can still be alive at that point, for example when `relay serve` was down across createdAt + 23 h while an answer was saved, and the hook kept retrying its reconnect. When it reattaches, `ask` replays the existing entry and the hook sees `undeliverable`. That state has no case in `attend` (src/routes/ask.js:52-66), so it falls to `default` and passes through with an `UNEXPECTED_STATE` diagnostic. A `handed` that lands just after the deadline is refused as `UNDELIVERABLE`, and line 59 passes it through the same way.

With handback (P1 passed), passing through is what the `expired` case does. Without P1, it relies on the native question reappearing, and the `expired` branch denies in exactly that case so as not to rely on it (line 63). Spec §9.1 step 4 has no row for this state.

Approach: treat `undeliverable` like `expired`.
- With handback, exit quietly.
- Without it, deny with a reason that says the saved answer could not be delivered before the question expired, so the agent should not wait.

Handle both paths: the `undeliverable` state line, and a `handed` refused as `UNDELIVERABLE`. Rejected alternative: delivering the saved answer anyway. `undeliverable` is terminal, and the user was told the answer was not delivered.

Done:
- test/routes-ask.test.js covers a hook reattaching to an `undeliverable` entry, with and without `--handback`, and a `handed` refused as `UNDELIVERABLE`. Each test fails before the fix.
- Spec §9.1 step 4 and docs/api.md name the row.
- `just test-fast` passes on Node 22 and the dev runtime.

## Notes

- 2026-10-15T08:22:17Z (main): started
  provenance: {"harness_session":"codex:01a13ea6-4e87-7e12-9ed3-696c55f0a636","harness_session_source":"CODEX_THREAD_ID"}
