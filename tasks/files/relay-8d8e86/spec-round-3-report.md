# Spec review round 3

Reviewer: codex/gpt-6.1-sol (agent /root/detached_spec_rereview).
Frozen revision: relay 94555165894c8bb47d314020aa1296b3895911fe,
docs/specs/2026-10-24-detached-ask-design.md.

Full returned review:

Verdict: **accept**. Nothing important remains before planning; user spec approval remains the next gate.

Reviewed frozen commit `94555165894c8bb47d314020aa1296b3895911fe`, `.worktrees/detached-ask/docs/specs/2026-10-24-detached-ask-design.md`, against the six prior findings and relevant existing code.

All six findings are resolved:

- The service-time check bounds future timestamps before clamping or replay lookup. The deterministic clamp, equality boundary, rejection boundary, later replay, and clock rollback behavior are specified.
- CLI surfaces are limited to `cli|terminal`, preserving HTTP origin assignment.
- Detached asks require an agent sender and user recipient, giving asker withdrawal a defined direction.
- Stale-refusal evidence explicitly counts attempts, including retries, and cannot identify unique answers or surfaces. Both HTTP and direct socket submissions are covered.
- File errors preserve the filesystem code while supplying a filename diagnostic without a duplicated code prefix.
- The service runbook’s presence behavior and desk commands are included in implementation scope.

No material ambiguity or regression was introduced by these corrections. A builder needs no further product decision before writing the plan.

Findings: Critical 0, Important 0, Minor 0. Reviewer: `codex/gpt-6.1-sol`.

Read-only review; no tests, edits, writes, or processes were started. Implementation remains unverified; the documented clock allowance and older-binary downgrade risk remain explicit design limits.
