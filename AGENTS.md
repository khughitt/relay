# relay — agent guide

- Follow the tasks skill: `tasks prime`, start before changes, CLI-only task edits,
  `tasks check` before commits, and completion in the same commit as its work.
- Planned work requires reviewed specs and plans before implementation. Reuse the
  approved extraction spec in ops; tasks identity has a separate design gate.
- Committed designs live in `docs/specs/`; implementation plans in `docs/plans/`.
- Use task worktrees under `.worktrees/`, native `git worktree add`, and `just setup`
  immediately when defined. Follow the host's WORK_ROOT lock/removal convention.
- Use conventional commits without AI attribution.
- Runtime: Node >=22, ES modules, Node built-ins. No presentation dependencies.
- GitHub owner is khughitt; check the active gh account before every gh write.
- Bootstrap verification is `tasks check`. The first runtime change must adopt
  ops's test front door, with `just setup`, `test-fast`, `test`, `check`, and `gate`.
