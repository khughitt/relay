# Detached questions plan self-review, round 1

Reviewer: codex/gpt-6.1-sol, author self-review under the writing-plans skill.
Identity verified this turn with `timeout 2 relay model --harness codex --pretty`.

Frozen plan: relay d9a405dde5cda86bdcc01f2ab2d5ea42f354357a,
docs/plans/2026-10-24-detached-ask.md.
Approved spec: relay 94555165894c8bb47d314020aa1296b3895911fe,
docs/specs/2026-10-24-detached-ask-design.md.

Verdict: accept. Findings: none. This is a planning self-review, not an independent
implementation review or user approval of the plan.

Spec coverage:

- Task 1 owns pure take transitions, idempotent receipt, no detached native
  handoff/confirmation or asker loss, strict persisted route/history invariants,
  accepted-message evidence, stale refusal attempt rows, and store reload tests.
- Task 2 owns service-time admission with the one-second allowance, deterministic
  seven-day clamp, presence, replay and supersession, serialized clock-before-take,
  publication/fail-stop, retention, private socket ownership/restart, typed take
  responses, HTTP regressions, and the service API reference changes.
- Task 3 owns CLI declaration/parser/TOML parity, ask-file and take, surface/reason,
  withdrawal direction, single-prefix file errors, existing envelopes, safe reused
  subprocess fixtures, real CLI tests, service runbook, and both runtime gates.
- Execution Setup owns the deferred full-suite baseline and actual test count
  before code/test changes. Final execution review remains independent and follows
  the repository's corrective-round rules. No host service deployment is included.

Step and interface scan:

- applyTake is defined before inbox.take consumes it. The take response type
  narrows successful replies to an answered question. Existing request, result,
  route and message types are extended through their established modules.
- Every feature task specifies tests, expected RED causes, implementation
  signatures/values, GREEN checks, and a code commit before closing its record.
  Task 3 stays open through its two runtime gates. Fixture environment preparation
  precedes the new tests' first run so expected failures cannot inherit credentials.
- Test helpers, factory overrides, current JSDoc contracts, the command declaration
  and TOML parity check, and documented just/runtime routes were checked against
  the current code. No new general abstraction or dependency is prescribed.

Review Focus coverage:

1. Queued admission time, boundary equality/rejection, unchanged later replay,
   and clock rollback refusal: Task 2 Step 1.
2. Detached collision preserving a native waiter's ownership: Task 2 Step 3.
3. Show/take crossing expiry and consuming the retained answer: Task 2 Step 2.
4. Repeated stale refusal attempts versus accepted answer idempotency:
   Task 1 Step 1 and Task 2 Steps 2–3.
5. Wrong-party file reaching service validation versus native-file local refusal:
   Task 3 Interfaces and Step 2, with no-service and service-running assertions.

The user's final spec nit is resolved by documenting the approved validation
boundary, not duplicating party validation in the CLI. Cost: one connection, and
SERVE_UNAVAILABLE before INVALID_MESSAGE when the service is down. No finding is
deferred.

Proportion: three sequential direct step tasks; the plan is about 1.3 times the
spec's word count. Bodies remain implementation work, with interface decisions,
test assertions, and commands supplied rather than a program transcript.

Verification: just check and git diff --check passed. No product code changed,
runtime tests ran, or full-suite baseline was claimed. Execution correctness,
both runtime gates, and older-binary state-store downgrade limits remain to be
verified or handled at their documented execution stages.
