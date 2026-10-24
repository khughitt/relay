# v0.2.0 release preflight

Task: relay-adb97d. Candidate REL: 067c63921602e694682d47bdb2412862359c75ff.
No push or release tag creation/publication has been performed.

## Scope and compatibility

Manifest and lockfile are v0.2.0; private remains true. Adds detached inbox ask/take,
durable take transitions and stale-refusal attempts, plus the Claude terminal-parent
fixes since v0.1.1. Older binaries may quarantine entries with the new histories;
binary downgrade against such a store is unsafe. Live install/service changes belong
to hq-536849 after this release is published and verified.

## Verification

- Clean hydrated baseline: just test, Node26.5.0, 739/739.
- just test-fast: 739/739. Completion was confirmed after the preparation commit;
  the frozen-commit gates below then verified the committed candidate.
- Frozen REL just gate: Node26.5.0, 739/739; Node22.23.2, 739/739.
  Strict checking passed on both runtimes; neither skipped tests.
- Local annotated rehearsal tag: both runtime git installations, manifest preservation,
  commit lock resolution, packaged CLI/module smoke and empty-cache npm ci passed.
- Privacy range v0.1.1..REL includes first-parent merge diffs: gitleaks scanned
  146 commits and found no leaks. Nonblank/non-root and source controls passed for
  4 path patterns and 2 private terms. Path/identity matches 0; state/transcript
  filenames 0; one maintainer author address. No optional work-host file was used,
  as in the earlier release records. Published force-push preimages: 0.
- GitHub repository is public; explicit authenticated identity is khughitt.
  Remote main 5a0638d943fa71434079bea3a9efffd9ac6525bd is an ancestor of REL.
  Remote refs contain only main, annotated v0.1.0 and annotated v0.1.1.

## Approval scope

Push exactly REL to origin main; create annotated immutable v0.2.0 at REL with
message "relay v0.2.0"; push only that tag. Verify remote peeled tag and main equal
REL, then anonymously install the public tag and run the portability check on both
runtimes. Record the publication evidence and hand tag/commit to hq-536849.
No npm registry publication, GitHub Release object, live install or service changes.

## Rehearsal outputs

These are portable derivatives. The literal <RELEASE_SCRATCH> replaces the scratch
root; raw bytes remain in the task-owned retained evidence directory, with a hashed
manifest recorded on the task.

### Node26.5.0

```text
ok reach: 3fb12647319c018e1d9c95874aeec9b03041f20d	refs/tags/v0.2.0-rehearsal
ok install: npm install of git+file://<RELEASE_SCRATCH>/relay.git#v0.2.0-rehearsal
ok manifest: dependency kept as git+file://<RELEASE_SCRATCH>/relay.git#v0.2.0-rehearsal
ok lockfile: relay git+file://<RELEASE_SCRATCH>/relay.git#067c63921602e694682d47bdb2412862359c75ff; jsonc-parser https://registry.npmjs.org/jsonc-parser/-/jsonc-parser-3.3.1.tgz sha512-HUgH65KyejrUFPvHFPbqOY0rsFip3Bo5wb4ngvdi1EpCYWUQDC5V+Y7mZws+DLkr4M//zQJoanu1SP+87Dv1oQ==
ok smoke: installed package verified
ok ci: npm ci from the lockfile with an empty cache; installed package verified
portability: pass
```

### Node22.23.2

```text
ok reach: 3fb12647319c018e1d9c95874aeec9b03041f20d	refs/tags/v0.2.0-rehearsal
ok install: npm install of git+file://<RELEASE_SCRATCH>/relay.git#v0.2.0-rehearsal
ok manifest: dependency kept as git+file://<RELEASE_SCRATCH>/relay.git#v0.2.0-rehearsal
ok lockfile: relay git+file://<RELEASE_SCRATCH>/relay.git#067c63921602e694682d47bdb2412862359c75ff; jsonc-parser https://registry.npmjs.org/jsonc-parser/-/jsonc-parser-3.3.1.tgz sha512-HUgH65KyejrUFPvHFPbqOY0rsFip3Bo5wb4ngvdi1EpCYWUQDC5V+Y7mZws+DLkr4M//zQJoanu1SP+87Dv1oQ==
ok smoke: installed package verified
ok ci: npm ci from the lockfile with an empty cache; installed package verified
portability: pass
```
