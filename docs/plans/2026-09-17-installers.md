# Relay Hook Installers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** revised draft for user review, 2026-09-17.

**Goal:** Complete `relay-baa816` with fixture-only installers for relay-owned Claude Code, Codex, and OpenCode bindings, exact before-images, and guarded rollback artifacts.

**Architecture:** Claude Code and Codex both plan edits to their JSON/JSONC hook documents from the same closed event/matcher table. OpenCode plans only the server observation plugin and never the familiar sprite plugin. Each planner classifies every command hook as relay-owned, a retireable familiar writer, or unrelated; it returns exact `{path,before,after}` changes. The shared writer persists and fsyncs an artifact before atomically renaming each file; recovery is guarded per file, never a multi-file transaction. The CLI imports installer modules only inside install/rollback branches, so `relay hook` retains no installer dependency.

**Tech Stack:** Node >=22, ES modules, Node built-ins for runtime; `jsonc-parser` as the sole foreground-installer dependency, using `modify`/`applyEdits` and excluded from the `relay hook` import graph.

**Spec:** `ops:docs/specs/2026-09-16-relay-design.md` §§3, 5, 7–8; `ops:docs/plans/2026-09-16-relay-bootstrap.md` R3 brief; `docs/plans/2026-09-17-dispatch.md` decisions 1–2.

## Settled Decisions

| Concern | Decision |
| --- | --- |
| Codex target | Edit an explicit `hooks.json` target in the Claude-shaped `{hooks:{EVENT:[{matcher?,hooks:[{type:"command",command}]}]}}` form. Never write `config.toml`: it stores harness-managed trust hashes, so the runbook requires an in-harness re-trust after `hooks.json` changes. |
| Ownership | For an event plus matcher: relay-shaped commands are replaced regardless of relay path or `--outer-ms`; two relay commands refuse. Familiar `… familiar hook [--agent codex] EVENT` entries require `--retire familiar` to remove; without it they refuse as a second lifecycle writer. All other hooks, including ops and `statusLine`, are preserved. |
| JSON preservation | Use `jsonc-parser` edits for Claude, Codex and OpenCode. Comments, formatting, and unrelated keys remain byte-identical outside the minimal edit spans. A `.jsonc`-only OpenCode target is edited in place; a `.json`/`.jsonc` pair is ambiguous and refuses. |
| Capability evidence | `--evidence FILE` reads `Evidence` below. Any event that can dispatch a configured guard or context subscriber requires a passed matching probe; missing/failed/mismatched evidence refuses the install and names its `(harness,event,reply)`. A probe matches only when event/reply match and its `outerMs` is at least the configured value. OpenCode needs no evidence for its observation-only plugin and always rejects guards. |
| Timeouts | Harness configuration stores seconds; Relay receives milliseconds. Every configured `outerMs` is a positive multiple of 1000 and writes `timeout: outerMs / 1000`. Claude/Codex SessionEnd profiles are 60000/3000 ms (60/3 s). |
| Inputs | Every install requires explicit target(s), `--subscribers FILE`, and an artifact path for apply. Claude/Codex use `--target FILE`; OpenCode uses `--config-dir DIR`. No default/home path is inferred. Artifacts may be anywhere explicit, never implicitly in a harness config directory. |

```js
type Change = { path: string, before: string | null, after: string };
type Artifact = {
  schema: 1, harness: 'claude-code'|'codex'|'opencode', changes: Change[],
  evidence: { harness: 'claude-code'|'codex', version: string } | null,
};
type Evidence = {
  schema: 1,
  harness: 'claude-code'|'codex',
  version: string,
  probes: Array<{ event: string, reply: 'refuse'|'context', outerMs: number, passed: boolean }>,
};
```

The CLI signatures settled here are:

```sh
relay install --harness claude-code --target FILE --subscribers FILE \
  [--evidence FILE] [--retire familiar] [--artifact FILE --apply]
relay install --harness codex --target FILE --subscribers FILE \
  [--evidence FILE] [--retire familiar] [--artifact FILE --apply]
relay install --harness opencode --config-dir DIR --subscribers FILE \
  [--artifact FILE --apply]
relay rollback --artifact FILE
```

