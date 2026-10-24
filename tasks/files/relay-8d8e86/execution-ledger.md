# SDD ledger — plan: docs/plans/2026-10-24-detached-ask.md

Spec: 9455516. Plan: d9a405d, approved under user's delegated approval decision after accepting plan review round 2.
Baseline: just test, Node v26.5.0, 716/716 passed, zero skipped, 14.4s; baseline.log.
Pre-flight: Task 1 applyTake(Entry, now): Result is what Task 2's queued inbox.take consumes; consistent.
Pre-flight: Task 2 socket take/ask responses are what Task 3's runInbox consumes; consistent. CLI takes directly without a get.
Pre-flight: Task 1 changes STALE to changed:true with error; existing commit persists changed results and returns their error, consistent.
Ruling: Plan round-2 Minor 1 accepted: explicitly return detached entries unchanged from applyAskerGone and NOT_HANDED from applyConfirm — required by approved spec and tested guards, not leaving the functions untouched — cost if wrong: detached receipt or expiry semantics would differ; native paths stay tested. Revision: d9a405d execution clarification.
Ruling: Plan round-2 Minor 2 accepted: reject ask-file content that differs from validateMessage's reconstruction — fails early on unknown or misspelled fields instead of dropping them — cost if wrong: previously tolerable producer extras must be removed. Revision: d9a405d execution clarification.
Ruling: Plan round-2 Minor 3 accepted: add ask/take to the inbox parent usage — names all valid commands — cost if wrong: diagnostic wording only. Revision: d9a405d execution clarification.
Task 1: started; BASE b04abd68dd8f7b1f1955f6762c66e495d5bcc75a.
Task 1: complete (commits b04abd6..f9c8a8e, tests: just test-one test/interaction-lifecycle.test.js test/interaction-store.test.js → ℹ duration_ms 865.936962)
Task 2: complete (commits 7b97c1a..65e226e, tests: just test-one test/serve-inbox.test.js test/serve-socket.test.js test/serve-http.test.js → ℹ duration_ms 3050.050985)
Task 1: focused RED 7 failures (missing take and unchanged STALE), GREEN 64/64; suite 722/722; check passed.
Task 2: inbox and socket RED at unsupported detached route/unknown take; GREEN 114/114; suite 733/733; check passed.
Task 3: Ruling: plan's proposed error.kind inbox_failed is inconsistent with existing cmd.path.join('-') formatter — preserve inbox-ask_failed, inbox-take_failed, etc. in both output and assertions — cost if wrong: a consumer expecting the plan's mistaken name needs correction. Revision: d9a405d against bin/relay.js.
Task 3: Ruling: CLI inventory is owned by ops and relay's gate rejects unlanded local edits — add the exact rows in ops-50dfa0, review/test and merge locally, then vendored adopt in relay — cost if wrong: one cross-project metadata commit, no host tool or deployment change. Revision: d9a405d execution dependency.
Task 3: fixture environment check GREEN 14/14; feature RED at unknown commands/flags and stale parent help; first GREEN 26/27 identified old usage-message assertion, corrected to match added commands; subsequent CLI/desk GREEN 20/20. No feature test inherited the host environment.
Task 3: complete (commits 2c80861..8a97252, tests: just test-one test/cli-interaction.test.js test/cli-desk.test.js test/cli-surface.test.js → ℹ duration_ms 16658.661802)
Final review: codex/gpt-6-astra accepted 084ce35..5bf0ef0 with Critical 0, Important 0, Minor 0; verified later commits only contain records/gate attachments. All five Review Focus cases covered. No corrective round required.
Final: Ruling: reviewer did not exercise deployment, hook installation, physical Darwin or a real phone — keep those out of this source-only change, which alters no live settings or services — cost if wrong: live/platform-specific behavior still needs its separate acceptance. Review revision: 5bf0ef0, implementation 8a97252.
Final: Ruling: flows artifact revision and gate-authority interpretation remain the consumer's responsibility — relay take acknowledges receipt only and preserves the answer; flows owns checking current artifacts and deriving notes — cost if wrong: downstream integration must detect any consumer-contract mismatch before advancing a gate. Review revision: 5bf0ef0, implementation 8a97252.
Final: Ruling: accept canonical unrelated CLI rows without auditing other projects' implementations — adoption is from landed ops and relay surface tests filter relay rows; no external implementation is changed — cost if wrong: this review does not establish those other command semantics. Review revision: 5bf0ef0; source metadata 5e1394e.
Final gate evidence: Node 26.5.0 just gate 739/739, zero skipped; Node 22.23.2 just gate 739/739, zero skipped. Strict checks passed. Both logs attached to relay-8d8e86.
Integration preflight: installed launcher resolves through hq's version-pinned runtime v0.1.1 under the user's local share directory, not relay main. Local source merge does not upgrade that installation; no live service or global pointer is changed.
