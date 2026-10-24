What this change does: prepares v0.2.0 for detached inbox questions, updates both manifests, and records the API behavior and downgrade risk. Review identity: `codex/gpt-6.1-sol`.

Reviewed frozen range `03eb458..067c63921602e694682d47bdb2412862359c75ff` for relay-adb97d.

- **Critical:** none.
- **Important:** none.
- **Minor:** none.

The version choice is appropriate for the added API and durable history format. `package.json:3` and both lockfile version fields agree on 0.2.0; dependencies and package configuration remain unchanged.

The release summary at `.worktrees/release-v0.2.0/docs/runbooks/release.md:109` matches the API, service documentation, and relevant lifecycle/store code: detached persistence, seven-day expiry bound, repeat take behavior, stale-refusal history, retention reset, and downgrade quarantine risk. The terminal-parent summary matches the included fixes. The release commit contains merged detached support at `9e72787`, and `git diff --check` passed.

Publication status at `.worktrees/release-v0.2.0/docs/runbooks/release.md:130` correctly describes preparation without claiming publication or new live acceptance.

**Declined to judge:**

- Previously reviewed detached implementation correctness beyond checking the release claims; this assignment is release preparation.
- New live harness and Darwin acceptance; explicitly excluded from this release.
- Independent certification of privacy-scan results and development-runtime gates; those results were supplied by the controller, and I did not inspect their raw evidence.
- Node 22 gates, both git-install rehearsals, and anonymous public-tag installation; these checks were pending or necessarily follow publication.

**Verdict:** release preparation is acceptable. Publication readiness remains conditional on the pending gates and rehearsals passing at the frozen commit, followed by user approval of the exact push/tag actions. Task completion additionally requires the immutable annotated tag, successful anonymous installation on both runtimes, recorded evidence, and the exact tag/commit handoff to hq-536849.

No files were changed, suites rerun, agents spawned, or publication actions performed. The material remaining risk is downgrade quarantine; the release text states it explicitly.