Without `--apply`, install prints the artifact and changes nothing. With `--apply`, `--artifact FILE` is required and written+fsynced before the first target rename. Rollback accepts only an artifact path: its absolute change paths are authoritative and host-specific. The exact generated hook command is a `shellQuote`d absolute relay executable followed by `hook --harness H --outer-ms N EVENT`.

## Global Constraints

- Work only in `.worktrees/relay-baa816/`; tests use temporary directories and no command edits live host settings, enables a live hook, or registers the extracted OpenCode plugin.
- Preserve unrelated hooks, plugins, statusline and JSONC bytes. Refuse symlinks/non-regular files, malformed JSONC, an ambiguous OpenCode pair, invalid subscriber config, duplicate relay writers, unretired familiar writers, and apply/rollback drift.
- The closed matcher table is part of ownership: Claude `SessionStart` is `startup|resume`; `PreToolUse` is `*`; `Notification` gets `idle_prompt` and `permission_prompt`; other Claude entries are unmatched. Codex `PreToolUse` is `*`; all other mapped entries are unmatched.
- `ai/claude/settings.json` and `ai/claude/settings.work.json` are named Claude targets; callers pass their actual checkout file rather than a symlinked home path. Codex `config.toml` remains untouched.
- No daemon, retry worker, compatibility layer, generic installer framework, fabricated trust hash, or claim of live capability proof. `ops-c8e4d1` produces real probes and its prose runbook; this task consumes a portable evidence file. An artifact records only the authorizing evidence harness/version, not raw probe output.
- Each file update is temp-file-and-rename. A multi-file cutover is not atomic and a crash is resolved only by inspecting the artifact. The artifact is host/path-specific and not portable between installations.
- Use `tasks check` before commits, `just test-fast` while working, and `just gate` plus Node 22 before integration. Complete `relay-baa816` in the final work commit.

## File Map

| File | Responsibility |
| --- | --- |
| `src/install/atomic.js` | Artifact validation, fsynced recording, atomic apply, and per-file guarded rollback. |
| `src/install/hooks.js` | Shared JSONC command-hook planner, matcher table, and three-way ownership classification. |
| `src/install/claude-code.js` | Claude target selection and closed binding plan. |
| `src/install/codex.js` | Codex `hooks.json` target selection and closed binding plan. |
| `src/install/opencode.js` | OpenCode server plugin plan, excluding `tui.*`. |
| `src/install/capabilities.js` | Evidence schema and adapter/budget gate. |
| `bin/relay.js` | Dynamic installer imports, install/rollback flags and JSON artifact I/O; update `HELP`. |
| `test/install-atomic.test.js` | Artifact fsync, atomic apply, and per-file recovery cases. |
| `test/install-capabilities.test.js` | Evidence schema, capability, and budget cases. |
| `test/install-hooks.test.js` | Shared matcher, ownership, and JSONC-preservation cases. |
| `test/install-claude-code.test.js` | Claude target/cutover cases. |
| `test/install-codex.test.js` | Codex `hooks.json` cutover and trust-record non-write cases. |
| `test/install-opencode.test.js` | OpenCode JSON/JSONC and sprite-isolation cases. |
| `test/install-cli.test.js` | Explicit CLI input and partial-cutover cases. |
| `docs/runbooks/hook-install-rollback.md` | Dry run, apply, re-trust, rollback and partial-cutover procedure. |

### Task 1: Add durable artifact and guarded file recovery

**Files:** Create `src/install/atomic.js`, `test/install-atomic.test.js`.

