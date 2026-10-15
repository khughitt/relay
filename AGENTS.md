# relay — agent guide

- Follow the tasks skill: `tasks prime`, start before changes, CLI-only task edits,
  `tasks check` before commits, and completion on the task's branch before it merges.
- Planned work requires reviewed specs and plans before implementation. Reuse the
  approved extraction spec in ops; tasks identity has a separate design gate.
- Committed designs live in `docs/specs/`; implementation plans in `docs/plans/`.
- Use task worktrees under the main checkout’s .worktrees directory, native `git worktree add`, and `just setup`
  immediately when defined. Follow the host's WORK_ROOT lock/removal convention.
- Use conventional commits without AI attribution.
- Runtime: Node >=22, ES modules, Node built-ins. No presentation dependencies.
- GitHub owner is khughitt; check the active gh account before every gh write.
- Run `just setup` after creating a worktree. It installs the one runtime npm dependency,
  `jsonc-parser` (bundled; only `relay install` needs it), plus development-only
  TypeScript and Node 22 types.
- Verify through `just test-fast` while working and `just gate` before integration.
  Fast and full commands intentionally run the same suite. Hooks use the vendored
  ops front door; install core.hooksPath .githooks in a new clone.
- `just check` runs strict `tsc --checkJs --noEmit` on every `src/` and `bin/` file.
  Shared JSDoc contracts live in `src/types.js`; preserve runtime validation at JSON
  boundaries. `test/types/` holds compile-time contract checks, never runtime tests.
- Test the Node 22 floor as well as the development runtime. The suite includes an
  actual local tarball install/CLI smoke test and real Linux IPC/process tests.
- R2 has the hook dispatcher and subscriber configuration; there is no installer. Never
  enable the extracted OpenCode plugin or register a live hook until the installation and
  capability gates pass.
- Before removing a worktree, harvest its timing logs with tt-report.
