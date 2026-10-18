# Releases

relay is consumed as a git dependency pinned to an annotated tag,
`git+https://github.com/khughitt/relay.git#v<version>`. It is not published to the npm
registry (`package.json` stays `"private": true`). This runbook is the procedure for
cutting a release and the record of each one.

## Procedure

Run every step from the main checkout. Name the gh account on every gh command
(`GH_TOKEN=$(gh auth token --user khughitt) gh …`). Never switch the global account.

1. **Gate.** Run `just gate` on the development runtime and on the Node 22 floor
   (`PATH="<node 22 bin>:$PATH" just gate`). Both must pass.
2. **Fix the release commit.** Set `REL=$(git rev-parse HEAD)` and write it in a task note
   with both gate counts. Every later step uses `REL`, never a moving `main`.
3. **Privacy review.** Run the commands below over `REL`'s history. Every result must
   match. The whole history becomes public with the repository.
4. **Rehearse `REL`.** Clone the repository bare into a scratch directory, tag `REL` there
   (`git -C <scratch>/relay.git tag -a v<version>-rehearsal -m rehearsal "$REL"`), and run
   `node tools/release/portability.mjs --spec git+file://<scratch>/relay.git#v<version>-rehearsal --commit "$REL"`
   on both runtimes. Both must print `portability: pass`. A tag cannot be moved, so a
   git-install defect has to be found here, before anything is pushed.
5. **Account and remote.** `gh api user --jq .login` prints `khughitt`.
   `gh repo view khughitt/relay --json visibility` shows the expected visibility.
   `git ls-remote --refs origin` lists `refs/heads/main`, at an ancestor of `REL`, and no
   refs other than earlier release tags.
6. **Push and tag.** Run `git push origin "$REL:refs/heads/main"`, then
   `git tag -a v<version> -m "relay v<version>" "$REL"` and
   `git push origin refs/tags/v<version>`. Then `git ls-remote origin 'refs/tags/v<version>^{}' refs/heads/main`
   must print `REL` twice, and `git ls-remote --refs origin` must list `main`, the earlier
   release tags and the new tag, nothing else.
7. **Private refusal.** While the repository is private, run
   `node tools/release/portability.mjs --spec git+https://github.com/khughitt/relay.git#v<version> --commit "$REL"`.
   It must fail with `FAIL reach: … could not read Username for 'https://github.com': terminal prompts disabled`.
   Any other failure proves nothing. A pass means the check is not isolated.
8. **Visibility.** Run `gh repo edit khughitt/relay --visibility public --accept-visibility-change-consequences`
   for the first release. After that, check the repository is already public.
9. **Portability.** Run the same check against the public tag, on both runtimes. It must
   print `portability: pass`. Record its output in the release's publication record.

A tag is never moved or deleted. A release that fails after its tag is pushed is fixed
forward with the next patch version, but only once the failure reproduces. A network,
DNS, GitHub 5xx or codeload error, or a newly public repository not yet serving
anonymous fetches, is rerun after a short wait. It is a defect only when it fails the
same way with the network healthy.

### Privacy review

Every history command passes `--diff-merges=first-parent`. Plain `git log -p` and
gitleaks's default run both omit merge diffs, so content introduced only in a merge
resolution would pass unseen. This was reproduced for both on 2026-10-18; a gitleaks
control found the same secret in an ordinary commit. Replace `--all` with `"$REL"` (or a
range) to review one release's history.

| Check | Command | Expected |
| --- | --- | --- |
| Secrets | `gitleaks git --no-banner --redact --log-opts='--all --diff-merges=first-parent' .` | `no leaks found` |
| State and transcripts | `git log --all --diff-merges=first-parent --name-only --format= \| sort -u \| grep -E '\.jsonl$\|agents\.json$\|subscribers\.json$\|credentials\|auth\.json$\|\.env$\|\.bundle$\|\.tar\.gz$\|\.tgz$'` | no output |
| Authors | `git log --all --format='%ae%n%ce' \| sort -u` | only the maintainer's address |
| Machine paths | `git log --all -p --diff-merges=first-parent --format= -- . ':(exclude)tasks' \| grep -E '^\+' \| grep -c -F -f "$RELEASE_PRIVATE_PATHS"` | `0` |
| Private identities | `git log --all -p --diff-merges=first-parent --format='%an%n%cn%n%B' \| grep -i -c -F -f "$RELEASE_PRIVATE_TERMS"` | `0` |
| Work hosts, if `$RELEASE_PRIVATE_HOSTS` exists | the same command with `-f "$RELEASE_PRIVATE_HOSTS"` | `0` |
| Published pre-images | `gh api repos/khughitt/relay/activity --jq '[.[] \| select(.activity_type=="force_push")] \| length'` | `0` |

