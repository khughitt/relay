# Front door for tests. Copy to the project root and fill in the three commands below.
# Inner loop: `just test-fast` (affected-only). Full suite: `just test`.
# Gates: `just check` at pre-commit, `just gate` at pre-push and in CI.
# The git hooks call `hook-pre-commit` and `hook-pre-push` instead, which run the very
# same commands under their own target names. Hook cost is the number this design exists
# to measure, and it is invisible if the hooks record as `check` and `test`.
# Adoption: copy templates/githooks/ to .githooks/ and run
# `git config core.hooksPath .githooks`; append templates/gitignore to .gitignore so the
# fallback log directory `.tt/` is never committed; vendor ops bin/tt as tools/tt and ops
# bin/ops-check as tools/ops-check. The check command runs ops-check first: the shared
# hygiene checks (doc references exist, no Dropbox conflicted copies) in milliseconds.
# Every recipe runs through the vendored timing wrapper so the run is recorded. The
# wrapper counts tests from stdout; if the runner reports on stderr (python unittest
# does), end that command with `2>&1`.
# Design: ops docs/specs/2026-09-04-test-ci-audit-design.md.

set quiet
set positional-arguments

tt := "python3 tools/tt"

# The three commands, each written once. Recipes and hooks all run these, so a hook can
# never drift from the gate it is supposed to be. Avoid single quotes inside them.
# With no affected-only mechanism, set fast_cmd to the same command as test_cmd and say
# so here; the target must always exist and the report shows the gap as equal durations.
fast_cmd := "npm test"
test_cmd := "npm test"
one_cmd := "node --test"
check_cmd := "python3 tools/ops-check && tasks check && npx --no-install tsc --noEmit"

# What a fresh checkout or worktree needs before the suite can run: dependency installs
# (npm ci, uv sync) and any gitignored inputs the tests read, hydrated from the main
# checkout or a store. Idempotent; safe to rerun. The worktree convention runs it right
# after `git worktree add`, so a suite that fails before `just setup` is an unhydrated
# tree, not a bug. Recorded like the gates, because setup that recurs is a cost.
# Start with `just work-link` naming the directories this project generates
# (.venv, target; never node_modules), then install. In a Dropbox checkout,
# finish each install that creates a directory work-link does not cover
# (node_modules, caches) with the native ignore command on it, e.g.
# `npm ci && attr -s com.dropbox.ignored -V 1 node_modules`. Reapply after
# installation: package managers can replace the directory and lose its
# attribute. Use explicit, audited paths; never ignore source parents. Linux
# needs attr installed. Attribute failures must fail setup, not be swallowed.
setup_cmd := "just work-link .worktrees && npm ci && attr -s com.dropbox.ignored -V 1 node_modules"

# Affected-only: the inner loop.
test-fast:
    {{tt}} test-fast -- sh -c '{{fast_cmd}}'

# One test file or pattern: the inner loop while writing it. Recorded like the others.
test-one +args:
    {{tt}} test-one -- sh -c '{{one_cmd}} "$@" 2>&1' test-one "$@"

# The full suite.
test:
    {{tt}} test -- sh -c '{{test_cmd}}'

# Seconds, not minutes: format, lint, typecheck, tasks check.
check:
    {{tt}} check -- sh -c '{{check_cmd}}'

gate: check test

# Ask work-link to put the named generated directories (.venv, target; never
# node_modules) on WORK_ROOT behind in-tree links. Absent command: this machine
# has no dotfiles, entries stay in-tree, exit 0. Present: its own exit status,
# so unavailable storage fails setup instead of rebuilding in-tree.
work-link *names:
    {{tt}} work-link -- sh -c 'if command -v work-link >/dev/null; then work-link --ensure {{names}}; fi'

# Make this checkout runnable. Run once after `git worktree add`; rerun after a
# dependency change.
setup:
    {{tt}} setup -- sh -c '{{setup_cmd}}'

# What the pre-commit hook runs: `check`'s command under its own hook target.
hook-pre-commit:
    {{tt}} hook-pre-commit -- sh -c '{{check_cmd}}'

# What the pre-push hook runs: the same commands as `gate`, under one hook target.
hook-pre-push:
    {{tt}} hook-pre-push -- sh -c '{{check_cmd}} && {{test_cmd}}'

# Build the Darwin probe bundle from clean relay and ops checkouts (docs/specs/2026-09-25-darwin-probe.md).
darwin-bundle ops:
    node tools/darwin-probe/bundle.mjs --ops {{ops}}

# Unpack a bundle, clone both Git bundles, and run the ops guard preflight from the unpacked copies.
darwin-bundle-check tarball:
    #!/bin/sh
    set -eu
    d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
    tar xzf "{{tarball}}" -C "$d"; b=$(echo "$d"/relay-darwin-probe-*)
    git clone -q "$b/relay.bundle" "$d/relay"; git clone -q "$b/ops.bundle" "$d/ops"
    mkdir -p "$d/out"
    for h in claude-code codex; do
      command -v "$( [ "$h" = claude-code ] && echo claude || echo codex )" >/dev/null || continue
      python3 "$d/ops/bin/relay-guard-probe" --harness "$h" --relay "$d/relay/bin/relay.js" --guard "$d/ops/hooks/relay-guard" --out "$d/out" --skip-live >/dev/null
      python3 - "$d/out/$h/results.json" <<'PY'
    import json, sys
    r = json.load(open(sys.argv[1]))["replay"]
    assert "additionalContext" in r["clean"]["reply"], r
    assert r["attribution"]["exit"] == 2 and '"deny"' in r["attribution"]["reply"], r
    print("preflight ok:", sys.argv[1].split("/")[-2])
    PY
    done

# Judge a returned results tarball and write docs/runbooks/darwin-probe.md and darwin-evidence.json.
darwin-judge tarball ops:
    node tools/darwin-probe/judge-cli.mjs --tarball {{tarball}} --ops {{ops}}
