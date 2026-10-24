What this change does: Agents can post detached questions, exit, and later retrieve and acknowledge saved answers with `take`. The change also records stale-answer refusal attempts durably and adds the CLI surface and withdrawal options.

**Verdict: Accept; ready to merge.** No Critical, Important, or Minor findings. The controller owns integration.

Reviewer identity: **codex/gpt-6-astra**, freshly verified with `timeout 2 relay model --harness codex --pretty`.

Reviewed frozen range `084ce356b2c098711c7d4ca9f8de56730ad82a10..5bf0ef09d353ade85e2a83178ff805088a6ff746`, against spec `9455516` and plan `d9a405d`. The worktree advanced to `d852efd` during review; I verified that the intervening changes contain task records and gate attachments only, with no differences in the reviewed implementation, tests, inventory, or reference documents.

Strengths:

- Admission checks run inside the serialized operation, before replay lookup or sequence allocation. Tests exercise the exact future-time boundary, queued operation time, accepted replay, and rollback refusal without changing the saved entry.
- Detached socket requests bypass waiter reservation entirely. The collision regression verifies that conflicting and invalid detached requests leave the original native waiter receiving its answer.
- `take` reuses clock-before-mutation and durable commit handling. Answer expiry produces `undeliverable` before consumption, retaining the answer; concurrent and repeated takes return the same consumed entry without extending retention.
- The durable validator distinguishes detached consumption from native handoff evidence. Tests cover valid reloads, forged histories, forbidden routes and observations, expiry, supersession, and pruning.
- Stale refusals persist and publish before returning `STALE`. Identical refused retries add attempts, accepted-answer retries do not, and injected write failure exercises the existing fail-stop path.
- CLI validation preserves the approved local/service boundary. Tests distinguish local rejection of native files from service-unavailable errors for syntactically valid wrong-party detached files, and cover normalization rejection, argument errors, filesystem diagnostics, answer surfaces, and withdrawal direction.
- The implementation is small and uses the existing lifecycle, queue, store, parser, and response envelopes. Shared subprocess helpers now construct explicit environments, and their callers remain consistent with that change.

All five named Review Focus cases are covered by the implementation and meaningful regression assertions. I assessed load as a host-local, single-user inbox with concurrent local clients, consistent with the existing service model.

I reviewed every ledger ruling and found no reason to overturn one: detached asker-loss/confirmation guards, strict ask-file normalization, parent help text, existing subcommand-based error kinds, and canonical inventory adoption all fit the resulting implementation.

Verification:

- Independently inspected the recorded development and Node 22 gate logs: each reports **739 tests passed, zero failures, zero skipped**.
- Reviewed the new tests and connected unchanged code, including persistence, socket ownership/recovery, message validation, CLI reply construction, and shared subprocess callers.
- Did not rerun tests or type checking under this read-only assignment. Runtime versions and strict-check success are controller-reported evidence.

Behaviors considered but not independently judged:

- Live deployment, hook installation, physical Darwin behavior, and a real phone interaction: no such changes are included, and exercising them would exceed this review.
- Flows’ artifact-revision checks and translation of receipt into gate authority: these remain consumer responsibilities outside this branch.
- Other projects’ command semantics represented by unrelated canonical inventory rows: I inspected their adoption in the diff but did not audit those external implementations or the unrelated ops inventory blockage.

No edits, task mutations, pushes, or persistent processes were made by this reviewer; the worktree remains intact.

Not checked: fresh test execution, live deployment, or downstream Flows integration. Known risk: older relay binaries can quarantine the new durable histories; the reference docs explicitly prohibit that downgrade.
