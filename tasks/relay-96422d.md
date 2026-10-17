---
id: relay-96422d
title: "Minor follow-ups from the Codex model resolver review: empty CODEX_HOME, call-contract nulls, failure-code wording, acceptance usage line"
status: todo
priority: 3
size: s
complexity: low
process: direct
created: 2026-10-17T15:41:03Z
updated: 2026-10-17T15:41:03Z
depends: []
tags: [codex]
agent: claude-code/claude-opus-5-5
---

From the final whole-branch review of relay-2cd4b1 (all Minor; merge was not blocked):
1. Check Codex's handling of an empty CODEX_HOME (believed: find_codex_home treats '' as unset). If confirmed, storeRoot in src/adapters/codex-rollout.js should treat '' as unset (test change in test/codex-rollout.test.js) and the spec should say so; today '' is INVALID_CONFIG, so a user with CODEX_HOME= exported never gets a verified stamp.
2. docs/api.md 'Codex model resolution' (the tasks-970049 call contract): say that model/effort are null on an unverified answer with thread/rollout filled as far as resolution got, that effort can be null when verified, and that a store-wide scan (archived_sessions included) follows a day-directory miss.
3. The failure-code list there reads as complete: Darwin ps can raise PROCESS_UNAVAILABLE / DEADLINE_EXCEEDED, and fstat/read errors escape withFile untyped (EISDIR). Either say 'for example' or wrap fstat/read in IO_ERROR and list PROCESS_UNAVAILABLE.
4. tools/codex-model-acceptance/run usage comment orders 'tui <sub> <outdir>' but the code takes outdir first; 'run tui start <outdir>' as documented creates ./start/work in the cwd.
5. resolveCodexModel's default createProcessOps() runs before the no-thread check (unsupported platform fails instead of answering no-thread); create it lazily.
Smaller deferred items (test strength, JSDoc shape, LINUX constant naming) are in the branch's review ledger summary in the relay-2cd4b1 notes.
