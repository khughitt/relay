---
id: relay-480b51
title: "Typed-messages docs and cleanup: stale acceptance status, ask exit-code and help text, missing socket codes, duplicate-question passthrough, duplicated reply/arg logic, probe cleanup"
status: todo
priority: 3
size: s
complexity: low
process: direct
created: 2026-10-13T18:16:14Z
updated: 2026-10-13T18:16:14Z
depends: []
tags: []
source: "review:89cdecb"
agent: claude-code/claude-opus-5-5
---

Why: the post-merge review of 89cdecb (2026-10-13) found these doc, help and cleanup items. Each one was checked against the code.

1. **Acceptance shown as pending.** docs/runbooks/inbox-service.md:4-6, which ships in the npm tarball, says the Task 14 acceptance "is still pending", and docs/api.md:474-478 lists "user-present tailnet acceptance" among the separate gates. Both contradict docs/api.md:738-742, the README, and the acceptance record docs/runbooks/inbox-e2e-2026-10.md. The relay-efb409 status update missed these two places.
2. **"Always exits 0" is inaccurate.** The `ask` protocol text says "always exits 0" (src/commands.js:14, tools/cli.toml:2674, docs/api.md:715), but argv usage errors exit 2 (bin/relay.js). Say: "exits 0 on runtime failures; usage errors exit 2".
3. **Wrong harnesses in help.** `relay help ask` prints `--harness claude-code|codex|opencode`, but only claude-code is accepted.
4. **Missing result codes.** The docs/api.md socket `ask` row omits NOT_WAITER (ruling F22) and ID_CONFLICT.
5. **Ruling F18 is undocumented.** A Claude form with duplicate question text goes to the native UI even while the user is away. Document it in docs/api.md and docs/runbooks/inbox-service.md.
6. **Duplicated code.**
   - `message()` in src/serve/http.js:38 duplicates `reply()` in src/cli/desk.js:251, which builds the same reply envelope. Share one helper in src/interaction.
   - The inbox argument checks in bin/relay.js are duplicated in `runInbox` (src/cli/desk.js), where they cannot be reached. Keep the checks in one place.
7. **tools/answer-probe/run.mjs.**
   - `cleanup` runs twice: it is registered on 'exit' and also called explicitly. The second pass re-signals recorded pids after they have exited, which risks hitting a reused pid. Make it idempotent.
   - The probe creates its temp output directory before the tmux preflight can refuse, which leaves an empty `answer-probe-*` behind.

Decision for the user, not part of this task's done: tasks/relay-4dfc10.md:43, a park note, commits the private tailnet hostname, although the acceptance record says it omits hostnames. The repo is private and main was not yet pushed as of 2026-10-13. Records are append-only, so removing the hostname means rewriting history before publication (relay-c19c0a) or accepting it.

Done:
- Items 1-7 are fixed.
- `tools/cli_surface.py` conformance passes.
- `just test-fast` passes on Node 22 and the dev runtime.
