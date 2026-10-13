---
id: relay-a6ef67
title: "Typed-messages tests: SSE resume cursor, live deadline timer, schema-derived rejection fixtures, missing lifecycle rows, and timing-dependent assertions"
status: done
priority: 2
size: m
complexity: mid
process: direct
owner: fix/typed-messages-review
created: 2026-10-13T18:16:05Z
updated: 2026-10-13T20:08:49Z
started: 2026-10-13T18:30:55Z
completed: 2026-10-13T20:08:49Z
depends: []
tags: [testing]
source: "review:bc4ef2f"
agent: claude-code/claude-opus-5-5
---

Why: the post-merge review of bc4ef2f (2026-10-13) found test gaps against the spec's acceptance criteria, and timing-dependent assertions. The merged tree was verified only with file concurrency 1 (ruling F32), and relay-31973b recorded default-concurrency failures at Task 13. On 2026-10-13, one default-concurrency `just test-fast` run each on Node 26.5.0 and 22.23.2 passed 576/576. That is one data point, not proof.

1. **SSE resume is untested** (spec acceptance 5). test/serve-http.test.js:126-149 sends `Last-Event-ID` mark-1 = 0 when only one older entry exists, so a server that ignored the header would pass. Deleting the `e.seq > since` filter (src/serve/inbox.js:99) breaks no test. Add an SSE test and a socket `watch` test whose cursor must exclude an older entry.
2. **The running service's deadline timer is never exercised.** `arm()` (src/serve/serve.js:26-37) has no test: expiry and window tests call `sweep()` by hand or restart the service. Add a test with an injected clock or a short deadline in which a running service moves pending to expired and handed to unconfirmed, and the waiter receives each state line.
3. **Acceptance 2 is not met** ("fixture tests for every kind and every rejection"; Appendix A: "the validators are tested against them"). The schema test compares only the enum lists (test/interaction-message.test.js:108-115). Missing rejection tests:
   - notice title, text and level
   - a defer's surface
   - an answer's outcome
   - option label (80) and description (400) limits
   - more than 4 options
   - item and option id patterns
   - text maxLength of 0 or 2001
   - duplicate option ids in a choice value
   - a bad createdAt

   Derive these limits from schemas/interaction/message.schema.json, so the schema and the validator cannot drift apart silently.
4. **Some §5.2 rows are untested.**
   - A defer on `released` or `withdrawn`.
   - ALREADY_ANSWERED for another answerId, a defer or a withdrawal from `handed`, `consumed` or `unconfirmed`.
   - The defer refusal at test/interaction-lifecycle.test.js:63 does not assert that the winning answer is returned.
5. **Timing-dependent assertions.**
   - Fixed sleeps before positive assertions: test/routes-ask.test.js:122-124 (200 ms after SIGKILL, across processes, including an fsync), test/serve-process.test.js:66-70, test/serve-http.test.js:332,382,386, and test/serve-socket.test.js:50,58,83,100.
   - 50 ms negative checks that can pass vacuously: test/serve-process.test.js:99-100, test/serve-socket.test.js:98, test/serve-http.test.js:284.
   - test/helpers/spawn-lines.js:20 resolves `exited` on 'exit' rather than 'close', so the stderr asserts that follow it race.

   Replace the sleeps with event waits, or with polling against a deadline.

Done:
- Items 1-4 are covered and item 5 is fixed.
- Five consecutive default-concurrency `just test-fast` runs pass on Node 22 and on the dev runtime, and none leaves a fixture process.

Related: relay-a7aea1, relay-ef98dc, relay-fc28a4, relay-7c134c, relay-4d07f6.

## Notes

- 2026-10-13T18:16:27Z (main): concerns: relay-f58531 defect — spec acceptance 2 and 5 coverage missing; timing-dependent assertions under default concurrency
- 2026-10-13T18:30:55Z (main): started
  provenance: {"harness_session":"claude-code:cee0471d-7415-41b5-933e-f3803576f4bb","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-13T18:31:25Z (fix/typed-messages-review): resumed
  provenance: {"harness_session":"claude-code:cee0471d-7415-41b5-933e-f3803576f4bb","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-13T19:06:19Z (fix/typed-messages-review): scope: 'none leaves a fixture process' excludes the known one-per-run subscriber.js hang leak, which stays relay-7c134c's; relay-22e22b (now on this branch) refuses invalid cursors, so resume tests use valid cursors only
- 2026-10-13T19:24:51Z (fix/typed-messages-review): decision: item 2 needs no new seam: the live-timer test runs runServe in-process with its existing clock and onCommit injection; onCommit runs before the service re-arms, so it jumps the clock to 300 ms before the entry's next deadline and the service's own timer must fire
- 2026-10-13T19:45:15Z (fix/typed-messages-review): decision: item 5 adds no src seam. A socket close is observed through a sentinel question on the same connection (the close handler reports its asker gone; socket-waiter gains 'ask <file>' for the cross-process case); HTTP close deadlines are 5 s (Node retains an incomplete request for tens of seconds); the queued-SSE-close test keeps a 30 ms nudge because HTTP exposes no close signal, and its assertion now polls
- 2026-10-13T20:02:34Z (fix/typed-messages-review): review: impl round 1 — verdict: accept; findings: Minor 2; reviewer: claude-code
- 2026-10-13T20:04:47Z (fix/typed-messages-review): minor (deferred): cli-desk 20x10ms poll and routes-ask 50ms negative check, closable and nextCall helper fragility -> relay-0811af
- 2026-10-13T20:08:49Z (fix/typed-messages-review): done
  provenance: {"harness_session":"claude-code:cee0471d-7415-41b5-933e-f3803576f4bb","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-13T20:08:49Z (fix/typed-messages-review): SSE and socket watch resume with excluding cursors, live deadline timer, schema-derived rejection fixtures, remaining §5.2 rows, event waits replacing fixed sleeps, spawnLines exits on close; mutation-proven; 5+5 consecutive default-concurrency runs passed on Node 26 and 22 (607/607); 90a7a3a 66c04f3 cdd43b6 caddf6e 704084d a4bf5c6; minors deferred to relay-0811af
  provenance: {"harness_session":"claude-code:cee0471d-7415-41b5-933e-f3803576f4bb","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