- [ ] Write failing tests for no-op diffs; deterministic artifact validation; fsync artifact before any rename; temporary sibling cleanup; preimage drift; and each rollback state: `after` restores, `before` skips, any other bytes refuse.
- [ ] Run `node --test test/install-atomic.test.js`; expect import failure.
- [ ] Adapt familiar's `writeAtomicSync` into the smallest synchronous writer: exclusive sibling temp, write, fsync, rename, cleanup, and `AggregateError` on cleanup failure. `applyArtifact` accepts only an absent file for `before:null` and matching preimage otherwise. `rollbackArtifact` handles each file independently as specified; do not add a lock or transaction.
- [ ] Re-run the focused test; add a first-rename crash fixture that shows guarded completion and guarded rollback.
- [ ] Commit `feat: add guarded installer artifacts`.

### Task 2: Define evidence and validate subscriber budgets

**Files:** Create `src/install/capabilities.js`, `test/install-capabilities.test.js`.

- [ ] Write failing schema tests for unknown fields, invalid version/event/reply/outerMs, failed or mismatched probe, observation-only reply request, and subscriber totals rejected by `checkBudget`.
- [ ] Run `node --test test/install-capabilities.test.js`; expect import failure.
- [ ] Implement strict `Evidence` parsing. Use `adapterFor`, `budgetFor`, and `checkBudget` to permit each guard/context event only with a matching passed probe (same event/reply and `probe.outerMs >= configured outerMs`); otherwise refuse before creating an artifact and name the missing tuple. Require whole-second milliseconds and enforce 60000/3000-ms SessionEnd caps. Carry only `{harness,version}` into the approved artifact.
- [ ] Re-run the focused test with Claude/Codex examples and an OpenCode guard rejection.
- [ ] Commit `feat: validate installer capability evidence`.

### Task 3: Build the shared JSONC hook planner and ownership model

**Files:** Modify `package.json`, create and commit `package-lock.json`, modify `justfile`; create `src/install/hooks.js`, `test/install-hooks.test.js`.

- [ ] Add failing JSONC fixtures with comments, spacing, `SessionStart`, `PreToolUse`, both Notification matchers, duplicate relay commands, a stale relay path/timeout, familiar entries, ops entries, statusline, malformed nesting, and the live unquoted `~/d/familiar/bin/familiar hook --agent codex SessionStart` form alongside familiar's current shell-quoted trailing-agent form.
- [ ] Run `node --test test/install-hooks.test.js`; expect import failure.
- [ ] Use `jsonc-parser` `modify`/`applyEdits` to make only selected `hooks` array edits. Classify commands by the shape `relay hook --harness H [--outer-ms N] EVENT`, not exact path/timeout; include event plus matcher in identity. Recognize the strictly delimited shell-quoted and unquoted executable forms generated by familiar's `shellQuote` helper without evaluating shell text, and recognize familiar's agent flag before or after the event. With `--retire familiar`, remove exactly one relevant familiar writer; otherwise refuse it. Preserve every unrelated entry verbatim and reject duplicate relay writers.
- [ ] Encode the matcher table and a `shellQuote` equivalent of familiar's one-line helper in one module. Test exact generated Claude/Codex hook documents against familiar's `src/install/setup.js` shapes, adding Relay's timeout argument.
- [ ] Add `jsonc-parser`, commit the generated lockfile, and change `setup_cmd` to `just work-link .worktrees && npm ci && attr -s com.dropbox.ignored -V 1 node_modules`. Re-run focused tests and prove comment/unrelated-byte preservation.
- [ ] Commit `feat: plan relay hook document edits`.

### Task 4: Plan Claude Code and Codex cutovers against their actual targets

**Files:** Create `src/install/claude-code.js`, `src/install/codex.js`, `test/install-claude-code.test.js`, `test/install-codex.test.js`.