A count of `0` is clean only once each term is shown to match its source. `grep -c -F -f`
prints `0` for a mistyped term, and how it treats an empty pattern file depends on the
grep build. A search that prints no count at all has failed; it is not a `0`. So run
these controls first, from the main checkout, and stop if any fails:

- `grep -c -v -x -E '[[:space:]]*/?[[:space:]]*' <file>` is at least `1` for each pattern
  file: each holds a real pattern.
- `grep -c -x -E '[[:space:]]*/?[[:space:]]*' <file>` prints `0` for each pattern file.
  An empty line or a bare `/` matches everything.
- `pwd -P | grep -c -F -f "$RELEASE_PRIVATE_PATHS"` is at least `1`. The paths file is
  generated, so one match proves it.
- Term by term: `while IFS= read -r t || [ -n "$t" ]; do gh auth status 2>&1 | grep -i -c -F -e "$t"; done < "$RELEASE_PRIVATE_TERMS"`
  prints a count of at least `1` for every line, a final line without a newline included.
  A whole-file check would pass with one good term and one mistyped one.

If a control fails, rebuild that file before reading any search result. Work host names
cannot be proven against a source, so they live in their own file, which the maintainer
writes and confirms by eye.

The two pattern files live outside the repository, so no private path or name is ever
committed:

- `$RELEASE_PRIVATE_PATHS` is written at run time from the main checkout:
  `printf '%s\n' "/home/$USER" "/Users/$USER" "$(df --output=target . | tail -1)" "$(df --output=target "$(readlink -f .worktrees)" | tail -1)"`.
  That covers the user directories and the storage mounts of the checkout and the worktree root.
- `$RELEASE_PRIVATE_TERMS` holds exactly the terms the term-by-term control can prove:
  the login of the gh account that `gh auth status` lists besides `khughitt`, and the
  employer token in that login.
- `$RELEASE_PRIVATE_HOSTS` is optional: one work host name per line, written by the
  maintainer.

The record states how many terms and hosts were searched, never the terms.

A non-zero count of published pre-images means GitHub still serves commits that a
force-push replaced. They stay fetchable by sha. Stop, and decide with the maintainer
before publishing.

The acceptance criterion: no secrets, credentials, transcripts, registry or subscriber
state, user paths outside `tasks/`, or private identities. Machine paths and host names
in task notes are accepted, as in the public tasks and familiar repositories.

## v0.1.0

### Platform status

On Linux, the full suite and the git-install portability check pass. The verification map
below says which spec requirements that covers and which tasks own the rest. On Darwin,
v0.1.0 is fixture-tested only. The physical Mac
attempts of 2026-09-25 (`docs/runbooks/darwin-probe.md`) found defects that have since
been fixed: `relay-6e9410`, `relay-7eef39`, `relay-661946` and `relay-5e4d93`. The
physical rerun is `relay-848c0f`, which gates installing relay hooks on a Mac. It carries
two open tasks: `relay-ba3153` (five Darwin-probe tests fail under `npm test` on a real
Mac) and `relay-64975d` (live acceptance of `relay model` on Darwin). The probe bundle
ships relay's runtime dependency beside relay's tarball, so it can run at this tag.

### Packaged files

`npm pack --dry-run --json --ignore-scripts` over a copy of the tracked files (what a git
install packs) lists 59 paths:

