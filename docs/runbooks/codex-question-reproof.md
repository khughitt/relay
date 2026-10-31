# Codex connector version re-proof

The connector admits exactly codex-cli 0.166.0 on qualified Linux endpoints.
The frozen 0.165.0 artifact is the comparison baseline, not another supported
version. This check uses private homes and a local scripted Responses provider;
it never connects to the user's daemon or reads credentials. Gate 7 is separate.

Run from `.worktrees/codex-question` with Node >=22, Python 3, GNU tar and diff.
Supply the two public release source archives and the absolute, regular executable.
No installer or shared launcher change is needed. Verify these inputs:

| Input | SHA-256 |
| --- | --- |
| `rust-v0.165.0` source archive | `4e066a7dbd1234efa7458c2b137161bb7ddde1dde6be4ed4c8f38e6c45f862ab` |
| `rust-v0.166.0` source archive | `718c86dcd7104919f2820aa79db0fa0083b5f240aa16da704f43e4acf7b544e5` |
| Linux x86_64 musl 0.166.0 executable, 319346888 bytes | `b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8` |

The archive URL pattern is
`https://codeload.github.com/openai/codex/tar.gz/refs/tags/rust-v<VERSION>`.
Keep canonical inputs and outputs under the task's persistent WORK_ROOT directory.
Use a fresh output directory each time, including after failures:

```sh
node tools/codex-question/reprove.mjs \
  --baseline-source "$WORK_ROOT/relay/relay-a27e7c/codex-rust-v0.165.0.tar.gz" \
  --source "$WORK_ROOT/relay/relay-a27e7c/reproof-0.166.0/codex-rust-v0.166.0.tar.gz" \
  --bin "$HOME/.codex/packages/standalone/releases/0.166.0-x86_64-unknown-linux-musl/bin/codex" \
  --binary-sha256 b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8 \
  --out "$WORK_ROOT/relay/relay-a27e7c/reproof-0.166.0/repeat-01"
```

The driver validates archive and executable bytes before execution, verifies the
baseline's 28 source hashes, compares all 28 files, and emits a full source diff.
Three additional sources support history/persistence and native PID publication.
Eighteen lexical source checks plus a bounded TUI override census must pass
before the executable runs. The census scans all TUI Rust sources; the two
literal unload-key occurrences are under the cfg(test) module. This is a
callsite census, not a claim that custom configuration cannot set an override.

Lexical assertions complement review of the changed source regions; they are not
a Rust semantic analyzer. Review those changes before adopting evidence. The
0.166.0 unload default is 60 seconds (0.165.0: 1800), with unchanged subscriber
and inactivity conditions. Neither a default nor a latency sample eliminates
the accepted unload/resume residual or supplies a timing guarantee.

The private run generates four protocol artifacts and runs the actual production
transport, evidence validator, process/listener qualifier and durable inbox. Its
16 assertions cover exact binary/version, scripted model receipt and consumed,
fresh re-ask identity, defer/native answer history, helper release, privacy and
cleanup. The PID-mode assertion requires0644 in the private fixture; run with
umask022 (for example, `umask 022` in the probe shell). The fixture records its actual owned foreground PID in its own private
home; it injects no production identity/evidence bypass.
Pinned `app-server-daemon/src/backend/pid_start.rs:272–296` writes and renames a
temporary PID file without a permissions override: default0666 filtered by
umask022 yields0644, matching the observed live record. The re-proof pins that
source and checks the write/rename/no-override invariant; group/other-writable
records still refuse. Only the private fixture is written; no live permission
change is made. Expect under two minutes.
SIGINT/SIGTERM aborts the run and cleans owned processes. Keep its result and
cleanup verdict, including failures, before retrying.

`--source-only` emits explicitly incomplete source pins and runs no executable;
it emits no accepted `evidence.json`. A failed invariant or pilot exits nonzero
and emits no final evidence. Stop and report an invariant failure; never weaken
the predicate to make an upgrade pass. This tool does not admit future versions.
Successful output still has `gate7Passed: false` and no integration authority.

`source-pins.json`, `source-invariants.json`, `source-comparison.json`,
`source-diff.patch`, `tui-override-census.json`, generated protocol pins and
`native-pilot/result.json` are the evidence index inputs. `evidence.json` is a
candidate portable artifact. Adopting it requires a reviewed commit updating
the sole version/digest in `src/serve/codex/evidence.js`, published artifact path,
fixtures and current documentation. Repeated runs produce different native UUIDs
and result hashes; a successful recheck does not silently replace the reviewed pin.

For focused source tests, set `RELAY_CODEX_SOURCE_ROOT` to the generated
`source-0.166.0` directory and `RELAY_CODEX_SOURCE_VERSION=0.166.0`; set
`RELAY_CODEX_TEST_BIN` to the exact binary for positive evidence validation.
Use `just test-one test/codex-source-proof.test.js test/codex-reproof.test.js
test/codex-evidence.test.js` on Node 22 and the development runtime. Without the
source input, archive-dependent source tests explicitly skip; a skip is not proof.
Run mandatory hygiene and obey the invoking checkout's test policy for broad work.

The [Gate 7 runbook](codex-question-gate7.md) is prepared for later live approval.
