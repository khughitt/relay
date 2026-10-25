---
id: relay-a36561
title: Documentation review
status: doing
priority: 1
size: s
complexity: low
process: direct
owner: main
created: 2026-10-24T12:49:45Z
updated: 2026-10-25T00:57:51Z
started: 2026-10-25T00:49:28Z
depends: []
tags: [docs]
source: curate-docs
agent: codex
---

The reusable record of curate-docs passes over this project: one note per pass naming the rubric version, commit, documents covered, exclusions and findings by verdict; resolution of findings is recorded apart from the review. Never closed by a pass; ops owns its lifecycle.

## Notes

- 2026-10-24T12:49:48Z (main): doc-review: eligible since 2026-10-24: baseline
- 2026-10-24T18:56:23Z (main): Raised to P1 and undeferred on 2026-10-24 at the owner's request: first-pass documentation reviews of active projects run now rather than three a week under the doc-review cap. Run /curate-docs in this project's checkout; the next doc-review run acknowledges the pass as volunteered.
- 2026-10-25T00:49:28Z (main): started
  provenance: {"harness_session":"codex:01a17087-eb91-7c13-a9f7-0ac68f49faae","harness_session_source":"CODEX_THREAD_ID"}
- 2026-10-25T00:54:32Z (main): curate-docs: rubric v2; commit c2f0b07a18f24376189ce524d7aeb2b3f15c87c9; mechanical: ops-docs 2: tools/ops-docs absent and identity.toml absent, ops-check 0; covered: README.md whole, AGENTS.md whole, identity.toml absent, docs/api.md sections: introduction 1-14, Persisted and transient contracts 15-121, Public interfaces 122-255, Event mappings 256-330, Hook dispatch (R2) and all subsections 331-480, Storage CLI and failures 481-569, Codex model resolution 570-611, docs/runbooks/registry-lock-repair.md whole 1-57, docs/runbooks/hook-install-rollback.md whole 1-52 (720 reference lines; sampling-order deviation: linked short runbooks were read before completing the API sample; no document prose edited); excluded: docs/specs/ and docs/plans/ and docs/notes/: decision records, docs/runbooks/darwin-mac-handback-2026-09-25.md and docs/runbooks/inbox-e2e-2026-10.md: dated reports, tools/: vendored (tools/README.md read only to screen excluded guide), docs/evidence/ and docs/runbooks/darwin-evidence.json: evidence data, unread: docs/api.md 612-946 (Interaction messages and relay serve, Messages and entries, Lifecycle, Local socket protocol, HTTP protocol and guard, CLI and capability gate), docs/runbooks/answer-route-probes.md, docs/runbooks/darwin-probe.md, docs/runbooks/inbox-service.md, docs/runbooks/release.md; keep: 5, 8, 10, 11; not judged: 1: missing identity purpose and abstract, 2: no declared authority path, 6: retired in v2 budget checked mechanically; proposed: F2 AGENTS.md remove global/profile/task/worktree/commit/account/timing restatements (criterion 4; preserve local setup and gates), F5 README.md twenty event mappings to twenty-two (8 Claude plus 8 Codex plus 6 OpenCode in adapter tables); stale: F3 README.md dated verification/status paragraphs mix historical results into guidance (criterion 3), F4 AGENTS.md no installer contradicts src/install and its own relay install setup text and README (criteria 3 7 9), F6 docs/api.md 566-567 still presents user-present tailnet acceptance as a separate outstanding gate although README records acceptance passed and relay-480b51 already identifies the omission (criterion 9), F7 docs/api.md 501-506 presents an exhaustive command inventory omitting serve ask inbox and presence declared in src/commands.js (criterion 9; replace with scoped list or complete inventory); unresolved: 7
- 2026-10-25T00:56:46Z (main): curate-docs: resolution; identity.toml/tools/ops-docs: F1 adopt the mechanical guide contract -> relay-7b65a5 (reused); AGENTS.md: F2 remove global restatements -> relay-7b65a5 (reused); README.md: F3 remove dated verification prose -> relay-480b51 (reused); AGENTS.md: F4 replace no-installer stage prose while preserving capability gates -> relay-7b65a5 (reused); README.md: F5 correct twenty versus twenty-two mapped events -> relay-f25e1e (filed); docs/api.md: F6 correct completed acceptance status -> relay-480b51 (reused); docs/api.md: F7 scope the general CLI inventory and link interaction commands -> relay-485f3c (filed); decision: 0 awaiting the human
- 2026-10-25T00:57:51Z (main): parked (waiting on agent): Ops: acknowledge the volunteered rubric-v2 pass and schedule its next review. That reviewer starts with unread docs/api.md 612-946, then answer-route-probes, darwin-probe, inbox-service and release runbooks; findings from this completed pass are owned by relay-7b65a5, relay-480b51, relay-f25e1e and relay-485f3c. Read-only pass retained no worktree, scratch, evidence copies or processes.
  provenance: {"harness_session":"codex:01a17087-eb91-7c13-a9f7-0ac68f49faae","harness_session_source":"CODEX_THREAD_ID"}