```
LICENSE
README.md
bin/relay.js
docs/api.md
docs/runbooks/inbox-service.md
docs/runbooks/registry-lock-repair.md
integrations/opencode/binding.js
integrations/opencode/hook.js
integrations/opencode/plugin.js
integrations/opencode/queue.js
integrations/opencode/window.js
package.json
schemas/interaction/message.schema.json
src/adapters/ancestry.js
src/adapters/claude-code.js
src/adapters/codex-model.js
src/adapters/codex-rollout.js
src/adapters/codex.js
src/adapters/index.js
src/adapters/opencode.js
src/adapters/payload.js
src/adapters/reply.js
src/bus/identity.js
src/bus/lock.js
src/bus/paths.js
src/bus/proc.js
src/bus/prune.js
src/bus/store.js
src/bus/transaction.js
src/child.js
src/cli/desk.js
src/commands.js
src/dispatch.js
src/index.js
src/install/atomic.js
src/install/capabilities.js
src/install/claude-code.js
src/install/codex.js
src/install/hooks.js
src/install/opencode.js
src/interaction/lifecycle.js
src/interaction/message.js
src/interaction/store.js
src/protocol.js
src/routes/ask.js
src/routes/claude-code.js
src/routes/index.js
src/serve/client.js
src/serve/config.js
src/serve/guard.js
src/serve/http.js
src/serve/inbox.js
src/serve/lines.js
src/serve/serve.js
src/serve/socket.js
src/subscribers.js
src/types.js
test/fixtures/ancestry.json
test/fixtures/handles.json
```

### License provenance

- relay is MIT (`LICENSE`).
- The one runtime dependency, `jsonc-parser` 3.3.1, is MIT and is not redistributed.
  The consumer's npm fetches it from the registry and pins it by integrity in the
  consumer's lockfile. Until this release it was listed in `bundledDependencies`, which a
  git install cannot honour: a clone has no `node_modules`.
- The development-only `typescript` and `@types/node` are not shipped.
- `git grep -n -i -E 'copyright|licen[cs]e' -- bin src integrations schemas` finds no
  third-party header in shipped code.

### Verification map

One row per bullet of the spec's "Required verification for the release" (ops
`docs/specs/2026-09-16-relay-design.md`). A clause is verified only where the evidence was
located and read; test names are quoted from the files. Paths in other repositories carry
their name (`ops:`, `tasks:`, `familiar:`).

