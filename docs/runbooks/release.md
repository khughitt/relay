# Releases

Type: operator guide; document types 1.

relay is consumed as a git dependency pinned to an annotated tag,
`git+https://github.com/khughitt/relay.git#v<version>`. It is not published to the npm
registry (`package.json` stays `"private": true`). This runbook is the procedure for
cutting a release; per-release publication records live in the project records repository (`records relay/docs/notes/2026-11-04-release-execution-records.md`).

## Procedure

Run every step from the main checkout. Name the gh account on every gh command
(`GH_TOKEN=$(gh auth token --user khughitt) gh …`). Never switch the global account.

1. **Gate.** Run `TT_FORCE=1 just gate` on the development runtime and on the Node 22
   floor (`PATH="<node 22 bin>:$PATH" TT_FORCE=1 just gate`). Both must pass. Without
   `TT_FORCE=1`, the committed `.tt.toml` skips the suite and the type check, and a skip
   is not a gate count.
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
   print `portability: pass`. Record its output in the release's publication record in `records relay/docs/notes/2026-11-04-release-execution-records.md`.

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
state, user paths outside historical pre-migration `tasks/` commits, or private identities.
Task records now live in the detached records repository; machine paths and host names in
historical pre-migration task notes under `:(exclude)tasks` are accepted, as in the public
tasks and familiar repositories.
