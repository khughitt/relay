---
id: relay-a6ef67
title: "Typed-messages tests: SSE resume cursor, live deadline timer, schema-derived rejection fixtures, missing lifecycle rows, and timing-dependent assertions"
status: doing
priority: 2
size: m
complexity: mid
process: direct
owner: main
created: 2026-10-13T18:16:05Z
updated: 2026-10-13T18:30:55Z
started: 2026-10-13T18:30:55Z
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