| Spec requirement | Status | Evidence, or the task that owns it |
| --- | --- | --- |
| Adapter, store, lock and process tests; concurrent writers, corrupt state, lock-holder death, PID reuse, reboot, zombie, unreadable process; Darwin fixtures; shared JS/Rust handle fixtures; schema bump with the tasks reader | Verified on Linux | The suite (Gates below). `test/lock.test.js`, `test/lock-multiprocess.test.js` ('eight real processes retain all counter updates, including dead main reclamation'; 'killed main owner recovers; killed guard requires repair without snapshot changes'), `test/store.test.js`, `test/transaction.test.js`, `test/proc.test.js`, `test/prune.test.js`, `test/ancestry.test.js`. The Darwin fixtures are kept (`test/fixtures/handles.json`, `test/fixtures/ancestry.json`). The shared fixtures are byte-identical in `tasks:tests/fixtures/relay/`, read by `tasks:src/relay/snapshot.rs`. The schema 1 to 2 bump landed with the tasks reader (`tasks-2dd094`). On Darwin a zombie reads alive, and the physical probe is `relay-848c0f`. |
| A bad theme or unavailable observer cannot block publication or allow a denied command; missing storage cannot bypass a guard | Verified for relay; the theme half is `fam-6e8321` | `test/dispatch.test.js`: 'observers get sanitized metadata after publication and cannot touch the reply', 'a slow observer never delays a denial and observers run only within their budget', 'guard results survive missing storage, broken enrichment and lock exhaustion'. `test/cli.test.js`: 'an installed entry keeps its guard when the hook environment loses the config base'. |
| Guard denial, timeout, invalid JSON, mixed allow/deny, unsupported capability; live probes before each capability; every mapping row, environment pass-through, deadline accounting, slow observer after denial; outer-timeout and startup failure recorded separately | Partly | Fixtures: `test/dispatch.test.js` ('every guard failure relay survives is a native refusal', 'mixed allow and deny with an erroring guard still refuses with the denial reason'), `test/payload.test.js` ('all twenty-two mappings have literal kind and level expectations'), `test/subscribers.test.js`, `test/child.test.js`. Live PreToolUse probes: ops `docs/runbooks/relay-guard-probes.md` (`ops-c8e4d1`), run at relay `c513320`. `relay install` refuses unproven bindings (`test/install-capabilities.test.js`). Outer-timeout and startup failure are documented in `docs/api.md` and simulated in `test/cli.test.js`, but never observed live. Rerunning the probes at the release commit, and the live failure cases, are `relay-7cd100`. |
| Observer intent cannot regress; reap clears it; generation recreation and a crash between write and observer reconcile; terminal cleanup and OpenCode concurrency tests pass | Partly: relay verified, familiar is `fam-6e8321` | `test/transaction.test.js` ('every observed upsert increments; exact removal no-op and generation recreation', 'OpenCode reduction sees latest state after contention'), `test/dispatch.test.js` ('reconcile prunes, then notifies reconcile observers even when nothing changed'), `integrations/opencode/queue.test.mjs`, `integrations/opencode/binding.test.mjs`. familiar's intent, terminal cleanup and reconcile run against relay in `fam-6e8321`. |
| Installers preserve unrelated settings, refuse double registration, restore the prior configuration; one live session per harness; Codex SessionEnd budget; remote-tag install from a clean clone and cache | Partly | `test/install-hooks.test.js`, `test/install-opencode.test.js`, `test/install-routes.test.js`, `test/install-atomic.test.js` ('rollback restores after, skips before, and refuses drift per file'), `test/install-cli.test.js`. Codex SessionEnd: `test/subscribers.test.js` and `test/install-hooks.test.js` (3 s outer timeout), plus a live SessionEnd in `docs/notes/2026-10-15-codex-worker-rows-acceptance.md`. Live sessions per harness through every state, clean exit and abrupt death are `hq-539508`. The remote-tag install is this release's publication record (`tools/release/portability.mjs`). |
| The tasks consumer: live-owner refusal, takeover, release retries, unknown-evidence TTL, standalone use, distinct subagents, registry loss, ancestor qualification, shared handles, nested harnesses, Codex before its first hook, continuity, no Node, plain shell, unmatched harness | Partly | `tasks:tests/cli.rs` and `tasks:src/{claims.rs,relay/resolve.rs,relay/ancestry.rs,relay/snapshot.rs}` (`tasks-c9199a`, `tasks-2dd094`). For example: `a_live_claim_from_another_session_refuses_start`, `an_acceptance_owner_can_park_and_close_after_the_registry_is_removed`, `an_acceptance_nested_harness_cannot_close_the_outer_sessions_task`, `a_match_requires_the_harness_to_agree_with_the_boundary_harness`. A relay-on successful takeover, a relay-on release retry, a run with no Node and a plain shell with a corrupt registry lack end-to-end tests; they are `tasks-00593c`. |

v0.1.0 verifies the clauses with evidence above. The others belong to the tasks named.

### Capability evidence

`relay install` refuses guard and route bindings without a passed record in
`--evidence` (`src/install/capabilities.js`), so this evidence is per harness version.

| Capability | Evidence | Version scope |
| --- | --- | --- |
| Claude Code answer routes | `docs/evidence/claude-code-answer-routes.json` (five routes) | Claude Code 2.1.296 |
| Guard dispatch, Claude Code | ops `docs/runbooks/relay-guard-probes.md`, `docs/runbooks/relay-guard-evidence-claude-code.json` (`ops-c8e4d1`) | Claude Code 2.1.282 |
| Guard dispatch, Codex | ops `docs/runbooks/relay-guard-probes.md`, `docs/runbooks/relay-guard-evidence-codex.json` (`ops-c8e4d1`) | codex-cli 0.157.0 |
| Inbox answer, defer and withdrawal | `docs/runbooks/inbox-e2e-2026-10.md` | Claude Code 2.1.296, Node 26.5.0, Linux |
| Codex worker rows | `docs/notes/2026-10-15-codex-worker-rows-acceptance.md` | codex-cli 0.162.1 |
| Codex model resolution | `docs/notes/2026-10-17-codex-model-acceptance.md` | codex-cli 0.163.0, Linux |
| Darwin process identity and hooks | `docs/runbooks/darwin-probe.md` | pending: `relay-848c0f` |

### Gates

