# Spec review round 2

Reviewer: claude-code/claude-opus-5-5, relayed by the user.
Reviewed revision: relay feea75566eb471a4c8affcf5c25e9c044805a728,
docs/specs/2026-10-24-detached-ask-design.md.

Full returned review:

I recommend one revision before this spec goes to planning. Reviewing relay `feea755` (`.worktrees/detached-ask/docs/specs/2026-10-24-detached-ask-design.md`) against the current code and the flows requirements (flows `9d119d7`, sections 5, 7 and 9, plus the plan's Global Constraints), I found one Important issue and five Minor ones. The spec otherwise matches the flows contract and the existing code. The next step is the author's: fix the Important finding, and decide on the Minors, in a new frozen revision.

Everything else I checked holds against the code:
- `native === null` works as the marker for a detached question.
- Detached questions are saved in both presence modes; today `inbox.ask` hands questions back to the native UI while the user is here.
- Asker loss does not touch them: no waiter record, a no-op asker-loss step, and restart's recheck already skipping null waiters.
- Every row of the `take` table matches what flows' `take` steps 0–5 need.
- `commit()` already persists a changed result and returns its error, so a `STALE` refusal can be both saved and returned.
- The retention arithmetic is correct.

## Important

**1. The 7-day expiry limit is computed from a timestamp the caller supplies.** The clamp sets the maximum expiry to `createdAt + 7 days` (`src/serve/inbox.js:17-20`).
- For the existing Claude route that is safe, because relay's own hook process sets `createdAt`.
- A detached question is written whole by the asker, so its `createdAt` is whatever the caller puts there.
- Example: a `flow-gate` bug that writes microseconds instead of milliseconds produces a `createdAt` decades in the future. The question then stays `pending` indefinitely, and pending entries are never pruned. The spec's "Maximum expiry is 7 days" would not hold.
- **Fix:** refuse a detached ask whose `createdAt` is later than service time, plus a stated allowance, with `INVALID_MESSAGE`. Keep the clamp as it is.
  - Clamping against service time instead would break the rule that an identical resend returns the stored entry.
  - A resend arrives later, so it always passes this check.
- **Cost if left:** clutter that can only be cleared by hand, and a bound that flows relies on but nothing enforces.

## Minor

**2. `--surface` lets the CLI claim `phone` or `desktop`.**
- Flows §5.3 reads `phone` and `desktop` as "the person pressed it over the HTTP surface", and its "surface share" measure depends on that reading.
- Flows only needs `terminal`.
- The socket already accepts any surface, so this adds no new capability, but it makes forging that origin a documented command.
- **Recommendation:** limit the flag to `cli|terminal`, rather than all four values.

**3. Who may ask is not pinned down.**
- The message validator allows `from: {kind: "user"}`.
- `withdraw --reason asker` builds its message with "the question's agent as sender", which has no meaning for a question the user sent.
- **Fix:** require `from.kind === "agent"` and `to.kind === "user"` for a detached ask.

**4. `refusal:STALE` rows count attempts, without saying where they come from.**
- The CLI always copies the question's own revision into its answer (`src/cli/desk.js:79`), so neither `relay inbox answer` nor `flow-gate answer` can ever be refused as stale.
- The only real source is HTTP clients.
- Every retry of the same refused answer adds a durable row, and the row carries nothing identifying the answer, so obs cannot remove duplicates.
- The spec chose this deliberately. It should state that HTTP is the only source and that identical retries are counted, so obs designs its measure knowing both.

**5. Filesystem errors will repeat their code.**
- The CLI writes the error detail as `${code}: ${message}`, and Node's own message already begins with the code.
- `ask --file` on a missing file would print `ENOENT: ENOENT: no such file…`.
- **Fix:** specify that the CLI raises its own error carrying the filesystem code and a message that names the file.

**6. The change list leaves out `docs/runbooks/inbox-service.md`.**
- Its lines 129-131 say "here passes new questions to the native UI", which stops being true for detached questions.
- It also lists the desk commands without `ask` and `take`.

## Questions settled by reading

- **Codes flow-gate does not read.** `NOT_ANSWERED` and `UNSUPPORTED_ROUTE` from `take` are not in the code list flows reads. That is fine: flows reads the entry first and only calls `take` on `answered` or `undeliverable` (§7.1 step 1).
- **Downgrade.** Only consumed entries without `handedAt` and entries with refusal rows would be set aside by an older binary. Pending detached entries still pass the old validator. The spec's warning about older versions is accurate.

For the review note (I wrote none): this is round 2 of the spec review (round 1 was codex/gpt-6.1-sol), verdict revise, findings Important 1, Minor 5, reviewer `claude-code/claude-opus-5-5`. I changed no files and ran no tests; the review was read-only against `feea755`.
