# relay — agent guide

- Follow the tasks skill: `tasks prime`, start before changes, CLI-only task edits,
  `tasks check` before commits, and completion in the same commit as its work.
- Planned work requires reviewed specs and plans before implementation. Reuse the
  approved extraction spec in ops; tasks identity has a separate design gate.
- Committed designs live in `docs/specs/`; implementation plans in `docs/plans/`.
- Use task worktrees under the main checkout’s .worktrees directory, native `git worktree add`, and `just setup`
  immediately when defined. Follow the host's WORK_ROOT lock/removal convention.
- Use conventional commits without AI attribution.
- Runtime: Node >=22, ES modules, Node built-ins. No presentation dependencies.
- GitHub owner is khughitt; check the active gh account before every gh write.
- Run `just setup` after creating a worktree. There are no npm dependencies to install.
- Verify through `just test-fast` while working and `just gate` before integration.
  Fast and full commands intentionally run the same suite. Hooks use the vendored
  ops front door; install core.hooksPath .githooks in a new clone.
- Test the Node 22 floor as well as the development runtime. The suite includes an
  actual local tarball install/CLI smoke test and real Linux IPC/process tests.
- R1 has no hook dispatcher, installer, subscribers or guards. Never enable the
  extracted OpenCode plugin until the dependent dispatch/installation gates pass.
- Before removing a worktree, harvest its timing logs with tt-report.