`just gate` on the release branch with this record, 2026-10-18: 686 of 686 tests pass on
Node 26.5.0 and 686 of 686 on Node 22.23.2, including the installed-tarball smoke and the
tracked-files pack check. The publication record repeats the gate for the release commit.

### Publication record

| Item | Value |
| --- | --- |
| Tag | `v0.1.0`, annotated, tag object `9362dde74771a4be4b4c8c626e6cb1876dc29c0f` |
| Release commit (`REL`) | `0f596607ad088be7607a9ff0b30f2073d2ee9147`, the merge of `release/v0.1.0` into main |
| Pushed | 2026-10-18: main `db4ecd0..0f59660`, then the tag. The tag's commit, the remote's peeled tag and the remote's main were all `REL`, and `git ls-remote --refs` listed exactly main and the tag. |
| Made public | 2026-10-18T22:33:32Z |
| Consumer pin | `git+https://github.com/khughitt/relay.git#v0.1.0` |

Before publication, the repository was recreated private, holding only the rewritten main
(`relay-06b733`). Its activity shows no force-push.

- **Gates at `REL`.** `just gate` passed 687 of 687 on Node 26.5.0 and 687 of 687 on
  Node 22.23.2. The pre-push hook ran the gate again on the push.
- **Privacy review at `REL`.**
  - The controls passed: each pattern file holds real patterns and no blank line, the
    `pwd -P` control matched, and each term matched on its own.
  - gitleaks with merge diffs scanned 1073 commits and found no leaks.
  - No state or transcript files; one author address.
  - Machine paths: 0. Private identities: 0, over 2 terms. No hosts file was used, by the
    maintainer's decision.
  - Published pre-images: 0.
- **Rehearsal at `REL`.** A `git+file` install from a scratch tag passed on both runtimes.
- **Private refusals.** Two runs printed the same refusal:
  `FAIL reach: fatal: could not read Username for 'https://github.com': terminal prompts disabled`. The first ran before anything was pushed (plan Task 3 Step 7), against the
  earlier private remote's main `fa1d7c9`. The second ran against the pushed tag, before
  the visibility change.
- **Portability against the public tag.** The runs below came from
  `tools/release/portability.mjs` at `REL`. The lockfile records relay as `git+ssh://…`,
  and `npm ci` installs that entry anonymously over https.

Node 26.5.0 (npm 11):

```
ok reach: 9362dde74771a4be4b4c8c626e6cb1876dc29c0f	refs/tags/v0.1.0
ok install: npm install of git+https://github.com/khughitt/relay.git#v0.1.0
ok manifest: dependency kept as git+https://github.com/khughitt/relay.git#v0.1.0
ok lockfile: relay git+ssh://git@github.com/khughitt/relay.git#0f596607ad088be7607a9ff0b30f2073d2ee9147; jsonc-parser https://registry.npmjs.org/jsonc-parser/-/jsonc-parser-3.3.1.tgz sha512-HUgH65KyejrUFPvHFPbqOY0rsFip3Bo5wb4ngvdi1EpCYWUQDC5V+Y7mZws+DLkr4M//zQJoanu1SP+87Dv1oQ==
ok smoke: installed package verified
ok ci: npm ci from the lockfile with an empty cache; installed package verified
portability: pass
```

Node 22.23.2 (npm 10.9.8):

```
ok reach: 9362dde74771a4be4b4c8c626e6cb1876dc29c0f	refs/tags/v0.1.0
ok install: npm install of git+https://github.com/khughitt/relay.git#v0.1.0
ok manifest: dependency kept as git+https://github.com/khughitt/relay.git#v0.1.0
ok lockfile: relay git+ssh://git@github.com/khughitt/relay.git#0f596607ad088be7607a9ff0b30f2073d2ee9147; jsonc-parser https://registry.npmjs.org/jsonc-parser/-/jsonc-parser-3.3.1.tgz sha512-HUgH65KyejrUFPvHFPbqOY0rsFip3Bo5wb4ngvdi1EpCYWUQDC5V+Y7mZws+DLkr4M//zQJoanu1SP+87Dv1oQ==
ok smoke: installed package verified
ok ci: npm ci from the lockfile with an empty cache; installed package verified
portability: pass
```