- [ ] Write Claude tests for each named settings file and Codex tests for `hooks.json`; in both, cover relay replacement, retired familiar without/with `--retire familiar`, preserved ops hook, matcher-sensitive ownership, subscriber budget/evidence gate, and exact rollback artifact.
- [ ] Add Codex regression fixtures containing a separate `config.toml` trust record. Assert the planner neither reads nor writes it, and that a changed hooks document produces a runbook re-trust requirement instead of any `trusted_hash`.
- [ ] Run `node --test test/install-claude-code.test.js test/install-codex.test.js`; expect import failure.
- [ ] Implement thin harness-specific binding lists over `hooks.js`: Claude maps all eight adapter events and Codex maps its six events; both set seconds `timeout` from the validated millisecond profile. Codex never adds Interrupt. Each returns one exact artifact for its explicit JSON target.
- [ ] Re-run the focused tests and assert no named path is inferred from `HOME`, `CODEX_HOME`, or an input symlink.
- [ ] Commit `feat: plan relay lifecycle hook cutovers`.

### Task 5: Plan only the OpenCode observer plugin

**Files:** Create `src/install/opencode.js`, `test/install-opencode.test.js`.

- [ ] Copy familiar regression fixtures for absent JSON, malformed root/plugin, `.jsonc` only, a `.json`/`.jsonc` pair, existing relay plugin once/twice, and a familiar sprite plugin.
- [ ] Run `node --test test/install-opencode.test.js`; expect import failure.
- [ ] Use the same JSONC edit dependency to add the packaged absolute `integrations/opencode/plugin.js` exactly once to the selected server config. A second relay entry refuses as a duplicate writer. Edit `.jsonc` in place; refuse a pair. Never inspect/write `tui.json`, never reference `sprite-plugin.tsx`, never require capability evidence for observation, and reject guards.
- [ ] Re-run the focused test; assert malformed input produces no artifact and a partial recovery cannot modify the sprite entry.
- [ ] Commit `feat: prepare OpenCode relay observer install`.

### Task 6: Expose explicit CLI operations and document cutover recovery

**Files:** Modify `bin/relay.js`, `test/cli.test.js`; create `test/install-cli.test.js`, `docs/runbooks/hook-install-rollback.md`.

- [ ] Write failing CLI tests for every signature above: positional harness is rejected, target/config-dir/subscribers are required and non-empty, repeated/flag-shaped arguments fail before reads, dry-run emits an artifact only, `--apply` requires `--artifact`, artifact paths outside the target directory work, and rollback accepts only `--artifact FILE` with artifact paths authoritative.
- [ ] Add fixture-only partial-cutover tests: artifact written+fsynced before the first rename; first target already after plus second before can complete or roll back; a third-party byte change refuses; `before:null` requires absence on apply and removes only matching after bytes on rollback.
- [ ] Implement strict parser and dispatch. Preserve `hook`, `reap`, and `list`; replace the unavailable-install `HELP`/CLI test with the exact supported signatures. Dynamically `import()` installer modules only inside `install` and `rollback` branches; static hook/list/reap imports remain dependency-free. Read the explicit subscribers file, never conflate it with harness config, and serialize one stable JSON artifact/error envelope.
- [ ] Write the runbook with dry-run → review artifact → explicit apply, no-live-session precondition, current config targets, Codex in-harness trust review, per-file recovery table, OpenCode scope, and the existing registry-lock repair boundary. State that real capability evidence comes from `ops-c8e4d1` and live cutover is later work.
- [ ] Add a package-isolation test that copies the CLI/runtime files to a temporary directory without `node_modules`, runs `relay hook`, and expects the existing hook behavior. Run `just test-fast`, `just gate`, and the same gate with Node 22 first on `PATH`; run `tasks check`. Update this plan's status, complete `relay-baa816` in the final source/docs commit, and commit `feat: prepare relay hook installers`.

## Verification and Handoff

Inspect `git diff --check`, run `tasks check`, `just gate`, and the Node 22 gate. Confirm all installer tests use isolated paths and that the no-`node_modules` hook test proves dynamic import isolation. The release evidence distinguishes fixture artifacts from the real Claude/Codex capability probes owned by `ops-c8e4d1`; no live configuration is changed in this task.

No spec addendum is needed: this plan now applies the existing target, ownership, capability, timeout, and recovery decisions without extending the contract.
