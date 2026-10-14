---
id: relay-413a0c
title: "Minor follow-ups from the test-fixture-leaks review: reap in the CLI test's after hook, refuse an unmarked hang fixture, single-pass reap, weak observer elapsed bound"
status: todo
priority: 3
size: xs
complexity: low
process: direct
created: 2026-10-14T22:45:29Z
updated: 2026-10-14T22:47:23Z
depends: []
tags: [testing]
source: "review:fix/test-fixture-leaks round 1"
agent: claude-code/claude-opus-5-5
---

Deferred minor findings from the whole-branch review of fix/test-fixture-leaks (2026-10-14):

1. test/cli.test.js survival-limitation test: t.after(()=>noneMarked(marker)) only asserts; if an assertion on the outer-killed run fails before reapMarked, the orphaned guard leaks. Use t.after(()=>reapMarked(marker)), keeping the inline checks.
2. Nothing stops a future argv('hang') call that omits a marker from leaking undetected. Cheap enforcement: the fixture's hang mode exits 9 unless argv[3] starts with relay-test-.
3. test/helpers/survivors.js reapMarked kills in one pass then only waits; a process appearing after the pass fails noneMarked instead of being reaped. Kill inside the polling check.
4. test/dispatch.test.js observer-budget test: the elapsed bound (< 10000) equals outerMs, so it proves little beyond the hung observer not running its full interval; same relative strength as before. A tighter bound (e.g. under the hang + quick + after budgets plus slack) would say more.
5. Other probe-test psArgs helpers read ps without -ww; their needles sit on short lines today, but -ww would make them robust to an exported COLUMNS too.

Done: each item fixed or ruled out with a note; just test-fast passes on Node 22 and the dev runtime.

## Notes

- 2026-10-14T22:47:23Z (fix/test-fixture-leaks): review round 2 minors: survivors.js now hard-codes /bin/ps (loud ENOENT on a host without it, e.g. NixOS; consistent with the probe tests) — consider a comment; test/survivors.test.js:17 runs markedPids twice per poll
