---
id: relay-b37ade
title: Type-check relay's JavaScript with tsc --checkJs and JSDoc types
status: done
priority: 2
size: m
complexity: mid
process: direct
owner: chore/typecheck
created: 2026-10-12T00:40:45Z
updated: 2026-10-15T08:56:50Z
started: 2026-10-15T08:36:36Z
completed: 2026-10-15T08:56:50Z
depends: []
tags: [tooling]
agent: claude-code/claude-opus-5-5
---

Relay is plain JavaScript with no checker, and relay-f58531's plan passes many object shapes (entries, messages, socket replies, Results) between modules; a type mismatch between neighbouring tasks is caught today only by review or a failing test.

Approach (settled 2026-10-11 in the relay-f58531 session):
- Keep .js sources: Node refuses to strip types from .ts files under node_modules, and familiar consumes relay as an installed package, so .ts sources would need a build step. JSDoc types plus // @ts-check give checking with no build and no runtime change.
- Add typescript as a devDependency only (runtime stays Node built-ins plus jsonc-parser); amend AGENTS.md's one-dependency line to say it counts runtime dependencies.
- tsconfig.json: allowJs, checkJs, noEmit, strict, module/moduleResolution nodenext, target es2023, types node (@types/node as a second devDependency, pinned to the Node 22 floor's major).
- Run tsc --noEmit in check_cmd so just check and the pre-commit hook enforce it.
- Type the shared shapes first, in one place (src/types.js typedefs: Handle, Agent, Snapshot, Event, Message, Entry, Result), then turn on @ts-check file by file; a file may land unchecked only with a note naming why.

Done: just check runs tsc and passes on main; every src/ and bin/ file is checked; AGENTS.md states the dependency rule; the Node 22 gate still passes.

Ordering with relay-f58531: independent. If it lands before that plan's Task 2, the plan's new modules carry JSDoc types from the start; if after, it types them with the rest.

## Notes

- 2026-10-12T01:04:03Z (main): piece of ops-a66936 (type-check every JS/TS project); this is the pilot: its tsconfig and check_cmd line inform ops-17cd42, which fam, forge and prism wait on
- 2026-10-15T08:36:36Z (main): started
  provenance: {"harness_session":"codex:01a13ead-6548-7d42-bd33-f8d9c6ad15e2","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-15T08:36:44Z (chore/typecheck): resumed
  provenance: {"harness_session":"codex:01a13ead-6548-7d42-bd33-f8d9c6ad15e2","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-15T08:48:31Z (chore/typecheck): Direct implementation in .worktrees/typecheck. Baseline: just test-fast passed 619/619 on Node 26.5.0 after setup. Strict check initially failed on missing annotations; now all src/bin files check with shared domain types and operation-specific socket responses. Added compile-time negative contract fixtures; runtime dependencies and public exports remain unchanged.
- 2026-10-15T08:54:40Z (chore/typecheck): Verification: just check passes; compiler --listFilesOnly includes all 43 src/bin JavaScript files. Removing the expected-error marker from numeric Handle.start made just check fail with TS2322; restored marker passes. just gate passes 619/619 on Node 26.5.0 and Node 22.23.2, including installed-tarball smoke and IPC/process tests.
- 2026-10-15T08:54:48Z (chore/typecheck): review: impl round 1 — verdict: accept; findings: Minor 1; reviewer: codex
- 2026-10-15T08:54:49Z (chore/typecheck): Ruling: accept. Critical and Important: none. minor (deferred): constrain socket handler return types with SocketResponses so producer drift is checked; clients are typed, but the server-to-contract agreement is currently asserted. No behavior was declined from review.
- 2026-10-15T08:56:25Z (chore/typecheck): Final verification: just gate passed 619/619 on Node 26.5.0 and Node 22.23.2 after the last code edits. Minor socket-producer coverage follow-up: relay-713015. Interrupted initial baseline left 28 confirmed fixture processes; cleaned those exact PIDs and host-load now reports nothing left running. Filed relay-4b0aea for interruption cleanup behavior.
- 2026-10-15T08:56:50Z (chore/typecheck): done
  provenance: {"harness_session":"codex:01a13ead-6548-7d42-bd33-f8d9c6ad15e2","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-15T08:56:50Z (chore/typecheck): Added strict JSDoc type checking across all 43 src/bin JavaScript files, shared domain and socket-client contracts, and compile-only negative fixtures. just check/pre-commit enforces it without a build step; TypeScript and Node 22 types are dev-only. Independent review accepted (no Critical/Important); minor server-response coverage deferred to relay-713015. Final just gate passed 619/619 on Node 26.5.0 and Node 22.23.2; deliberate numeric Handle.start mutation correctly failed. Process audit clean.
  provenance: {"harness_session":"codex:01a13ead-6548-7d42-bd33-f8d9c6ad15e2","harness_session_source":"CODEX_THREAD_ID"}
