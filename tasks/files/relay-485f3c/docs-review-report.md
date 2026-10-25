What this change does: relay-f25e1e removes the README’s stale event count. relay-485f3c explicitly scopes the general command inventory and links to the existing interaction CLI table. Both meet their documentation requirements.

Reviewer identity: `codex/gpt-6.1-sol` — exact stdout from a fresh `timeout 2 relay model --harness codex --pretty`, exit 0.

Reviewed frozen range `0edf2e716e67dd1c8cbc8aefc51161515187a901..1c83f33b5239f6ce76f074df211a89202b2a990a` using committed content.

Critical: 0. Important: 0. Minor: 0.

- `.worktrees/docs-cli-mappings/README.md:5`: Removing the count is explicitly permitted and preserves the introduction’s meaning. The frozen adapter tables contain 8 Claude Code, 8 Codex and 6 OpenCode mappings: 22 total. Dated verification prose is unchanged.
- `.worktrees/docs-cli-mappings/docs/api.md:501`: The inventory now clearly covers registry, hook dispatch, installation and model commands. Its command names and options agree with `src/commands.js`; relevant parser checks also support the documented forms.
- `.worktrees/docs-cli-mappings/docs/api.md:508`: The fragment resolves to the unique `### CLI and capability gate` heading at line 876.
- `.worktrees/docs-cli-mappings/docs/api.md:880`: The destination table covers the interaction commands and declared options, including `relay inbox ask --file PATH` and `relay inbox take ID`. Linking avoids duplicating that inventory.
- The branch changes only these documents and their task records. No runtime tests or behavior changes are needed.

Verification: Independent frozen-diff inspection and `git diff --check` passed. The controller reports baseline `just test` and post-edit `just test-fast` each passed 739 tests on Node 26.5.0, and `just gate` passed 739 tests plus hygiene, task and type checks on Node 22.23.2.

Declined to judge: Dated verification prose belongs to separate scope; runtime, live-hook and deployment behavior are unchanged and outside these documentation tasks.

Verdict: Ship. The controller can complete the task records and merge the reviewed branch locally.

Not checked: I did not rerun the reported suites. No material documentation risk found.
Review stayed read-only; no files, task records, index, branches or HEAD were changed, and no processes remain running.
